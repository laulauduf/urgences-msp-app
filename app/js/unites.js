// Unités des constantes (décision D-26, 15/11/2026) : fonctions PURES, sauf le chargement du fichier.
// Le contenu vient de protocoles/_commun/unites.json ; le code n'en contient AUCUNE (comme le glossaire : le contenu est séparé du code).
// RÈGLE : l'unité est ajoutée à côté de la valeur saisie, qui est recopiée telle quelle — aucune conversion, aucun seuil, aucune couleur (D-19, R14).

const plein = (v) => typeof v === 'string' && v.trim() !== '';

/** @returns {{parType: Map<string, string>}} type de constante → unité ; contenu inutilisable → aucune unité (jamais d'exception) */
export function lireUnites(json) {
  const parType = new Map();
  for (const e of Array.isArray(json?.unites) ? json.unites : []) {
    if (e !== null && typeof e === 'object' && plein(e.id) && plein(e.unite) && !parType.has(e.id)) parType.set(e.id, e.unite.trim());
  }
  return { parType };
}

/** « valeur unité » ; sans unité, la valeur seule. La valeur n'est jamais modifiée. */
export const avecUnite = (valeur, unite) => (plein(unite) ? `${valeur} ${unite.trim()}` : String(valeur));

/** Charge les unités ; aucune unité si le fichier est absent ou illisible (la saisie n'en est jamais gênée). */
export async function chargerUnites({ dossier = 'protocoles/_commun' } = {}) {
  try {
    const reponse = await fetch(`${dossier}/unites.json`);
    if (!reponse.ok) return lireUnites(null);
    return lireUnites(await reponse.json());
  } catch { return lireUnites(null); }
}
