// Glossaire (cahier des charges 4.12, décisions D-10 et D-20 / Q-16). Fonctions PURES, sauf le chargement du fichier.
// Le contenu vient de protocoles/_commun/glossaire.json ; le code n'en contient aucun (ni sigle, ni signification, ni source).
import { MARQUE_PROVISOIRE } from './horloge.js';

export const MARQUE_SIGLE_NON_SOURCE = 'sigle non trouvé dans les sources autorisées : écrit en toutes lettres';

/** @returns {{liste: object[], parId: Map<string, object>}} entrées dans l'ordre du fichier ; contenu inutilisable → liste vide */
export function lireGlossaire(json) {
  const brutes = Array.isArray(json?.entrees) ? json.entrees : Array.isArray(json?.acronymes) ? json.acronymes : [];
  const liste = []; const parId = new Map();
  for (const e of brutes) {
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || e.id === '' || parId.has(e.id)) continue;
    parId.set(e.id, e); liste.push(e);
  }
  return { liste, parId };
}

/**
 * Marques à afficher à côté d'une entrée : statut A_VALIDER, marque « provisoire » SI ET SEULEMENT SI l'entrée porte `provisoire`,
 * et, pour un sigle écrit en toutes lettres (aucune source autorisée du sigle), la mention de D-10.
 */
export function marquesEntree(entree) {
  const marques = [];
  if (entree?.statut === 'A_VALIDER') marques.push('A_VALIDER');
  if (typeof entree?.provisoire === 'string') marques.push(MARQUE_PROVISOIRE);
  if (entree?.affichage === 'toutes_lettres') marques.push(MARQUE_SIGLE_NON_SOURCE);
  return marques;
}

/** Charge le glossaire ; liste vide (jamais d'exception) si le fichier est absent ou illisible. */
export async function chargerGlossaire({ dossier = 'protocoles/_commun' } = {}) {
  try {
    const reponse = await fetch(`${dossier}/glossaire.json`);
    if (!reponse.ok) return lireGlossaire(null);
    return lireGlossaire(await reponse.json());
  } catch { return lireGlossaire(null); }
}
