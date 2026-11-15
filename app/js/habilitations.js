// Filtre par profession (cahier des charges 4.5, 4.13 ; décisions D-4, D-20 / Q-6, Q-22, Q-30). Fonctions PURES, sauf le chargement du fichier.
// RÈGLE DE FOND : le code ne décide JAMAIS d'un geste. Il lit ce que disent les données — `professions` de l'étape et
// protocoles/_commun/professions.json — et, au moindre doute (donnée absente, geste ou groupe inconnu, valeur inattendue, fichier illisible),
// il répond « A_VALIDER » : jamais « oui ». Aucun libellé ni aucune habilitation de profession n'est écrit ici.

export const OUI = 'oui';
export const NON = 'non';
export const A_VALIDER = 'A_VALIDER';

const estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Lit le contenu de professions.json. Renvoie null si le contenu est inutilisable.
 * @returns {{groupes: string[], gestes: Record<string, object>, comportementNonReglee: string|null}|null}
 */
export function lireHabilitations(json) {
  if (!estObjet(json)) return null;
  const brutes = Array.isArray(json.groupes) ? json.groupes : Array.isArray(json.professions) ? json.professions : [];
  const groupes = brutes.filter((g) => estObjet(g) && typeof g.id === 'string' && g.id !== '').map((g) => g.id);
  const libelles = Object.fromEntries(brutes.filter((g) => estObjet(g) && typeof g.id === 'string' && typeof g.libelle === 'string').map((g) => [g.id, g.libelle]));
  const gestes = {};
  if (Array.isArray(json.gestes)) {
    for (const g of json.gestes) if (estObjet(g) && typeof g.id === 'string' && g.id !== '' && estObjet(g.habilitations) && !(g.id in gestes)) gestes[g.id] = g.habilitations;
  }
  const comportement = json.profession_non_reglee?.comportement;
  return { groupes, libelles, gestes, comportementNonReglee: typeof comportement === 'string' && comportement !== '' ? comportement : null };
}

/**
 * Groupe dont on applique les habilitations. Profession non réglée — ou réglée sur un groupe qui n'existe plus — : le comportement indiqué par
 * les données (le groupe le plus restreint, Q-22 / Q-30) ; aucun groupe n'est jamais deviné (→ null : tout est alors restrictif).
 */
export function groupeEffectif(profession, donnees) {
  const groupes = donnees?.groupes ?? [];
  if (typeof profession === 'string' && profession !== '' && groupes.includes(profession)) return profession;
  const repli = donnees?.comportementNonReglee ?? null;
  return repli !== null && groupes.includes(repli) ? repli : null;
}

/** Valeur d'une restriction : « oui » / « non » exacts, simples ou enveloppés ({valeur}) ; tout le reste vaut « A_VALIDER ». */
function lireValeur(brute) {
  const v = estObjet(brute) ? brute.valeur : brute;
  if (v === OUI && estObjet(brute) && brute.statut === A_VALIDER) return A_VALIDER;   // donnée incohérente (« oui » dont le statut dit qu'il n'est pas établi) : jamais « oui » (revue L6 m3)
  return v === OUI || v === NON ? v : A_VALIDER;
}

/**
 * Ce que dit professions.json de l'habilitation d'une étape pour la profession courante (revue L6 m4) : groupe appliqué, valeur, statut et texte
 * de la restriction (sources, raisonnement, a_valider). null quand il n'y a rien à détailler (« tous », geste ou groupe inconnu).
 */
export function detailHabilitation(etape, profession, donnees) {
  const p = etape?.professions;
  if (!estObjet(p)) return null;
  const groupe = groupeEffectif(profession, donnees);
  if (groupe === null) return null;
  const brute = 'geste' in p ? donnees?.gestes?.[p.geste]?.[groupe] : p[groupe];
  if (!estObjet(brute)) return null;
  return {
    groupe, valeur: habilitationPour(etape, profession, donnees), statut: typeof brute.statut === 'string' ? brute.statut : null,
    sources: Array.isArray(brute.sources) ? brute.sources : [], raisonnement: typeof brute.raisonnement === 'string' ? brute.raisonnement : null,
    a_valider: typeof brute.a_valider === 'string' ? brute.a_valider : null,
  };
}

/**
 * Habilitation d'une étape pour une profession : « oui », « non » ou « A_VALIDER ».
 * `professions` de l'étape : « tous » ; { geste } (renvoi à professions.json) ; ou { groupe: valeur } (restrictions portées par l'étape).
 */
export function habilitationPour(etape, profession, donnees) {
  const p = etape?.professions;
  if (p === 'tous') return OUI;
  if (!estObjet(p)) return A_VALIDER;
  const groupe = groupeEffectif(profession, donnees);
  if ('geste' in p) {
    if (typeof p.geste !== 'string' || p.geste === '' || groupe === null) return A_VALIDER;
    const h = donnees?.gestes?.[p.geste];
    return estObjet(h) && groupe in h ? lireValeur(h[groupe]) : A_VALIDER;
  }
  if (groupe === null || !(groupe in p)) return A_VALIDER;
  return lireValeur(p[groupe]);
}

/** Charge professions.json ; renvoie null (jamais d'exception) si le fichier est absent ou illisible. */
export async function chargerHabilitations({ dossier = 'protocoles/_commun' } = {}) {
  try {
    const reponse = await fetch(`${dossier}/professions.json`);
    if (!reponse.ok) return null;
    return lireHabilitations(await reponse.json());
  } catch { return null; }
}
