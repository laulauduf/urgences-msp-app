// Les entrées de l'accueil et du choix de situation : NOMS de navigation, pas du contenu médical (le contenu — étapes, précisions, chiffres, sources — vient seulement des fichiers
// `protocoles/*.json`). Chaque identifiant est celui d'un fichier de protocole ; un test vérifie que le fichier existe. Une entrée ne s'affiche que si son fichier est publié (la liste de cache),
// sauf l'ACR adulte (l'écran de secours le remplace s'il est illisible) : un fichier absent ne donne jamais un bouton qui mène à rien.
// CHOIX PROVISOIRE (D-15, P4a) : arrêt cardiaque en grandes tuiles rouges (adulte, puis enfant), les autres urgences en liste, « Autre situation » en dernier.

/** Protocoles de type ACR : écran avec métronome, cycle de 2 minutes, DAE. Le PREMIER est l'ACR par défaut (adulte). */
export const PROTOCOLES_ACR = [
  { id: 'acr-adulte-dae', titre: 'Arrêt cardiaque', sous: 'adulte · DAE', libelle: 'ACR adulte' },
  { id: 'acr-enfant', titre: 'Arrêt cardiaque', sous: 'enfant · nourrisson', libelle: 'ACR enfant' },
];

/** Conduites propres à une urgence (écran « Autre situation » avec leur checklist) : sans cycle, sans métronome. */
export const CONDUITES = [
  { id: 'douleur-thoracique', titre: 'Douleur thoracique', sous: 'adulte' },
  { id: 'avc', titre: 'AVC', sous: 'accident vasculaire cérébral' },
  { id: 'anaphylaxie', titre: 'Anaphylaxie', sous: 'réaction allergique grave' },
  { id: 'hypoglycemie', titre: 'Hypoglycémie', sous: 'adulte' },
];

/** Libellé de navigation d'un protocole (ACR ou conduite) ; null si l'identifiant est inconnu. */
export function titreDe(id) {
  const e = [...PROTOCOLES_ACR, ...CONDUITES].find((x) => x.id === id);
  return e ? e.titre : null;
}

/** Identifiants des ACR et des conduites (pour construire une intervention). */
export const IDS_ACR = PROTOCOLES_ACR.map((p) => p.id);
export const IDS_CONDUITES = CONDUITES.map((c) => c.id);
