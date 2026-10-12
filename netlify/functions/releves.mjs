import { getStore } from "@netlify/blobs";
import { traiter } from "../../api/releves.mjs";

// Netlify Blobs : stockage clé-valeur fourni avec le site, sans base de données à créer ni secret à configurer.
export default (request) => {
  const blobs = getStore({ name: "releves", consistency: "strong" });
  return traiter(request, {
    lire: (cle) => blobs.get(cle, { type: "json" }),
    ecrire: (cle, valeur) => blobs.setJSON(cle, valeur),
    supprimer: (cle) => blobs.delete(cle),
    lister: async (prefixe) => (await blobs.list({ prefix: prefixe })).blobs.map((b) => b.key),
  });
};

export const config = { path: ["/api/releves", "/api/releves/:id"] };
