// Serveur de développement, sans dépendance : sert public/ et la même API qu'en production.
// En production, Netlify sert public/ et netlify/functions/releves.mjs ; ce fichier n'y est pas utilisé.
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { traiter } from "./api/releves.mjs";

const PORT = process.env.PORT || 8080;
const RACINE = fileURLToPath(new URL("./public", import.meta.url));
const DONNEES = fileURLToPath(new URL("./.data/releves.json", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Mêmes en-têtes que public/_headers.
const EN_TETES = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-cache",
};

// Stockage local : un fichier JSON { clé: relevé }, à la place de Netlify Blobs.
const charger = async () => JSON.parse(await readFile(DONNEES, "utf8").catch(() => "{}"));
const sauver = async (tout) => {
  await mkdir(join(DONNEES, ".."), { recursive: true });
  await writeFile(DONNEES, JSON.stringify(tout, null, 2));
};
const stockage = {
  lire: async (cle) => (await charger())[cle] ?? null,
  ecrire: async (cle, valeur) => sauver({ ...(await charger()), [cle]: valeur }),
  supprimer: async (cle) => {
    const tout = await charger();
    delete tout[cle];
    await sauver(tout);
  },
  lister: async (prefixe) => Object.keys(await charger()).filter((cle) => cle.startsWith(prefixe)),
};

async function repondreApi(req, res) {
  const morceaux = [];
  for await (const morceau of req) morceaux.push(morceau);
  const avecCorps = !["GET", "HEAD"].includes(req.method);
  const reponse = await traiter(
    new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: avecCorps ? Buffer.concat(morceaux) : undefined,
    }),
    stockage,
  );
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
}

async function repondreFichier(chemin, res) {
  const fichier = join(RACINE, decodeURIComponent(chemin.endsWith("/") ? `${chemin}index.html` : chemin));
  if (!fichier.startsWith(RACINE + sep)) return res.writeHead(403).end();
  try {
    const contenu = await readFile(fichier);
    const enTetes = { ...EN_TETES, "Content-Type": TYPES[extname(fichier)] ?? "application/octet-stream" };
    if (fichier.endsWith(".md")) enTetes["X-Robots-Tag"] = "noindex";
    res.writeHead(200, enTetes).end(contenu);
  } catch {
    res.writeHead(404, { ...EN_TETES, "Content-Type": "text/plain; charset=utf-8" }).end("Page introuvable");
  }
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/api/")) await repondreApi(req, res);
    else await repondreFichier(pathname, res);
  } catch (erreur) {
    console.error(erreur);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, () => console.log(`Aplomb : http://localhost:${PORT}`));
