// API d'Aplomb, indépendante de l'hébergeur : la fonction Netlify et le serveur local
// lui passent chacun leur stockage ({ lire, ecrire, supprimer, lister }) et, s'il est configuré,
// l'envoi de notifications push ({ clePublique, envoyer } — voir push.mjs).
//
//   GET    /api/releves        → les relevés de l'appareil
//   PUT    /api/releves/<id>   → crée ou remplace (idempotent : l'outbox peut rejouer sans doublon)
//   DELETE /api/releves/<id>   → supprime (idempotent aussi)
//
//   GET    /api/push           → la clé publique VAPID, nécessaire au navigateur pour s'abonner
//   PUT    /api/push           → enregistre l'abonnement push de l'appareil
//   DELETE /api/push           → le supprime
//
// L'appareil s'identifie par l'en-tête X-Device-Id (UUID aléatoire créé côté client).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAILLE_MAX = 2000;

// Le serveur envoie une requête à l'adresse fournie par le client : on n'accepte que les services
// de push des navigateurs (Chrome/Edge, Firefox, Windows, Safari), pas une URL arbitraire.
const SERVICES_PUSH = [
  /^fcm\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
  /\.push\.apple\.com$/,
];

const json = (status, data) =>
  new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// Corps JSON de taille bornée ; null s'il est trop gros ou illisible.
async function lireJson(request) {
  const corps = await request.text();
  if (corps.length > TAILLE_MAX) return null;
  try {
    return JSON.parse(corps);
  } catch {
    return null;
  }
}

// Ne garde que les champs attendus : rien de ce qu'envoie le client n'est stocké tel quel.
function validerReleve(d, id) {
  const nombre = (v) => typeof v === "number" && Number.isFinite(v);
  if (!d || typeof d !== "object") return null;
  if (!["niveau", "boussole"].includes(d.outil) || !nombre(d.valeur) || !nombre(d.createdAt)) return null;

  const releve = { id, outil: d.outil, valeur: d.valeur, note: String(d.note ?? "").slice(0, 140), createdAt: d.createdAt };
  if (d.outil === "niveau") {
    if (!["plat", "chant"].includes(d.mode)) return null;
    releve.mode = d.mode;
    if (nombre(d.x) && nombre(d.y)) Object.assign(releve, { x: d.x, y: d.y });
  }
  return releve;
}

function validerAbonnement(d) {
  if (typeof d?.endpoint !== "string" || typeof d.keys?.p256dh !== "string" || typeof d.keys?.auth !== "string") return null;
  let url;
  try {
    url = new URL(d.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !SERVICES_PUSH.some((service) => service.test(url.hostname))) return null;
  return { endpoint: d.endpoint, keys: { p256dh: d.keys.p256dh, auth: d.keys.auth } };
}

const cleAbonnement = (appareil) => `abonnements/${appareil}`;

// Envoie une notification à l'appareil s'il est abonné. Ne lève jamais : un push raté
// ne doit pas faire échouer l'enregistrement d'un relevé.
async function notifier(stockage, push, appareil, message) {
  const abonnement = push && (await stockage.lire(cleAbonnement(appareil)));
  if (!abonnement) return false;
  try {
    await push.envoyer(abonnement, message);
    return true;
  } catch (erreur) {
    // 404 ou 410 : l'abonnement a expiré ou a été révoqué dans le navigateur, inutile de le garder.
    if ([404, 410].includes(erreur.statusCode)) await stockage.supprimer(cleAbonnement(appareil));
    return false;
  }
}

async function traiterPush(request, stockage, push, appareil) {
  if (!push) return json(503, { erreur: "Notifications non configurées sur ce serveur" });

  if (request.method === "GET") return json(200, { clePublique: push.clePublique });
  if (request.method === "PUT") {
    const abonnement = validerAbonnement(await lireJson(request));
    if (!abonnement) return json(400, { erreur: "Abonnement invalide" });
    await stockage.ecrire(cleAbonnement(appareil), abonnement);
    return json(204);
  }
  if (request.method === "DELETE") {
    await stockage.supprimer(cleAbonnement(appareil));
    return json(204);
  }
  return json(405, { erreur: "Méthode non autorisée" });
}

export async function traiter(request, stockage, push = null) {
  const appareil = request.headers.get("X-Device-Id") ?? "";
  if (!UUID.test(appareil)) return json(400, { erreur: "En-tête X-Device-Id manquant ou invalide" });

  const [, , ressource, id] = new URL(request.url).pathname.split("/"); // /api/<ressource>/<id>
  if (ressource === "push") return traiterPush(request, stockage, push, appareil);

  if (!id) {
    if (request.method !== "GET") return json(405, { erreur: "Méthode non autorisée" });
    const cles = await stockage.lister(`${appareil}/`);
    const releves = (await Promise.all(cles.map((cle) => stockage.lire(cle)))).filter(Boolean);
    return json(200, releves.sort((a, b) => b.createdAt - a.createdAt));
  }

  if (!UUID.test(id)) return json(400, { erreur: "Identifiant de relevé invalide" });
  const cle = `${appareil}/${id}`;

  if (request.method === "PUT") {
    const corps = await request.text();
    if (corps.length > TAILLE_MAX) return json(413, { erreur: "Relevé trop volumineux" });
    let donnees;
    try {
      donnees = JSON.parse(corps);
    } catch {
      return json(400, { erreur: "JSON invalide" });
    }
    const releve = validerReleve(donnees, id);
    if (!releve) return json(400, { erreur: "Relevé invalide" });
    await stockage.ecrire(cle, releve);

    // Le client signale un relevé resté en attente (pris hors ligne) : on confirme son arrivée.
    // Même tag pour toute la série : une seule notification, pas une par relevé.
    if (request.headers.get("X-Differe") === "1") {
      await notifier(stockage, push, appareil, {
        title: "Relevés synchronisés",
        body: "Vos relevés pris hors ligne sont bien arrivés au serveur.",
        tag: "sync",
        url: "/#releves",
      });
    }
    return json(200, releve);
  }

  if (request.method === "DELETE") {
    await stockage.supprimer(cle);
    return json(204);
  }

  return json(405, { erreur: "Méthode non autorisée" });
}
