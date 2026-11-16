// Les actions VITALES de la barre du bas (revue R1, M2 et M4 ; règle absolue 5 : « le premier écran affiche les actions vitales »). CHOIX PROVISOIRE du code 4 (15/11/2026,
// à faire confirmer par Laurent) : la barre porte « Masser » (démarre le métronome et le chronomètre), « Appeler le 15 » et « DAE » (coche l'étape et lance le cycle de
// 2 minutes, où l'on note analyses et chocs), plus « Fiche ». FONCTION PURE : elle choisit ces étapes DANS LE PROTOCOLE (aucun libellé ni identifiant médical en dur) ;
// pour changer ce que fait la barre, on ne modifie que ce fichier.
//   - Masser : la première étape du premier écran qui démarre le métronome (`declenche.metronome`) ;
//   - Appeler : l'étape qui se coche au premier appel (`cochage_auto: 'appel'`) ;
//   - DAE : parmi les autres étapes du premier écran, la dernière qui suit « Masser » dans l'ordre du protocole (« Faire apporter le DAE », avant « Masser », n'en fait pas partie).
// Le libellé du bouton est `libelle_barre` si l'étape le porte (champ optionnel), sinon son `texte_court`.

/** @param {object[]} etapesPremierEcran étapes `premier_ecran` triées par `ordre` @returns {{alerter: object|null, masser: object|null, dae: object|null}} */
export function actionsVitales(etapesPremierEcran) {
  // V1, N4 (revue des correctifs P4d) : la barre appelle `toucherTuile` SANS la confirmation « sur demande du 15 » (D-58) ; une étape réservée aux habilités n'est donc JAMAIS une action de la barre,
  // même si elle est la dernière étape du premier écran ou porte `barre`
  const etapes = (Array.isArray(etapesPremierEcran) ? etapesPremierEcran : []).filter((e) => e?.reserve_habilites !== true);
  const alerter = etapes.find((e) => e.cochage_auto === 'appel') ?? null;
  // r3 : un champ EXPLICITE `barre: "masser" | "dae"` du protocole l'emporte ; à défaut, la déduction ci-dessous (à ne plus utiliser une fois le champ posé)
  const masser = etapes.find((e) => e.barre === 'masser') ?? etapes.find((e) => e.declenche?.metronome === 'demarrer') ?? null;
  const restantes = etapes.filter((e) => e !== alerter && e !== masser && masser !== null && e.ordre > masser.ordre);
  const dae = etapes.find((e) => e.barre === 'dae') ?? restantes.at(-1) ?? null;
  return { alerter, masser, dae };
}

/** Libellé court d'une action de la barre : `libelle_barre`, sinon `texte_court`. */
export function libelleBarre(etape) {
  return typeof etape?.libelle_barre === 'string' && etape.libelle_barre.trim() !== '' ? etape.libelle_barre.trim() : (etape?.texte_court ?? '');
}
