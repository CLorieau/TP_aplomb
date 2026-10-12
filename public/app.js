// Nécessite db.js et sync.js.
const $ = (selecteur) => document.querySelector(selecteur);
const RAD = Math.PI / 180;
// 1 décimale, virgule française, vrai signe moins ; « −0,0 » est ramené à « 0,0 ».
const fmt = (n) => (Math.round(n * 10) / 10 || 0).toFixed(1).replace(".", ",").replace("-", "−");

let toastTimer;
function toast(texte) {
  const el = $("#toast");
  el.textContent = texte;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3500);
}

// ---------------------------------------------------------------- Onglets

const vues = [...document.querySelectorAll("[data-vue]")];
let capteursActifs = false;

function afficherVue() {
  const active = vues.find((v) => v.id === location.hash.slice(1)) || vues[0];
  for (const v of vues) v.hidden = v !== active;
  for (const a of document.querySelectorAll(".onglets a")) {
    if (a.hash === `#${active.id}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const outil = "outil" in active.dataset;
  $("#capteurs").hidden = !outil || capteursActifs;
  $("#ecran-allume-ligne").hidden = !outil || !capteursActifs || !("wakeLock" in navigator);
}
window.addEventListener("hashchange", afficherVue);

// ---------------------------------------------------------------- Capteurs d'orientation

const LISSAGE = 0.15; // part de la nouvelle mesure dans la valeur affichée (filtre passe-bas)
const ANGLE_MAX = 10; // écart, en degrés, qui amène la bulle en butée
const SEUIL_NIVEAU = 0.5;

let haut = null; // vecteur « haut » (opposé à la gravité) dans le repère de l'écran, lissé
let cap = null; // cap magnétique lissé, 0–360°
let rotationRose = 0;
let etalonnage = { key: "etalonnage", plat: { x: 0, y: 0 }, chant: 0 };

// 0 en portrait ; non nul si l'écran a pivoté (l'app installée reste en portrait, pas l'onglet du navigateur).
const angleEcran = () => screen.orientation?.angle ?? window.orientation ?? 0;

async function activerCapteurs() {
  const message = $("#capteurs-message");
  message.textContent = "";
  if (!("DeviceOrientationEvent" in window)) {
    message.textContent = "Ce navigateur ne donne pas accès aux capteurs d'orientation.";
    return;
  }
  // iOS : la permission ne peut être demandée que dans le gestionnaire d'un geste de l'utilisateur.
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const reponse = await DeviceOrientationEvent.requestPermission().catch(() => "denied");
    if (reponse !== "granted") {
      message.textContent =
        "Accès aux capteurs refusé : le niveau et la boussole ne peuvent pas mesurer. " +
        "Pour l'autoriser, fermez puis rouvrez l'application et appuyez de nouveau sur « Activer les capteurs ».";
      return;
    }
  }
  // Android fournit le cap absolu sur un événement séparé ; iOS le joint à deviceorientation.
  window.addEventListener("deviceorientationabsolute", surOrientation);
  window.addEventListener("deviceorientation", surOrientation);
  setTimeout(() => {
    if (!haut) message.textContent = "Aucune mesure reçue : cet appareil n'a pas de capteur d'orientation (ordinateur ?). Ouvrez Aplomb sur un téléphone.";
    else if (cap === null) $("#boussole-detail").textContent = "Cet appareil ne fournit pas de cap magnétique : la boussole est indisponible.";
  }, 2500);
}

function surOrientation(e) {
  if (e.beta !== null && e.gamma !== null) {
    majNiveau(e.beta, e.gamma);
    if (!capteursActifs) {
      capteursActifs = true;
      for (const b of document.querySelectorAll("#niveau button")) b.disabled = false;
      afficherVue();
    }
  }
  if (typeof e.webkitCompassHeading === "number") {
    if (e.webkitCompassAccuracy >= 0) majCap(e.webkitCompassHeading + angleEcran()); // iOS
  } else if (e.absolute && e.alpha !== null) {
    majCap(360 - e.alpha + angleEcran()); // alpha tourne dans le sens inverse d'un cap
  }
}

// ---------------------------------------------------------------- Niveau à bulle

function majNiveau(beta, gamma) {
  const b = beta * RAD;
  const g = gamma * RAD;
  // Direction du haut dans le repère de l'appareil : 3e ligne de la matrice R = Rz(α)·Rx(β)·Ry(γ) de la spec.
  // À plat → (0, 0, 1) ; debout en portrait → (0, 1, 0).
  let x = -Math.cos(b) * Math.sin(g);
  let y = Math.sin(b);
  const z = Math.cos(b) * Math.cos(g);
  const a = angleEcran() * RAD;
  [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  haut = haut
    ? { x: haut.x + (x - haut.x) * LISSAGE, y: haut.y + (y - haut.y) * LISSAGE, z: haut.z + (z - haut.z) * LISSAGE }
    : { x, y, z };
  dessinerNiveau();
}

// La mesure courante, étalonnage déduit. null tant qu'aucun capteur n'a répondu.
function lectureNiveau() {
  if (!haut) return null;
  if (Math.abs(haut.z) > 0.7) {
    // À plat : pente de chaque axe de l'écran par rapport à l'horizontale.
    const x = Math.atan2(haut.x, Math.abs(haut.z)) / RAD - etalonnage.plat.x;
    const y = Math.atan2(haut.y, Math.abs(haut.z)) / RAD - etalonnage.plat.y;
    return { mode: "plat", x, y, valeur: Math.hypot(x, y) };
  }
  // Sur chant : rotation dans le plan de l'écran, ramenée à l'horizontale ou la verticale la plus proche.
  const angle = Math.atan2(haut.x, haut.y) / RAD;
  const cran = 90 * Math.round(angle / 90);
  return { mode: "chant", cran, valeur: angle - cran - etalonnage.chant };
}

function dessinerNiveau() {
  const l = lectureNiveau();
  const visuel = $("#niveau-visuel");
  visuel.dataset.mode = l.mode;
  visuel.classList.toggle("de-niveau", Math.abs(l.valeur) < SEUIL_NIVEAU);
  $("#niveau-valeur").textContent = `${fmt(l.valeur)}°`;

  if (l.mode === "plat") {
    // La bulle monte vers le côté le plus haut. L'axe y de l'écran pointe vers le bas, d'où le signe.
    let dx = l.x / ANGLE_MAX;
    let dy = -l.y / ANGLE_MAX;
    const norme = Math.hypot(dx, dy);
    if (norme > 1) [dx, dy] = [dx / norme, dy / norme];
    const bulle = $("#bulle-plat");
    const course = (bulle.parentElement.clientWidth - bulle.offsetWidth) / 2;
    bulle.style.transform = `translate(${dx * course}px, ${dy * course}px)`;
    $("#niveau-detail").textContent = `À plat · gauche-droite ${fmt(l.x)}° · haut-bas ${fmt(l.y)}°`;
  } else {
    // Le tube est tourné par crans de 90° pour rester à peu près horizontal quel que soit le côté posé.
    $("#chant").style.transform = `rotate(${l.cran}deg)`;
    const bulle = $("#bulle-chant");
    const course = (bulle.parentElement.clientWidth - bulle.offsetWidth) / 2;
    const d = Math.max(-1, Math.min(1, l.valeur / ANGLE_MAX));
    bulle.style.transform = `translateX(${d * course}px)`;
    $("#niveau-detail").textContent = "Sur chant · écart à l'horizontale ou à la verticale";
  }
}

async function etalonner() {
  const l = lectureNiveau();
  if (!l) return;
  // La lecture est déjà corrigée de l'étalonnage précédent : on cumule.
  if (l.mode === "plat") {
    etalonnage.plat.x += l.x;
    etalonnage.plat.y += l.y;
  } else {
    etalonnage.chant += l.valeur;
  }
  await DB.put("meta", etalonnage);
  dessinerNiveau();
  toast("Étalonné : cette position est le nouveau zéro.");
}

async function annulerEtalonnage() {
  etalonnage = { key: "etalonnage", plat: { x: 0, y: 0 }, chant: 0 };
  await DB.put("meta", etalonnage);
  if (haut) dessinerNiveau();
  toast("Étalonnage annulé.");
}

// ---------------------------------------------------------------- Boussole

const CARDINAUX = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const cardinal = (degres) => CARDINAUX[Math.round(degres / 45) % 8];

function dessinerGraduations() {
  const groupe = $("#rose-graduations");
  for (let angle = 0; angle < 360; angle += 10) {
    const trait = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const majeure = angle % 30 === 0;
    trait.setAttribute("y1", -94);
    trait.setAttribute("y2", majeure ? -82 : -88);
    trait.setAttribute("transform", `rotate(${angle})`);
    if (majeure) trait.classList.add("majeure");
    groupe.append(trait);
  }
}

function majCap(brut) {
  const mesure = ((brut % 360) + 360) % 360;
  if (cap === null) {
    cap = mesure;
    rotationRose = -cap;
    $("#form-boussole button").disabled = false;
    $("#boussole-detail").textContent = "Cap magnétique · direction pointée par le haut du téléphone";
  } else {
    // Plus court chemin entre deux caps (359° → 1° = +2°, pas −358°), sinon la rose ferait un tour complet.
    const ecart = (((mesure - cap + 540) % 360) - 180) * LISSAGE;
    cap = (cap + ecart + 360) % 360;
    rotationRose -= ecart;
  }
  $("#rose").style.transform = `rotate(${rotationRose}deg)`;
  const degres = Math.round(cap) % 360;
  $("#boussole-valeur").textContent = `${degres}° ${cardinal(degres)}`;
}

// ---------------------------------------------------------------- Écran allumé (Wake Lock)

let verrouEcran = null;

async function majEcranAllume() {
  const case_ = $("#ecran-allume");
  if (!case_.checked) {
    await verrouEcran?.release();
    verrouEcran = null;
    return;
  }
  try {
    verrouEcran = await navigator.wakeLock.request("screen");
  } catch {
    case_.checked = false;
    toast("Impossible de garder l'écran allumé (économie d'énergie active ?).");
  }
}

// Le système relâche le verrou quand l'app passe en arrière-plan : on le redemande au retour.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && $("#ecran-allume").checked) majEcranAllume();
});

// ---------------------------------------------------------------- Relevés

const ETATS = { attente: "En attente", envoye: "Envoyé", refuse: "Refusé par le serveur" };

function titreReleve(r) {
  if (r.outil === "boussole") return `Boussole · ${r.valeur}° ${cardinal(r.valeur)}`;
  return `Niveau · ${fmt(r.valeur)}° ${r.mode === "plat" ? "à plat" : "sur chant"}`;
}

async function afficherReleves() {
  const releves = (await DB.getAll("releves")).sort((a, b) => b.createdAt - a.createdAt);
  const enAttente = releves.filter((r) => r.etat === "attente").length;

  // textContent partout : une note saisie par l'utilisateur n'est jamais interprétée comme du HTML.
  const element = (balise, classe, texte) => {
    const el = document.createElement(balise);
    el.className = classe;
    el.textContent = texte;
    return el;
  };
  $("#liste-releves").replaceChildren(
    ...releves.map((r) => {
      const li = element("li", "releve");
      const supprimer = element("button", "", "Supprimer");
      supprimer.addEventListener("click", async () => {
        await supprimerReleve(r.id);
        await afficherReleves();
        synchroniser();
      });
      const fin = element("div", "releve-fin");
      fin.append(element("span", `etat etat-${r.etat}`, ETATS[r.etat]), supprimer);
      li.append(element("span", "releve-titre", titreReleve(r)));
      if (r.note) li.append(element("span", "releve-note", r.note));
      li.append(
        element("span", "releve-date", new Date(r.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })),
        fin,
      );
      return li;
    }),
  );
  $("#releves-vide").hidden = releves.length > 0;
  $("#releves-resume").textContent = releves.length
    ? `${releves.length} relevé${releves.length > 1 ? "s" : ""}${enAttente ? ` · ${enAttente} en attente d'envoi` : ""}`
    : "";
}

async function enregistrer(outil) {
  const champNote = $(`#note-${outil}`);
  const releve = { id: crypto.randomUUID(), outil, note: champNote.value.trim(), createdAt: Date.now() };
  if (outil === "boussole") {
    if (cap === null) return;
    releve.valeur = Math.round(cap) % 360;
  } else {
    const l = lectureNiveau();
    if (!l) return;
    const arrondi = (n) => Math.round(n * 10) / 10;
    Object.assign(releve, { mode: l.mode, valeur: arrondi(l.valeur) });
    if (l.mode === "plat") Object.assign(releve, { x: arrondi(l.x), y: arrondi(l.y) });
  }
  // Local d'abord : le relevé existe dès maintenant, avec ou sans réseau.
  await ajouterReleve(releve);
  champNote.value = "";
  await afficherReleves();
  toast(navigator.onLine ? "Relevé enregistré." : "Relevé enregistré : il sera envoyé au retour du réseau.");
  synchroniser();
}

// ---------------------------------------------------------------- Synchronisation et réseau

async function synchroniser({ manuel = false } = {}) {
  try {
    const traites = await syncOutbox();
    if (traites) await afficherReleves();
    if (manuel) toast(traites ? "Relevés synchronisés." : "Tout est déjà synchronisé.");
  } catch {
    // Réseau ou serveur injoignable. Background Sync réessaiera, même app fermée (Chromium) ;
    // ailleurs, l'événement "online" et le prochain démarrage prennent le relais.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && "sync" in reg) reg.sync.register("sync-releves").catch(() => {});
    if (manuel) toast("Serveur injoignable : nouvel essai au retour du réseau.");
  }
}

function majEtatReseau() {
  const enLigne = navigator.onLine;
  document.body.classList.toggle("hors-ligne", !enLigne);
  $("#etat-reseau").textContent = enLigne ? "En ligne" : "Hors ligne";
  $("#bandeau-hors-ligne").hidden = enLigne;
  $("#btn-sync").disabled = !enLigne; // action indisponible sans réseau : signalée, pas en erreur
}

window.addEventListener("online", () => {
  majEtatReseau();
  synchroniser(); // navigator.onLine peut mentir (Wi-Fi sans internet) : un échec du fetch est géré dans synchroniser
});
window.addEventListener("offline", majEtatReseau);

// ---------------------------------------------------------------- Service Worker et mise à jour

async function enregistrerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Sans contrôleur, c'est une première visite : le clients.claim() du SW ne doit pas recharger la page.
  const dejaControlee = Boolean(navigator.serviceWorker.controller);
  const reg = await navigator.serviceWorker.register("/sw.js");

  const proposer = (worker) => {
    $("#bandeau-maj").hidden = false;
    $("#btn-maj").onclick = () => worker.postMessage({ type: "SKIP_WAITING" });
  };
  if (reg.waiting && dejaControlee) proposer(reg.waiting); // mise à jour téléchargée lors d'une visite précédente
  reg.addEventListener("updatefound", () => {
    const nouveau = reg.installing;
    nouveau.addEventListener("statechange", () => {
      if (nouveau.state === "installed" && navigator.serviceWorker.controller) proposer(nouveau);
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (dejaControlee) location.reload();
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SYNC_OK") afficherReleves();
    if (event.data?.type === "OUVRIR") location.hash = new URL(event.data.url, location.href).hash; // clic sur une notification
  });
}

// ---------------------------------------------------------------- Notifications push

const enTetesApi = async () => ({ "Content-Type": "application/json", "X-Device-Id": await getDeviceId() });

// pushManager.subscribe attend la clé publique VAPID en octets ; le serveur la donne en base64url.
const cleEnOctets = (base64url) =>
  Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// Affiche les boutons selon l'état réel de l'abonnement, que le navigateur conserve entre deux visites.
async function majEtatNotifications() {
  if (!("PushManager" in window && "Notification" in window && "serviceWorker" in navigator)) {
    $("#btn-notifs").hidden = true;
    $("#notifs-message").textContent =
      "Les notifications push ne sont pas disponibles dans ce navigateur. Sur iPhone, installez d'abord Aplomb sur l'écran d'accueil.";
    return null;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const abonnement = (await reg?.pushManager.getSubscription()) ?? null;
  $("#btn-notifs").hidden = Boolean(abonnement);
  $("#btn-notifs-test").hidden = $("#btn-notifs-off").hidden = !abonnement;
  return abonnement;
}

async function activerNotifications() {
  const message = $("#notifs-message");
  message.textContent = "";
  // Demandée ici seulement : après un geste, et juste sous le texte qui explique à quoi elle sert.
  if ((await Notification.requestPermission()) !== "granted") {
    message.textContent =
      "Notifications refusées : Aplomb fonctionne sans, l'état de chaque relevé reste visible dans cette liste. " +
      "Vous pourrez les autoriser plus tard dans les réglages du site.";
    return;
  }
  try {
    const headers = await enTetesApi();
    const cle = await fetch("/api/push", { headers });
    if (!cle.ok) throw new Error(`Clé VAPID indisponible (${cle.status})`);
    const { clePublique } = await cle.json();
    const reg = await navigator.serviceWorker.ready;
    const abonnement = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: cleEnOctets(clePublique),
    });
    const depot = await fetch("/api/push", { method: "PUT", headers, body: JSON.stringify(abonnement) });
    if (!depot.ok) {
      await abonnement.unsubscribe(); // pas d'abonnement que le serveur ne connaît pas
      throw new Error(`Abonnement refusé (${depot.status})`);
    }
    toast("Notifications activées.");
  } catch {
    message.textContent = "Activation impossible pour l'instant : une connexion au serveur est nécessaire. Réessayez en ligne.";
  }
  await majEtatNotifications();
}

async function desactiverNotifications() {
  const abonnement = await majEtatNotifications();
  await abonnement?.unsubscribe();
  // Hors ligne, la suppression côté serveur échoue : il s'en apercevra au prochain envoi (réponse 410).
  await fetch("/api/push", { method: "DELETE", headers: await enTetesApi() }).catch(() => {});
  await majEtatNotifications();
  toast("Notifications désactivées.");
}

async function testerNotification() {
  const rep = await fetch("/api/push/test", { method: "POST", headers: await enTetesApi() }).catch(() => null);
  toast(rep?.ok ? "Notification de test envoyée." : "Envoi impossible : vérifiez la connexion.");
}

// ---------------------------------------------------------------- Installation

let invitationInstallation = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  invitationInstallation = e;
  $("#btn-installer").hidden = false;
});
window.addEventListener("appinstalled", () => ($("#btn-installer").hidden = true));

