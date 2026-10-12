// Accès à IndexedDB, chargé par la page ET par le Service Worker (importScripts) :
// les deux lisent la même outbox. Aucune dépendance, donc rien à charger depuis un CDN hors ligne.

const DB_NAME = "aplomb-db";
const DB_VERSION = 1;

let dbPromise;
function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("releves", { keyPath: "id" }); // id = UUID créé sur l'appareil
      db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }); // seq = ordre d'envoi
      db.createObjectStore("meta", { keyPath: "key" }); // identifiant de l'appareil, étalonnage
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Une transaction sur un ou plusieurs stores ; résout avec le résultat de la requête renvoyée par fn.
async function transaction(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(...[stores].flat().map((nom) => tx.objectStore(nom)));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const DB = {
  get: (store, key) => transaction(store, "readonly", (s) => s.get(key)),
  getAll: (store) => transaction(store, "readonly", (s) => s.getAll()),
  put: (store, value) => transaction(store, "readwrite", (s) => s.put(value)),
  transaction,
};

// Identifiant aléatoire de l'appareil : il rattache les relevés à leur auteur sans compte utilisateur.
async function getDeviceId() {
  const existant = await DB.get("meta", "deviceId");
  if (existant) return existant.value;
  const value = crypto.randomUUID();
  await DB.put("meta", { key: "deviceId", value });
  return value;
}

// Le relevé et son ordre d'envoi sont écrits dans la même transaction : jamais l'un sans l'autre.
function ajouterReleve(releve) {
  return DB.transaction(["releves", "outbox"], "readwrite", (releves, outbox) => {
    releves.put({ ...releve, etat: "attente" });
    outbox.add({ op: "put", id: releve.id, releve });
  });
}

function supprimerReleve(id) {
  return DB.transaction(["releves", "outbox"], "readwrite", (releves, outbox) => {
    releves.delete(id);
    outbox.add({ op: "delete", id });
  });
}
