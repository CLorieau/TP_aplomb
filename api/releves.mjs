// API des relevés, indépendante de l'hébergeur : la fonction Netlify et le serveur local
// lui passent chacun leur stockage ({ lire, ecrire, supprimer, lister }).
//
//   GET    /api/releves        → les relevés de l'appareil
//   PUT    /api/releves/<id>   → crée ou remplace (idempotent : l'outbox peut rejouer sans doublon)
//   DELETE /api/releves/<id>   → supprime (idempotent aussi)
//
// L'appareil s'identifie par l'en-tête X-Device-Id (UUID aléatoire créé côté client).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAILLE_MAX = 2000;

const json = (status, data) =>
  new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// Ne garde que les champs attendus : rien de ce qu'envoie le client n'est stocké tel quel.
function valider(d, id) {
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

export async function traiter(request, stockage) {
  const appareil = request.headers.get("X-Device-Id") ?? "";
  if (!UUID.test(appareil)) return json(400, { erreur: "En-tête X-Device-Id manquant ou invalide" });

  const id = new URL(request.url).pathname.split("/")[3]; // /api/releves/<id>
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
    const releve = valider(donnees, id);
    if (!releve) return json(400, { erreur: "Relevé invalide" });
    await stockage.ecrire(cle, releve);
    return json(200, releve);
  }

  if (request.method === "DELETE") {
    await stockage.supprimer(cle);
    return json(204);
  }

  return json(405, { erreur: "Méthode non autorisée" });
}
