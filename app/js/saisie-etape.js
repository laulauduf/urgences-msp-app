// Saisie DANS une étape de recueil (lot G, décisions D-66 et D-69 variante A) : modèle PUR, sans DOM ni stockage.
// Une étape de recueil d'une conduite (« Heure de début », « Type de douleur », « Antécédents, traitements », « Constantes »…) porte dans le PROTOCOLE un champ `saisie`
// qui dit OÙ va le renseignement dans la fiche de la victime prise en charge : `{ "champ": "debut_signes", "puces": ["continue", "intermittente"] }`.
// Ce fichier est la table de correspondance (nom de champ → champ réel de la fiche, le MÊME que celui du volet « Fiche » : jamais deux copies d'une donnée).
// RÈGLES : aucun texte médical ici (les puces viennent du protocole, qui les reprend de ses propres textes ; `tests/controle-json.mjs`, règle R20, le vérifie) ;
// aucun calcul, aucun seuil (D-19) ; jamais pour une étape vitale ni pour une étape qui précède l'alerte (règle absolue 5 : rien ne s'interpose avant « Alerter », « Masser », le DAE).
import { victimePriseEnCharge, libelleVictime, mentionVictime, PUCES_ANTECEDENTS, PUCES_TRAITEMENTS, texteListe } from './victimes.js';
import { estVitale } from './checklist.js';
import { TYPES_CONSTANTE } from './bilan.js';
import { avecUnite } from './unites.js';

/**
 * Champs de fiche qu'une étape peut recueillir. `genre` : `texte` (une chaîne de la victime ouverte, éventuellement aidée de puces : chacune ajoute ou retire son texte de la chaîne),
 * `antecedents` (puces et texte libre d'antécédents et de traitements, comme le volet), `constantes` (valeurs brutes horodatées, comme le volet).
 * `heure` : le champ propose un bouton « Maintenant » (l'heure du téléphone, jamais calculée).
 */
export const CHAMPS_SAISIE = {
  debut_signes: { genre: 'texte', bloc: 'circonstances', cle: 'heure_debut', libelle: 'Heure de début des signes', heure: true },
  notes: { genre: 'texte', bloc: null, cle: 'notes', libelle: 'Notes' },
  antecedents_traitements: { genre: 'antecedents', libelle: 'Antécédents, traitements' },
  constantes: { genre: 'constantes', libelle: 'Constantes' },
};

const plein = (v) => typeof v === 'string' && v.trim() !== '';

/** Définition du champ visé par `saisie`, ou null (champ inconnu : l'étape reste une case ordinaire, rien n'est caché). */
export const champDe = (saisie) => (saisie && typeof saisie === 'object' && Object.hasOwn(CHAMPS_SAISIE, saisie.champ) ? CHAMPS_SAISIE[saisie.champ] : null);

/** Puces du protocole pour un champ texte : des chaînes non vides, sans doublon ; rien pour les autres genres. */
export function pucesDe(saisie) {
  const def = champDe(saisie);
  if (!def || def.genre !== 'texte' || !Array.isArray(saisie.puces)) return [];
  return [...new Set(saisie.puces.filter(plein).map((p) => p.trim()))];
}

/** Types de constantes proposés : tous ceux de la fiche, ou ceux que `saisie.types` retient (identifiants de TYPES_CONSTANTE). */
export function typesProposes(saisie) {
  const retenus = Array.isArray(saisie?.types) ? saisie.types : null;
  return TYPES_CONSTANTE.filter((t) => retenus === null || retenus.includes(t.id));
}

