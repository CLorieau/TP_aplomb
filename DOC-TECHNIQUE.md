# Aplomb — Technical Design Doc

Auteur : Clément Lorieau · 12 octobre 2026 · URL de production : https://playful-kataifi-da7d5a.netlify.app · Dépôt : https://github.com/CLorieau/TP_aplomb · Statut : draft

## 1. TL;DR

Aplomb transforme un téléphone en niveau à bulle et en boussole, et garde un journal des mesures enregistrées. Elle vise un usage de terrain (chantier, randonnée) où le réseau manque. Choix principal : tout fonctionne en local d'abord (App Shell en cache, relevés dans IndexedDB), le serveur ne reçoit qu'une copie par une outbox.

## 2. Contexte et objectifs

- **Problème** : un outil de mesure doit s'ouvrir tout de suite, y compris sans réseau, et ne pas perdre une mesure prise hors ligne. Sujet libre.
- **Goals** : niveau (à plat et sur chant) avec étalonnage ; boussole ; relevés enregistrés avec une note, consultables hors ligne, synchronisés au retour du réseau ; notification push qui confirme l'arrivée des relevés pris hors ligne ; guide public lisible par les moteurs et les agents IA.
- **Non-goals** : pas de compte utilisateur, pas de géolocalisation, pas de consultation des relevés depuis un autre appareil.

## 3. Architecture

- **Stack** : HTML/CSS/JavaScript sans framework ni étape de build. Service Worker écrit à la main. IndexedDB via un petit wrapper maison (`db.js`) plutôt que `idb` : le même fichier est chargé par la page et par le Service Worker (`importScripts`), et rien ne dépend d'un CDN hors ligne.
- **Serveur** : une Netlify Function (`/api/releves`, `/api/push`) qui stocke dans Netlify Blobs et envoie les notifications avec la librairie `web-push`. La logique est dans `api/releves.mjs` et `api/push.mjs`, réutilisée par le serveur local `server.mjs`.

```
page (app.js) ──► IndexedDB : releves, outbox, meta ◄── Service Worker (sync)
     │                                                        │
     │  fichiers : Cache API « aplomb-vN » (via le SW)        │
     └──────────── PUT / DELETE /api/releves/<id> ────────────┘
                               │
                 Netlify Function ──► Netlify Blobs
                               │ web-push (VAPID)
                 service de push du navigateur ──► Service Worker (push) ──► notification
```

- **Hébergement** : Netlify, déploiement à chaque `git push` ; `netlify.toml` publie `public/` sans build.

## 4. Cache et hors ligne

| Ressource | Stratégie | Stockage | Pourquoi |
|---|---|---|---|
| HTML (`/`) | Cache First | Cache API | Sert toujours le HTML de la même version que le CSS et le JS |
| CSS / JS / icônes / manifest | Cache First (pré-cache à l'installation) | Cache API | Fichiers figés pour une version donnée ; ouverture instantanée |
| Relevés, étalonnage | Lecture locale | IndexedDB | La source de vérité est l'appareil |
| `/api/*` | Network Only | — | Une réponse d'écriture mise en cache serait fausse |

Le cours conseille Stale While Revalidate pour le HTML. Cache First a été préféré : avec SWR, un HTML récent pourrait être servi avec un ancien `app.js`. La contrepartie est que toute modification passe par un changement de `CACHE_NAME`.

- **Hors ligne, l'utilisateur voit** : l'app complète, ses relevés, la pastille « Hors ligne » et un bandeau. Le niveau et la boussole fonctionnent.
- **Désactivé** : le bouton « Synchroniser ». Un relevé pris hors ligne est marqué « En attente ».
- **Page de secours** : `offline.html` pour toute navigation hors ligne vers une adresse absente du cache.

## 5. Mise à jour

- **Stratégie** : nouvelle version **proposée à l'utilisateur** par une bannière. Une application d'office rechargerait la page au milieu d'une mesure.
- **Mécanisme** : `CACHE_NAME` incrémenté à chaque déploiement → le nouveau Service Worker s'installe et reste en attente (pas de `skipWaiting` à l'installation) → la page affiche la bannière → au clic, message `SKIP_WAITING` → `activate` supprime les anciens caches → `controllerchange` recharge la page. À la première visite, il n'y a pas de rechargement.

## 6. Données et synchronisation

