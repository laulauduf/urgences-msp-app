// Chargement de config/structure.json avec TOLÉRANCE (cahier des charges 3.2) : un champ manquant ou mal formé ne provoque jamais
// un écran blanc ni un blocage ; le champ s'affiche « non renseigné » là où il est attendu, et le problème est signalé dans la
// ligne d'état de préparation. Un fichier illisible en entier : l'appli fonctionne sans structure.

export const NON_RENSEIGNE = 'non renseigné';
export const TEXTE_STRUCTURE_ILLISIBLE = 'Configuration de la structure illisible';

/** Champs sans lesquels le mode transmission serait incomplet (liste minimale du lot L2 ; L7 l'étend au besoin). */
const CHAMPS_ATTENDUS = ['structure.nom', 'adresse.ligne1', 'adresse.commune', 'numero_rappel'];

const aRemplir = (v) => typeof v === 'string' && /^À REMPLIR/.test(v.trim());

/** Valeur d'un chemin « adresse.commune » dans l'objet ; undefined si absent. */
function lireChemin(objet, chemin) {
  return chemin.split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), objet);
}

/**
 * Analyse un objet déjà lu. Renvoie { donnees, illisible, manquants, texte(chemin) }.
 * `texte(chemin)` renvoie toujours une chaîne : la valeur, ou « non renseigné ».
 */
export function analyserStructure(donnees) {
  const illisible = donnees === null || typeof donnees !== 'object' || Array.isArray(donnees);
  const objet = illisible ? {} : donnees;
  const texte = (chemin) => {
    const v = lireChemin(objet, chemin);
    if (v === undefined || v === null) return NON_RENSEIGNE;
    if (typeof v !== 'string' && typeof v !== 'number') return NON_RENSEIGNE;
    const t = String(v).trim();
    return t === '' || aRemplir(t) ? NON_RENSEIGNE : t;
  };
  const manquants = illisible ? [] : CHAMPS_ATTENDUS.filter((c) => texte(c) === NON_RENSEIGNE);
  return { donnees: objet, illisible, manquants, texte };
}

/** Charge et analyse le fichier. Ne lève jamais d'exception. */
export async function chargerStructure(url = 'config/structure.json') {
  try {
    const reponse = await fetch(url);
    if (!reponse.ok) return analyserStructure(null);
    return analyserStructure(await reponse.json());
  } catch {
    return analyserStructure(null);
  }
}

/** Phrase à placer dans la ligne d'état de préparation, ou null si tout est renseigné. */
export function problemeStructure(analyse) {
  if (analyse.illisible) return TEXTE_STRUCTURE_ILLISIBLE;
  if (analyse.manquants.length > 0) return `Configuration de la structure : ${analyse.manquants.length} champ(s) non renseigné(s) (${analyse.manquants.join(', ')})`;
  return null;
}
