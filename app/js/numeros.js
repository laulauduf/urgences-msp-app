// Numéros d'urgence du panneau d'alerte (cahier des charges 4.7, 3.2). Les numéros viennent de protocoles/_commun/numeros.json, surchargés
// au besoin par config/structure.json (numeros_urgence). Seuls le 15 et le 112 (numéros CITÉS, mêmes que l'écran de secours) sont
// repris en dur si le fichier est absent ou illisible : le panneau d'alerte doit TOUJOURS pouvoir appeler.

export const NUMEROS_PAR_DEFAUT = Object.freeze([
  { id: 'samu', numero: '15', libelle: 'SAMU', moyens: ['tel'], plan: 'A', bascule: null, marqueBascule: false },
  { id: 'urgence-europeenne', numero: '112', libelle: "Numéro d'urgence européen", moyens: ['tel'], plan: 'B', bascule: null, marqueBascule: false },
]);

const valeur = (v) => (v !== null && typeof v === 'object' && Object.hasOwn(v, 'valeur') ? v.valeur : v);
const texte = (v) => (typeof v === 'string' ? v : v !== null && typeof v === 'object' && typeof v.texte === 'string' ? v.texte : null);
/** Un contenu sans source (A_VALIDER) ou fixé par un choix provisoire porte une marque visible. */
const aMarque = (v) => v !== null && typeof v === 'object' && (v.statut === 'A_VALIDER' || typeof v.provisoire === 'string');

/**
 * @param {object|null} fichier contenu de numeros.json (ou null)
 * @param {object|null} structure analyse de structure.json (structure.js) : surcharge facultative `numeros_urgence`
 * @returns {{numeros: object[], rappels: object[]}}
 *   numeros : [{id, numero, libelle, moyens, plan, bascule, marqueBascule}] — plan A en tête, puis B, puis les autres
 */
export function lireNumeros(fichier, structure = null) {
  const brutes = Array.isArray(fichier?.numeros) ? fichier.numeros : [];
  let numeros = brutes
    .filter((n) => n && typeof n.numero === 'string' && /^\d{2,6}$/.test(n.numero))
    .map((n) => ({
      id: String(n.id ?? n.numero),
      numero: n.numero,
      libelle: typeof n.libelle === 'string' ? n.libelle : n.numero,
      moyens: Array.isArray(n.moyens) && n.moyens.length > 0 ? n.moyens : ['tel'],
      plan: valeur(n.plan) ?? null,
      bascule: texte(n.bascule),
      marqueBascule: aMarque(n.bascule),
      autresMoyens: texte(n.autres_moyens),            // m2 (revue aval) : application, visio, tchat… du 114, lus tels quels dans le fichier
      marqueAutresMoyens: aMarque(n.autres_moyens),
    }));
  // la structure peut surcharger libellés et plans (numeros_urgence : {numero, libelle, plan, sms?})
  const surcharges = Array.isArray(structure?.donnees?.numeros_urgence) ? structure.donnees.numeros_urgence : [];
  for (const s of surcharges) {
    if (typeof s?.numero !== 'string' || !/^\d{2,6}$/.test(s.numero)) continue;
    const existant = numeros.find((n) => n.numero === s.numero);
    if (existant) { if (typeof s.libelle === 'string') existant.libelle = s.libelle; if (typeof s.plan === 'string') existant.plan = s.plan; }
    else numeros.push({ id: `structure-${s.numero}`, numero: s.numero, libelle: typeof s.libelle === 'string' ? s.libelle : s.numero, moyens: s.sms ? ['sms'] : ['tel'], plan: typeof s.plan === 'string' ? s.plan : null, bascule: null, marqueBascule: false });
  }
  // filet de sécurité : le 15 et le 112 existent toujours
  for (const defaut of NUMEROS_PAR_DEFAUT) if (!numeros.some((n) => n.numero === defaut.numero)) numeros.push({ ...defaut });
  const rang = (n) => (n.plan === 'A' ? 0 : n.plan === 'B' ? 1 : 2);
  numeros = numeros.map((n, i) => ({ n, i })).sort((a, b) => rang(a.n) - rang(b.n) || a.i - b.i).map(({ n }) => n);

  const rappels = (Array.isArray(fichier?.rappels) ? fichier.rappels : [])
    .filter((r) => r && typeof r.texte === 'string')
    .map((r) => ({ id: String(r.id ?? r.texte), texte: r.texte, marque: aMarque(r) }));
  return { numeros, rappels };
}

/** Lien d'appel : `tel:` pour un appel, `sms:` pour le 114 (SMS) — sans `target` (un lien `tel:` simple, étude § 1). */
export function lienDe(numero, moyen) { return `${moyen === 'sms' ? 'sms' : 'tel'}:${numero}`; }

/** Charge numeros.json ; ne lève jamais d'exception (null si absent ou illisible). */
export async function chargerNumeros(url = 'protocoles/_commun/numeros.json') {
  try {
    const reponse = await fetch(url);
    return reponse.ok ? await reponse.json() : null;
  } catch { return null; }
}