| Store | Clé | Contenu |
|---|---|---|
| `releves` | `id` (UUID créé sur l'appareil) | `outil`, `valeur`, `mode`, `x`, `y`, `note`, `createdAt`, `etat` (attente / envoyé / refusé) |
| `outbox` | `seq` (auto-incrément) | `op` (put / delete), `id`, copie du relevé, `differe` (un envoi a déjà échoué) |
| `meta` | `key` | identifiant de l'appareil, étalonnage du niveau |

- **Outbox** : chaque enregistrement ou suppression écrit le relevé et son ordre d'envoi dans la même transaction. L'envoi (`sync.js`) parcourt l'outbox dans l'ordre et retire chaque entrée acceptée.
- **Quand** : juste après l'action ; en cas d'échec, Background Sync (`sync-releves`, Chromium) ; en repli, l'événement `online`, le démarrage de l'app et le bouton « Synchroniser ».
- **Échec** : erreur réseau ou 5xx → l'entrée reste et sera rejouée. `400` ou `413` → entrée retirée et relevé marqué « Refusé », pour ne pas bloquer la file.
- **Doublons** : `PUT /api/releves/<id>` avec l'id du client est idempotent ; un verrou Web Locks évite que la page et le Service Worker envoient en même temps.
- **Conflits** : ignorés. Un relevé n'est jamais modifié après création et n'appartient qu'à un appareil, donc deux écritures concurrentes sur le même relevé ne peuvent pas arriver.

## 7. Permissions et capacités de l'appareil

| Capacité / API | Déclenchée quand | Pourquoi à ce moment | Si refus |
|---|---|---|---|
| Capteurs d'orientation (`DeviceOrientationEvent`) | Appui sur « Activer les capteurs » | iOS n'accepte la demande que dans un geste ; l'utilisateur sait pourquoi on la lui pose | Message expliquant que les outils ne peuvent pas mesurer et comment réessayer ; relevés et guide restent utilisables |
| Écran allumé (Screen Wake Lock) | Case « Garder l'écran allumé » | Utile seulement pendant une mesure, et choisi par l'utilisateur | Case décochée et message ; option masquée si l'API n'existe pas |

Sans capteur (ordinateur), un message le dit après 2,5 s sans mesure. Sans cap absolu, la boussole est annoncée indisponible.

## 8. Notifications

- **Type** : notifications **push** (Web Push + VAPID, librairie `web-push` côté serveur), facultatives.
- **Permission** : demandée à l'appui sur « Activer les notifications », dans l'onglet Relevés, sous le texte qui explique à quoi elles servent. Jamais au chargement. En cas de refus, un message rappelle que l'état des relevés reste visible dans la liste.
- **Abonnement** : la page récupère la clé publique (`GET /api/push`), s'abonne (`pushManager.subscribe`) et dépose l'abonnement au serveur (`PUT /api/push`), rattaché à l'identifiant de l'appareil.
- **Contenu** : « Relevés synchronisés », envoyée quand le serveur reçoit un relevé dont un premier envoi avait échoué (entrée de l'outbox marquée `differe`, signalée par l'en-tête `X-Differe` de `sync.js`). C'est le cas utile : Background Sync a envoyé l'outbox alors que l'app était fermée, et rien d'autre ne le dirait à l'utilisateur. Un même `tag` regroupe la série en une seule notification.
- **Au clic** : l'app est ramenée au premier plan (ou ouverte) sur l'onglet Relevés.
- **Abonnement expiré** : si le service de push répond 404 ou 410, le serveur supprime l'abonnement.

## 9. Visibilité : SEO et agents IA

- **Dans le HTML initial** : titre, description, le guide complet (six sections) et la structure des outils. **Absent** : les relevés, privés, qui ne vivent que dans IndexedDB.
- `<title>`, description, `canonical`, Open Graph, JSON-LD `WebApplication`.
- `robots.txt` : tout est ouvert sauf `/api/`. GPTBot, ClaudeBot et PerplexityBot autorisés (le guide gagne à être cité) ; Google-Extended et CCBot refusés (entraînement sans citation en retour).
- `sitemap.xml`, `llms.txt`, et `outils.md`, jumelle Markdown du guide servie avec `X-Robots-Tag: noindex`.

## 10. Sécurité et vie privée

- **Sur l'appareil** : relevés, étalonnage, identifiant aléatoire.
- **Au serveur** : les relevés enregistrés et, si l'utilisateur l'a activé, son abonnement push, rattachés à cet identifiant. Ni compte, ni position, ni donnée brute des capteurs.
- **Secrets** : aucun côté client ni dans le dépôt. La clé privée VAPID est une variable d'environnement Netlify (`.env` ignoré par Git en local) ; seule la clé publique est servie au navigateur. Netlify Blobs est accessible à la fonction sans clé à configurer.
- **Abonnement push** : le serveur n'accepte que les adresses des services de push des navigateurs, pour ne pas envoyer de requête vers une URL choisie par un client.
- **Serveur** : chaque relevé est validé et recopié champ par champ (types, taille, note limitée à 140 caractères).
- **Affichage** : les notes sont insérées avec `textContent`, jamais `innerHTML`.
- **En-têtes** (`_headers`) : CSP `default-src 'self'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` limitée aux capteurs utilisés.

## 11. Mesures

Vérifications `curl` sur l'URL de production, le 12 octobre 2026 :

| Vérification | Résultat |
|---|---|
| `curl -s -A "GPTBot" <url>/ \| grep -c "<h3>"` | 6 : les six sections du guide sont dans le HTML initial |
| `robots.txt`, `sitemap.xml`, `llms.txt` | 200 pour les trois |
| `curl -sI <url>/outils.md` | `text/markdown`, `X-Robots-Tag: noindex` |
| `curl -sI <url>/sw.js` | `Cache-Control: no-cache` |
| `http://` | redirigé en 301 vers `https://` |
| `PUT` puis `GET` puis `DELETE` sur `/api/releves` | 200, relevé relu, 204 |

Lighthouse (mobile) : à compléter — performance, accessibilité, bonnes pratiques, SEO, et les Core Web Vitals (LCP, CLS, INP).

## 12. Limites connues et suite

- L'identifiant d'appareil sert de seul contrôle d'accès : qui le connaît peut lire les relevés correspondants. L'API n'a ni authentification ni limite de débit.
- Background Sync n'existe que sur Chromium ; ailleurs, l'envoi attend la réouverture de l'app.
- Push : sur iPhone, seulement si l'app est installée sur l'écran d'accueil (iOS 16.4+). Un seul abonnement par appareil.
- La boussole dépend du navigateur : `webkitCompassHeading` sur iOS, `deviceorientationabsolute` sur Android. Elle donne le nord magnétique, sans correction de déclinaison.
- `CACHE_NAME` s'incrémente à la main.
- v2 : géolocalisation des relevés, export, restauration des relevés depuis le serveur.