/** Morceaux du texte séparés par des virgules (conservé pour les tests ; ne sert plus à RÉÉCRIRE un texte : voir `occurrences`). */
export const jetons = (texte) => String(texte ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * M3 (revue de code du 16/11/2026) : une puce ou « Maintenant » AJOUTE (ou retire) seulement SA valeur ; le reste du texte libre reste mot pour mot (virgules décimales « 0,8 », heures déjà
 * écrites, espaces de l'utilisateur). Une « occurrence » d'une valeur est un morceau ENTIER : il commence au début du texte ou après « , » suivie d'une espace (jamais après la virgule d'un
 * « 0,8 »), et finit à la fin du texte ou avant « , » suivie d'une espace ou de la fin. La casse ne compte pas. Rend les positions de début.
 */
function occurrences(texte, valeur) {
  const t = String(texte ?? ''); const v = String(valeur ?? '').trim().toLowerCase();
  const bas = t.toLowerCase(); const out = [];
  if (v === '' || bas.length !== t.length) return out;
  for (let i = bas.indexOf(v); i >= 0; i = bas.indexOf(v, i + 1)) {
    const avant = t.slice(0, i); const apres = t.slice(i + v.length);
    if ((/^\s*$/.test(avant) || /,\s+$/.test(avant)) && (/^\s*$/.test(apres) || /^\s*,(\s|$)/.test(apres))) out.push(i);
  }
  return out;
}
export const aJeton = (texte, jeton) => occurrences(texte, jeton).length > 0;
/**
 * Ajoute le texte d'une puce à la FIN s'il manque ; un second toucher retire cette occurrence (la dernière) et UN séparateur voisin, rien d'autre. Un mot de l'utilisateur égal à la puce
 * est la puce (la puce s'affiche enfoncée) : le retirer ne touche pas au reste du texte.
 */
export function basculerJeton(texte, jeton) {
  const t = String(texte ?? ''); const j = String(jeton ?? '').trim();
  const k = occurrences(t, j).at(-1);
  if (k === undefined) {
    if (t.trim() === '') return j;
    if (/,\s*$/.test(t)) return (/\s$/.test(t) ? t : `${t} `) + j;
    return `${t.replace(/\s+$/, '')}, ${j}`;
  }
  const avant = t.slice(0, k); const apres = t.slice(k + j.length);
  const sepAvant = avant.match(/,\s+$/);
  if (sepAvant) return avant.slice(0, avant.length - sepAvant[0].length) + apres;
  const sepApres = apres.match(/^\s*,\s*/);
  if (sepApres) return avant + apres.slice(sepApres[0].length);
  return (avant + apres).trim() === '' ? '' : avant + apres;
}
/**
 * Pose l'heure « hh:mm » EN TÊTE sans rien retirer. Seule l'heure que CE bouton a posée avant (`precedente`, gardée par la zone de saisie) est remplacée, si elle est toujours en tête :
 * une heure écrite à la main (« 22:00, 07:10 ») n'est jamais enlevée.
 */
export function poserHeure(texte, hhmm, precedente = null) {
  const t = String(texte ?? '');
  if (typeof precedente === 'string' && precedente !== '') {
    const k = occurrences(t, precedente).find((i) => /^\s*$/.test(t.slice(0, i)));
    if (k !== undefined) return t.slice(0, k) + hhmm + t.slice(k + precedente.trim().length);
  }
  return t.trim() === '' ? hhmm : `${hhmm}, ${t}`;
}

/** Valeur actuelle d'un champ texte de la victime ouverte. */
export function lireTexte(fiche, saisie) {
  const def = champDe(saisie);
  if (!def || def.genre !== 'texte') return '';
  const v = victimePriseEnCharge(fiche);
  const source = def.bloc ? v?.[def.bloc] : v;
  return String(source?.[def.cle] ?? '');
}

/** Dernières valeurs de la victime ouverte, une par type proposé, dans l'ordre des types : [{ libelle, texte }]. */
export function constantesDeLEtape(fiche, saisie) {
  const v = victimePriseEnCharge(fiche);
  const types = typesProposes(saisie);
  const out = [];
  for (const t of types) {
    const l = (fiche?.constantes ?? []).filter((c) => c?.type === t.id && c.victime === v?.id && plein(String(c.valeur ?? ''))).sort((a, b) => a.t - b.t);
    if (l.length > 0) out.push({ libelle: t.libelle, texte: avecUnite(l[l.length - 1].valeur, l[l.length - 1].unite) });
  }
  return out;
}

/** Toutes les valeurs de la victime ouverte pour les types proposés, dans l'ordre chronologique : [{ t, libelle, texte }] (la série d'une étape de constantes reste visible). */
export function serieConstantes(fiche, saisie) {
  const v = victimePriseEnCharge(fiche);
  const types = typesProposes(saisie);
  return (fiche?.constantes ?? []).filter((c) => c?.victime === v?.id && plein(String(c.valeur ?? '')) && types.some((t) => t.id === c.type)).sort((a, b) => a.t - b.t)
    .map((c) => ({ t: c.t, libelle: types.find((x) => x.id === c.type).libelle, texte: avecUnite(c.valeur, c.unite) }));
}

/** Ce que l'étape montre sous son libellé (« rien » = chaîne vide). Lit la fiche : jamais une seconde copie. */
export function valeurEtape(fiche, saisie) {
  const def = champDe(saisie);
  if (!def) return '';
  if (def.genre === 'texte') return lireTexte(fiche, saisie).trim();
  if (def.genre === 'antecedents') {
    const v = victimePriseEnCharge(fiche) ?? {};
    return [texteListe(PUCES_ANTECEDENTS, v.antecedents_puces, v.antecedents), texteListe(PUCES_TRAITEMENTS, v.traitements_puces, v.traitements)].filter(plein).join(' · ');
  }
  return constantesDeLEtape(fiche, saisie).map((c) => `${c.libelle} ${c.texte}`).join(' · ');
}

/**
 * M2 (VICTIME-SAISIE ouverte, registre : choix PROVISOIRE du pilote) : la saisie dans une étape va TOUJOURS à la victime PRISE EN CHARGE (la première : celle de la checklist, D-64), jamais à l'onglet
 * ouvert du volet. Dès deux victimes, la zone le dit en une ligne : « → Victime 1 · H adulte » ; une seule victime : rien (chaîne vide).
 */
export function cibleSaisie(fiche) {
  if ((fiche?.victimes ?? []).length < 2) return '';
  const v = victimePriseEnCharge(fiche);
  const m = mentionVictime(v);
  return `→ ${libelleVictime(fiche, v.id)}${m ? ` · ${m}` : ''}`;
}

/**
 * M4 (revue de code du 16/11/2026) : une étape n'est saisissable que si elle porte `saisie`, n'est pas vitale, vient APRÈS toute étape vitale du protocole (alerte, Masser, DAE…) et que le protocole
 * n'est pas un arrêt cardiaque (métronome, ou identifiant « acr-… »). Même condition que la règle R20 du contrôle (`tests/controle-json.mjs`) : rien ne s'interpose avant un geste vital.
 */
export function saisiePermise(protocole, etape) {
  if (!champDe(etape?.saisie) || estVitale(etape) || !Number.isFinite(etape.ordre)) return false;
  if (protocole && (typeof protocole.parametres?.metronome === 'object' && protocole.parametres.metronome !== null)) return false;
  if (typeof protocole?.id === 'string' && /^acr-/.test(protocole.id)) return false;
  const etapes = Array.isArray(protocole?.etapes) ? protocole.etapes : [];
  if (etapes.some((x) => x?.declenche?.metronome)) return false;
  return etapes.filter((x) => estVitale(x) || x?.cochage_auto === 'appel').every((x) => etape.ordre > x.ordre);
}
