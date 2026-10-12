// Envoi de l'outbox au serveur. Même code pour les deux chemins :
// - le Service Worker, réveillé par Background Sync (Chromium) ;
// - la page, au démarrage, à l'événement "online" et sur le bouton « Synchroniser » (repli universel).
// Nécessite db.js.

// Réponses après lesquelles réessayer ne changerait rien : la requête est retirée de l'outbox.
const REFUS_DEFINITIFS = [400, 413];

async function envoyerOutbox() {
  const deviceId = await getDeviceId();
  let traites = 0;

  for (const item of await DB.getAll("outbox")) { // triés par seq : l'ordre des actions est respecté
    const suppression = item.op === "delete";
    // Un échec réseau fait lever fetch : on s'arrête là, le reste de l'outbox attend le prochain essai.
    const res = await fetch(`/api/releves/${item.id}`, {
      method: suppression ? "DELETE" : "PUT", // PUT avec l'id du client : rejouer la requête ne crée pas de doublon
      headers: { "Content-Type": "application/json", "X-Device-Id": deviceId },
      body: suppression ? undefined : JSON.stringify(item.releve),
    });
    if (!res.ok && !REFUS_DEFINITIFS.includes(res.status)) {
      throw new Error(`Serveur indisponible (${res.status})`);
    }

    await DB.transaction(["releves", "outbox"], "readwrite", (releves, outbox) => {
      outbox.delete(item.seq);
      if (suppression) return;
      const lecture = releves.get(item.id);
      lecture.onsuccess = () => {
        // Absent si l'utilisateur l'a supprimé entre-temps : la suppression suit dans l'outbox.
        if (lecture.result) releves.put({ ...lecture.result, etat: res.ok ? "envoye" : "refuse" });
      };
    });
    traites++;
  }
  return traites;
}

// La page et le Service Worker peuvent se déclencher en même temps : un verrou évite les envois en double.
function syncOutbox() {
  return "locks" in navigator ? navigator.locks.request("aplomb-sync", envoyerOutbox) : envoyerOutbox();
}
