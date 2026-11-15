// « Tester le son et l'écran » (cahier des charges 2.5, 2.6, 2.8) : UN seul geste de l'utilisateur pour contrôler le son, le verrou d'écran
// et demander la persistance du stockage. Jamais bloquant ; le résultat alimente la ligne d'état de préparation (4.1) et « À propos ».
// La persistance est demandée ICI et pas au toucher URGENCE : Firefox affiche alors une demande d'autorisation, qui n'a rien à faire
// au milieu d'une urgence.

/**
 * @param {{son: import('./son.js').Son, ecran: import('./ecran-allume.js').EcranAllume, stockageNavigateur?: StorageManager}} options
 * @returns {Promise<{son: object, ecran: object, persistance: {prise_en_charge: boolean, persistant: boolean|null}}>}
 */
/**
 * Le bip a-t-il été ENTENDU et confirmé par l'utilisateur dans cette session ? (revue R1, M1) : le contexte audio « running » ne prouve PAS que le son sort (bug WebKit, mode silencieux de
 * l'iPhone : cahier 2.6) ; seule la réponse « Oui, j'ai entendu » lève l'avertissement « Son » de l'intervention.
 */
export const etatTest = { son: false };
/** Réponse de l'utilisateur à « Avez-vous entendu le bip ? ». */
export function confirmerSon(entendu) { etatTest.son = entendu === true; }

export async function testerSonEtEcran({ son, ecran, stockageNavigateur = globalThis.navigator?.storage }) {
  const resultatSon = son.tester();
  etatTest.son = false;   // un nouveau test remet la confirmation à faire
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

/**
 * Le résultat du test, en points de la ligne d'état de préparation (4.1) : « Son testé », « Écran maintenu allumé », « Stockage persistant ».
 * Un point est « ok » seulement si ce qui a été MESURÉ l'est ; le son qui sort réellement n'est pas mesurable (bug WebKit, cahier 2.6) : le point le dit.
 * @returns {{son: {texte: string, ok: boolean}, ecran: {texte: string, ok: boolean}, persistance: {texte: string, ok: boolean}}}
 */
export function pointsDuTest(r) {
  const sonOk = r.son.contexte === 'running' && r.son.canal !== 'aucun';
  const son = sonOk
    ? { ok: true, texte: `Son testé (contexte ${r.son.contexte}, canal ${r.son.canal}) — l'appli ne peut pas savoir si le son sort : vérifiez le volume média et le mode silencieux` }
    : { ok: false, texte: `Son : le test n'a pas démarré le son (contexte ${r.son.contexte}, canal ${r.son.canal}) — touchez l'écran puis recommencez` };
  const ecran = r.ecran.accorde
    ? { ok: true, texte: 'Écran maintenu allumé : verrou accordé' }
    : { ok: false, texte: `Écran : verrou non accordé — ${r.ecran.avertissement ?? "il peut s'éteindre"}` };
  const persistance = r.persistance.persistant === true
    ? { ok: true, texte: 'Stockage persistant accordé' }
    : r.persistance.prise_en_charge === false
      ? { ok: false, texte: 'Stockage persistant : non pris en charge par ce navigateur (état inconnu)' }
      : { ok: false, texte: "Stockage non persistant : le navigateur n'a pas accordé la protection contre l'effacement automatique" };
  return { son, ecran, persistance };
}

/** La phrase du test (menu d'intervention et accueil) : ce que le téléphone a dit de lui-même. */
export function phraseDuTest(r) {
  const persistant = r.persistance.persistant === null ? 'inconnu' : r.persistance.persistant ? 'oui' : 'non';
  return `Son : ${r.son.contexte} (canal ${r.son.canal}) · Écran : ${r.ecran.accorde ? 'verrou accordé' : 'verrou non accordé'} · Stockage persistant : ${persistant}. Sur iPhone, l'alerte ne vibre pas : gardez l'écran en vue.`;
}
