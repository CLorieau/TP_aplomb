import { getStore } from "@netlify/blobs";
import { creerPush } from "../../api/push.mjs";
import { traiter } from "../../api/releves.mjs";

// Clés VAPID : variables d'environnement du site Netlify (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
const push = creerPush(process.env);

// Netlify Blobs : stockage clé-valeur fourni avec le site, sans base de données à créer ni secret à configurer.
export default (request) => {
  const blobs = getStore({ name: "releves", consistency: "strong" });
  const stockage = {
    lire: (cle) => blobs.get(cle, { type: "json" }),
    ecrire: (cle, valeur) => blobs.setJSON(cle, valeur),
    supprimer: (cle) => blobs.delete(cle),
    lister: async (prefixe) => (await blobs.list({ prefix: prefixe })).blobs.map((b) => b.key),
  };
  return traiter(request, stockage, push);
};

export const config = { path: ["/api/releves", "/api/releves/:id", "/api/push"] };
