// Liste des groupes de professions proposés dans « Réglages » (cahier des charges 4.13, décision D-4).
// La liste vient de protocoles/_commun/professions.json (clé « groupes » ou « professions », entrées { id, libelle }) : le code ne
// contient aucun libellé de profession. `config/structure.json` (professions_presentes) peut restreindre la liste.

/** @returns {Promise<{id: string, libelle: string}[]>} liste vide si le fichier est absent ou illisible (jamais d'exception) */
export async function chargerGroupes({ structure } = {}) {
  let liste = [];
  try {
    const reponse = await fetch('protocoles/_commun/professions.json');
    if (reponse.ok) {
      const json = await reponse.json();
      const brute = Array.isArray(json?.groupes) ? json.groupes : Array.isArray(json?.professions) ? json.professions : [];
      liste = brute.filter((g) => g && typeof g.id === 'string' && g.id !== '').map((g) => ({ id: g.id, libelle: typeof g.libelle === 'string' && g.libelle !== '' ? g.libelle : g.id }));
    }
  } catch { /* liste vide */ }
  return filtrerGroupes(liste, structure?.donnees?.professions_presentes);
}

/** Restreint aux groupes présents dans la structure ; une liste absente ou vide de la structure ne restreint rien. */
export function filtrerGroupes(groupes, presentes) {
  if (!Array.isArray(presentes) || presentes.length === 0) return groupes;
  const filtre = groupes.filter((g) => presentes.includes(g.id));
  return filtre.length > 0 ? filtre : groupes;
}
