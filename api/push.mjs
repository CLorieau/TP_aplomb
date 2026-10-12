// Envoi des notifications push avec web-push (protocole Web Push + signature VAPID).
// Séparé de releves.mjs pour que le serveur local démarre aussi sans `npm install`.
import webpush from "web-push";

// Les clés viennent de l'environnement (Netlify, ou .env en local) : la clé privée n'est jamais dans le dépôt.
// Renvoie null si elles manquent : l'API répond alors 503 et le reste de l'app fonctionne.
export function creerPush(env) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  // Le « sujet » identifie l'expéditeur auprès du service de push (une URL ou un mailto:).
  const sujet = env.VAPID_SUBJECT || env.URL || "https://playful-kataifi-da7d5a.netlify.app";
  const vapidDetails = { subject: sujet, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };

  return {
    clePublique: VAPID_PUBLIC_KEY,
    // TTL : le service de push garde le message une heure si le téléphone est éteint ou hors réseau.
    envoyer: (abonnement, message) =>
      webpush.sendNotification(abonnement, JSON.stringify(message), { vapidDetails, TTL: 3600 }),
  };
}
