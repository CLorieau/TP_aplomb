importScripts("/db.js", "/sync.js");

// À incrémenter à chaque déploiement : c'est ce qui déclenche la mise à jour chez les utilisateurs.
const CACHE_NAME = "aplomb-v4";

// App Shell : tout ce qu'il faut pour ouvrir l'app sans réseau. sw.js n'y figure jamais.
const APP_SHELL = [
  "/",
  "/offline.html",
  "/styles.css",
  "/db.js",
  "/sync.js",
  "/app.js",
  "/manifest.json",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/outils.md",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  // Pas de skipWaiting() ici : la nouvelle version attend que l'utilisateur l'accepte (bannière),
  // pour ne pas recharger l'app au milieu d'une mesure.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Réseau seul : écritures, autres origines, et l'API (un relevé en cache serait un mensonge).
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(request.mode === "navigate" ? repondreNavigation(request, url) : repondreFichier(request));
});

// Cache First sur tout l'App Shell, HTML compris : page, CSS et JS viennent toujours de la même version.
async function repondreFichier(request) {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(request)) || fetch(request);
}

async function repondreNavigation(request, url) {
  const cache = await caches.open(CACHE_NAME);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const shell = await cache.match("/");
    if (shell) return shell;
  }
  try {
    return await fetch(request);
  } catch {
    return cache.match("/offline.html"); // page de secours pour toute autre adresse hors ligne
  }
}

// Background Sync : le navigateur réveille le Service Worker au retour du réseau, même app fermée.
// Si l'envoi échoue, la promesse rejetée lui demande de réessayer plus tard.
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-releves") event.waitUntil(syncOutbox().then(prevenirLesPages));
});

async function prevenirLesPages() {
  for (const client of await self.clients.matchAll()) client.postMessage({ type: "SYNC_OK" });
}

// Notifications push : le serveur envoie { title, body, tag, url }.
// Chaque push doit afficher une notification (userVisibleOnly), sinon le navigateur retire l'abonnement.
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Aplomb", {
      body: data.body,
      icon: "/icons/icon-192.png",
      tag: data.tag, // même tag = une seule notification, remplacée, plutôt qu'une pile
      data: { url: data.url ?? "/" },
    }),
  );
});

// Au clic : ramener l'app déjà ouverte au premier plan, sinon l'ouvrir.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url } = event.notification.data;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(([ouverte]) => {
      if (!ouverte) return self.clients.openWindow(url);
      ouverte.postMessage({ type: "OUVRIR", url });
      return ouverte.focus();
    }),
  );
});
