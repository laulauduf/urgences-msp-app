// Écran « À propos » (cahier des charges 4.15) : textes et modèles PURS, sans DOM. Présentation SOBRE : aucune revendication diagnostique ni thérapeutique
// (la présentation fixe la « destination » de l'appli et pèse plus lourd que l'avertissement — étude réglementaire § 1.2 et 1.9). Rien n'est inventé :
// ce qui n'existe pas encore (mention d'information du patient, versions minimales d'iOS et d'Android) est DIT absent. Aucune donnée de patient ici.
import { AVERTISSEMENT_PRESSE_PAPIERS, AVERTISSEMENT_SAUVEGARDE } from './export.js';

export const AVERTISSEMENT_GENERAL = "Cette appli ne remplace ni la formation, ni le jugement clinique, ni la régulation.";
export const INFO_PATIENT = "Mention d'information du patient (RGPD art. 13-14, L1110-4 IV) : à rédiger avec le DPO — pas encore disponible dans cette version (À VALIDER).";
export const VERSIONS_MINIMALES = "Versions minimales d'iOS et d'Android : non établies, à mesurer sur appareils (Q-4).";
export const RAPPEL_DONNEES = "L'appli ne contient aucune donnée de patient dans ses fichiers publiés ; les fiches restent sur cet appareil.";

/** Fuites que l'appli ne peut pas empêcher (2.9, 2.11, 4.6) : une phrase chacune. */
export const FUITES = [
  `${AVERTISSEMENT_PRESSE_PAPIERS}.`,
  "Le clavier du téléphone peut apprendre ce qui est tapé dans les champs de saisie (dictionnaire), malgré les réglages de l'appli.",
  "Le sélecteur d'applis du téléphone peut garder une image de l'écran, donc de la fiche affichée.",
  `${AVERTISSEMENT_SAUVEGARDE.replace(/\.$/, '')}.`,
];

/**
 * Choix PROVISOIRES de l'appli (comportements, pas contenu médical), chacun « provisoire — non validé par le médecin référent » tant que Laurent ne l'a pas validé.
 * Ceux du protocole se lisent dans `decisions_appliquees`. Tenir cette liste à jour à chaque nouveau choix provisoire (passation § 9).
 */
export const CHOIX_PROVISOIRES_APPLI = [
  { id: 'Q-26', texte: "Reprise directe d'une fiche réelle en cours utilisée il y a moins de 2 heures." },
  { id: 'Q-28', texte: "Délai d'effacement automatique réglable de 8 h à 24 h (plancher de 8 h)." },
  { id: 'D-23', texte: "À l'ouverture, une fiche en cours utilisée il y a moins de 2 heures est signalée (bandeau), pas effacée." },
  { id: 'D-24', texte: "« Réinitialiser l'appli » est refusée hors ligne (l'appli ne pourrait plus se rouvrir)." },
  { id: 'D-25', texte: "Les étapes vitales du premier écran ne sont jamais filtrées par profession." },
  { id: 'Q-31', texte: "Un geste non cochable pour la profession réglée se note « fait à hh:mm » ; une profession non réglée applique le groupe le plus restreint." },
  { id: 'L8', texte: "Document d'export daté ; « Montrer au SMUR » en lecture seule, compté comme remise ; avertissement de sauvegarde affiché avec celui du partage." },
  { id: 'L7c', texte: "Libellé « TRANSM. » du bouton de transmission en situation « Autre » (libellé définitif à décider)." },
];

/** Statut du protocole : « validé par … le … » SEULEMENT si le statut est validé ET le nom ET la date existent ; sinon BROUILLON (D-18). */
export function statutProtocole(p) {
  const valide = p?.statut_validation && p.statut_validation !== 'BROUILLON';
  if (valide && typeof p.validateur === 'string' && p.validateur.trim() !== '' && typeof p.date_validation === 'string' && p.date_validation.trim() !== '') {
    return `validé par ${p.validateur.trim()} le ${p.date_validation.trim()}`;
  }
  return 'BROUILLON — non validé par le médecin référent';
}

/** Choix provisoires portés par le protocole : « D-6 — objet ». */
export function choixProvisoiresProtocole(p) {
  return (Array.isArray(p?.decisions_appliquees) ? p.decisions_appliquees : []).filter((d) => d?.etat === 'PROVISOIRE').map((d) => `${d.decision} — ${d.objet}`);
}

/** Prise en charge du verrou d'écran et de la vibration sur CET appareil, lue telle quelle. */
export function lignesCapacites(nav = globalThis.navigator) {
  return [`Verrou d'écran : ${nav && 'wakeLock' in nav ? 'pris en charge' : 'non pris en charge'}`, `Vibration : ${nav && 'vibrate' in nav ? 'prise en charge' : 'non prise en charge'}`];
}
