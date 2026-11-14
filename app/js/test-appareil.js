// « Tester le son et l'écran » (cahier des charges 2.5, 2.6, 2.8) : UN seul geste de l'utilisateur pour contrôler le son, le verrou d'écran
// et demander la persistance du stockage. Jamais bloquant ; le résultat alimente la ligne d'état de préparation (4.1) et « À propos ».
// La persistance est demandée ICI et pas au toucher URGENCE : Firefox affiche alors une demande d'autorisation, qui n'a rien à faire
// au milieu d'une urgence.

/**
 * @param {{son: import('./son.js').Son, ecran: import('./ecran-allume.js').EcranAllume, stockageNavigateur?: StorageManager}} options
 * @returns {Promise<{son: object, ecran: object, persistance: {prise_en_charge: boolean, persistant: boolean|null}}>}
 */
export async function testerSonEtEcran({ son, ecran, stockageNavigateur = globalThis.navigator?.storage }) {
  const resultatSon = son.tester();
  const resultatEcran = await ecran.controler();
  let persistance = { prise_en_charge: false, persistant: null };
  try {
    if (stockageNavigateur && typeof stockageNavigateur.persist === 'function') {
      const dejaPersistant = typeof stockageNavigateur.persisted === 'function' ? await stockageNavigateur.persisted() : false;
      const accorde = dejaPersistant || await stockageNavigateur.persist();
      persistance = { prise_en_charge: true, persistant: accorde === true };
    }
  } catch { persistance = { prise_en_charge: true, persistant: false }; }
  return { son: resultatSon, ecran: resultatEcran, persistance };
}
