# Aplomb

Niveau à bulle et boussole en Progressive Web App : installable, utilisable hors ligne, avec un journal de relevés synchronisé au retour du réseau.

TP PWA — M2 Informatique, Università di Corsica.

- **URL de production** : https://VOTRE-SITE.netlify.app (à compléter)
- **Document technique** : [DOC-TECHNIQUE.md](DOC-TECHNIQUE.md)

## Lancer en local

Node 20 ou plus, aucune installation de dépendance :

```bash
node server.mjs
```

Puis ouvrir http://localhost:8080. Les relevés reçus par le serveur local sont écrits dans `.data/releves.json`.

Les capteurs d'orientation n'existent que sur téléphone. Sur ordinateur, Chrome les simule : DevTools → ⋮ → More tools → Sensors → Orientation.

## Structure

```
public/               servi tel quel par Netlify
  index.html          les quatre vues et le contenu public (guide)
  app.js              interface, capteurs, relevés, mise à jour
  db.js               IndexedDB (page + Service Worker)
  sync.js             envoi de l'outbox (page + Service Worker)
  sw.js               cache de l'App Shell, page de secours, Background Sync
  offline.html        page de secours
  manifest.json, icons/
  robots.txt, sitemap.xml, llms.txt, outils.md
  _headers            en-têtes HTTP (CSP, noindex sur le Markdown…)
api/releves.mjs       logique de l'API, partagée par les deux serveurs
netlify/functions/    l'API en production (Netlify Functions + Netlify Blobs)
server.mjs            serveur local (fichiers + API)
netlify.toml          configuration du déploiement
```

## Déployer sur Netlify

1. Pousser ce dossier dans un dépôt Git public.
2. Sur Netlify : **Add new site → Import an existing project**, choisir le dépôt. `netlify.toml` fournit tous les réglages (dossier publié `public`, pas de commande de build) ; Netlify installe `@netlify/blobs` et déploie la fonction tout seul.
3. Remplacer `VOTRE-SITE.netlify.app` par l'adresse réelle dans `public/index.html`, `robots.txt`, `sitemap.xml`, `llms.txt` et ce README, puis pousser.

### À chaque redéploiement

- Incrémenter `CACHE_NAME` dans `public/sw.js` (`aplomb-v2`, `aplomb-v3`…). Sans cela, les appareils qui ont déjà l'app gardent l'ancienne version.
- Mettre à jour `lastmod` dans `public/sitemap.xml`.

## Vérifier

```bash
curl -s -A "GPTBot" https://VOTRE-SITE.netlify.app/ | grep -c "<h3>"
```

```bash
curl -sI https://VOTRE-SITE.netlify.app/outils.md | grep -iE "content-type|x-robots"
```

Les relevés arrivés au serveur pour un appareil (l'identifiant se lit dans DevTools → Application → IndexedDB → `aplomb-db` → `meta`) :

```bash
curl -s -H "X-Device-Id: <identifiant>" https://VOTRE-SITE.netlify.app/api/releves
```