// ---------------------------------------------------------------- Démarrage

async function demarrer() {
  afficherVue();
  dessinerGraduations();
  majEtatReseau();

  $("#btn-capteurs").addEventListener("click", activerCapteurs);
  $("#btn-etalonner").addEventListener("click", etalonner);
  $("#btn-raz-etalonnage").addEventListener("click", annulerEtalonnage);
  $("#ecran-allume").addEventListener("change", majEcranAllume);
  $("#btn-sync").addEventListener("click", () => synchroniser({ manuel: true }));
  $("#btn-notifs").addEventListener("click", activerNotifications);
  $("#btn-notifs-off").addEventListener("click", desactiverNotifications);
  $("#btn-notifs-test").addEventListener("click", testerNotification);
  $("#btn-installer").addEventListener("click", async () => {
    if (!invitationInstallation) return;
    invitationInstallation.prompt();
    await invitationInstallation.userChoice;
    invitationInstallation = null;
    $("#btn-installer").hidden = true;
  });
  for (const outil of ["niveau", "boussole"]) {
    $(`#form-${outil}`).addEventListener("submit", (e) => {
      e.preventDefault();
      enregistrer(outil);
    });
  }

  etalonnage = (await DB.get("meta", "etalonnage")) ?? etalonnage;
  await afficherReleves();
  await enregistrerServiceWorker();
  await majEtatNotifications();
  synchroniser();
}

demarrer();
