// Victimes de la fiche bilan (D-64) : modèle PUR, sans DOM ni stockage. Une fiche porte `victimes[]` (un onglet par victime, sans limite) et `victime_active`
// (l'onglet ouvert). Les constantes et les gestes saisis restent dans la fiche, chacun avec le champ `victime` ; la checklist, les chronomètres et le métronome sont
// ceux de l'intervention (la victime prise en charge), pas ceux d'un onglet. Aucune donnée patient dans ce fichier : seulement la forme des données.
// Les listes de saisie rapide ci-dessous sont celles de la maquette validée (specs/maquette/maquette-fiche-volet-2026-11-15.html) : de simples étiquettes à toucher,
// SANS seuil, SANS dose, SANS interprétation (D-19) ; en toutes lettres (D-10, D-56). CHOIX PROVISOIRE (D-15) : liste à confirmer par Laurent.

/** Antécédents : une puce = un toucher ; `court` = la forme écrite dans la transmission et le résumé (toutes lettres, sans sigle). */
export const PUCES_ANTECEDENTS = [
  { id: 'cardiaque', libelle: 'Cardiaque', court: 'cardiaque' },
  { id: 'diabete', libelle: 'Diabète', court: 'diabète' },
  { id: 'resp', libelle: 'Insuffisance respiratoire', court: 'insuffisance respiratoire' },
  { id: 'avc', libelle: 'AVC', court: 'AVC' },
  { id: 'epilepsie', libelle: 'Épilepsie', court: 'épilepsie' },
  { id: 'allergie', libelle: 'Allergie connue', court: 'allergie connue' },
];
export const PUCES_TRAITEMENTS = [
  { id: 'anticoag', libelle: 'Anticoagulant', court: 'anticoagulant' },
  { id: 'antiagr', libelle: 'Antiagrégant', court: 'antiagrégant' },
  { id: 'insuline', libelle: 'Insuline', court: 'insuline' },
];
/** Tranches d'âge à toucher (aucune borne en années : c'est l'estimation de celui qui est sur place). */
export const TRANCHES_AGE = [
  { id: 'nourrisson', libelle: 'Nourrisson', court: 'nourrisson' },
  { id: 'enfant', libelle: 'Enfant', court: 'enfant' },
  { id: 'adulte', libelle: 'Adulte', court: 'adulte' },
  { id: '75p', libelle: '>\u00a075\u00a0ans', court: '> 75 ans' },
];
/** AVPU : la lettre est transmise ; le SENS des lettres est un texte PROVISOIRE de la maquette (✱), affiché sur les boutons seulement. */
export const NIVEAUX_AVPU = [
  { lettre: 'A', sens: 'alerte', provisoire: true },
  { lettre: 'V', sens: 'voix', provisoire: true },
  { lettre: 'P', sens: 'douleur', provisoire: true },
  { lettre: 'U', sens: 'aucune réaction', provisoire: true },
];
/** Ligne « Demande » de la maquette : texte PROVISOIRE (✱), affiché dans la transmission tant que la demande n'est pas écrite. */
export const LIGNE_DEMANDE_PROVISOIRE = "Envoi d'une équipe médicale et conseils du régulateur";

const plein = (v) => typeof v === 'string' && v.trim() !== '';
const nonVideObjet = (o) => o && typeof o === 'object' && Object.values(o).some((x) => (typeof x === 'object' && x !== null ? nonVideObjet(x) : plein(String(x ?? ''))));

/** Victime vide (aucun champ obligatoire : tout est facultatif). */
export function victimeVide(id) {
  return {
    id, identite: {}, circonstances: {}, bilan_vital: {},
    antecedents: '', antecedents_puces: [], traitements: '', traitements_puces: [], allergies: '', medecin_traitant: '', notes: '',
  };
}

/** Vrai si rien n'a été noté pour cette victime. */
export function victimeEstVide(v) {
  if (!v) return true;
  return !(nonVideObjet(v.identite) || nonVideObjet(v.circonstances) || nonVideObjet(v.bilan_vital)
    || (v.antecedents_puces ?? []).length > 0 || (v.traitements_puces ?? []).length > 0
    || ['antecedents', 'traitements', 'allergies', 'medecin_traitant', 'notes'].some((c) => plein(v[c])));
}

/** La victime dont l'onglet est ouvert ; sinon la première (jamais d'exception : une fiche de format 2 a toujours au moins une victime). */
export function victimeActive(fiche) {
  const l = Array.isArray(fiche?.victimes) ? fiche.victimes : [];
  return l.find((v) => v.id === fiche?.victime_active) ?? l[0];
}

/**
 * Numéro STABLE d'une victime (D-64b, M4) : il vient de l'identifiant (`v3` → 3), jamais de la position. Retirer la victime 2 ne renumérote pas la 3 : la page S, la frise du journal et le document
 * disent le même numéro. 0 si la victime n'existe pas.
 */
export function numeroVictime(fiche, id) {
  const l = fiche?.victimes ?? [];
  const k = l.findIndex((v) => v.id === id);
  if (k < 0) return 0;
  const n = Number(String(id).replace(/^v/, ''));
  return Number.isInteger(n) && n > 0 ? n : k + 1;
}
export const libelleVictime = (fiche, id) => `Victime ${numeroVictime(fiche, id)}`;

/** Identifiant neuf : jamais celui d'une victime encore présente NI d'une victime retirée (`victime_suivante` ne recule jamais : le journal parle de « Victime 4 », ce numéro n'est plus réattribué). */
function idNeuf(fiche) {
  const pris = new Set((fiche.victimes ?? []).map((v) => v.id));
  let n = Math.max(Number.isInteger(fiche.victime_suivante) ? fiche.victime_suivante : 0, 1 + Math.max(0, ...[...pris].map((id) => Number(String(id).replace(/^v/, '')) || 0)));
  while (pris.has(`v${n}`)) n += 1;
  fiche.victime_suivante = n + 1;
  return `v${n}`;
}

/** Ajoute une victime (onglet de plus, sans limite) et l'ouvre. Modifie `fiche`. */
export function ajouterVictime(fiche) {
  const id = idNeuf(fiche);
  fiche.victimes = [...(fiche.victimes ?? []), victimeVide(id)];
  fiche.victime_active = id;
  return { ok: true, id, numero: numeroVictime(fiche, id) };
}

/** Ce qu'emporterait le retrait d'une victime (annoncé AVANT la confirmation). */
export function contenuVictime(fiche, id) {
  const v = (fiche.victimes ?? []).find((x) => x.id === id);
  return {
    constantes: (fiche.constantes ?? []).filter((c) => c.victime === id).length,
    gestes: (fiche.gestes_produits ?? []).filter((g) => g.victime === id).length,
    champs: !victimeEstVide(v),
  };
}

/**
 * Retire une victime AJOUTÉE par erreur. La première (la victime prise en charge : checklist, cycle, « ACR constaté ») ne se retire jamais (M3). Ses constantes et ses gestes partent avec elle
 * (le journal, lui, garde ses entrées). La victime ouverte devient la précédente (sinon la suivante). Modifie `fiche`.
 */
export function retirerVictime(fiche, id) {
  const l = fiche.victimes ?? [];
  const k = l.findIndex((v) => v.id === id);
  if (k < 0) return { ok: false, raison: 'victime inconnue' };
  if (k === 0) return { ok: false, raison: 'la victime prise en charge ne se retire pas' };
  const numero = numeroVictime(fiche, id);
  const retirees = { constantes: (fiche.constantes ?? []).filter((c) => c.victime === id).length, gestes: (fiche.gestes_produits ?? []).filter((g) => g.victime === id).length };
  fiche.victimes = l.filter((v) => v.id !== id);
  fiche.constantes = (fiche.constantes ?? []).filter((c) => c.victime !== id);
  fiche.gestes_produits = (fiche.gestes_produits ?? []).filter((g) => g.victime !== id);
  if (fiche.victime_active === id || !fiche.victimes.some((v) => v.id === fiche.victime_active)) fiche.victime_active = (fiche.victimes[k - 1] ?? fiche.victimes[k]).id;
  return { ok: true, numero, retirees };
}

/** « cardiaque, diabète, texte libre » : les puces (forme écrite), puis le texte libre ; une puce inconnue (liste modifiée depuis) est gardée telle quelle. */
export function texteListe(puces, ids, libre) {
  const court = (id) => puces.find((p) => p.id === id)?.court ?? String(id);
  return [...(ids ?? []).map(court), plein(libre) ? libre.trim() : ''].filter(Boolean).join(', ');
}

/** Âge tel que le résumé et la transmission le disent quand la date de naissance n'est pas donnée (l'âge calculé depuis une date est dans bilan.js). */
export const texteAgeSaisi = (identite) => (plein(identite?.age_exact) ? `${identite.age_exact.trim()} ans` : '');

/** Ligne de résumé (sous l'en-tête) : « Victime 2/3 · H · 67 ans · nom · ATCD … ». Vide s'il n'y a qu'une victime et rien de noté. */
export function resumeVictime(fiche, id = fiche?.victime_active) {
  const l = fiche?.victimes ?? [];
  const v = l.find((x) => x.id === id) ?? l[0];
  if (!v) return '';
  // plusieurs victimes (D-64b, D3) : le nombre, puis UNE courte mention par victime (sexe, tranche ou âge), la victime ouverte marquée ▸ ; le détail est dans le volet
  if (l.length > 1) {
    const court = (x) => {
      const i = x.identite ?? {};
      const t = [i.sexe === 'homme' ? 'H' : i.sexe === 'femme' ? 'F' : '', texteAgeSaisi(i) || TRANCHES_AGE.find((a) => a.id === i.tranche_age)?.court || ''].filter(Boolean).join(' ');
      return t || (plein(i.nom) ? i.nom.trim() : 'rien noté');
    };
    // lot A, A9 : la victime OUVERTE vient en premier (▸), sinon c'est elle que la ligne, coupée à droite sur un petit écran, ferait disparaître
    return [`${l.length} victimes`, `▸${court(v)}`, ...l.filter((x) => x !== v).map(court)].join(' · ');
  }
  const idt = v.identite ?? {};
  const tranche = TRANCHES_AGE.find((t) => t.id === idt.tranche_age)?.court;
  const atcd = texteListe(PUCES_ANTECEDENTS, v.antecedents_puces, v.antecedents);
  const parts = [
    idt.sexe === 'homme' ? 'H' : idt.sexe === 'femme' ? 'F' : '',
    texteAgeSaisi(idt) || tranche || (plein(idt.age_estime) ? `âge estimé ${idt.age_estime.trim()}` : ''),
    plein(idt.nom) ? idt.nom.trim() : '',
    atcd ? `ATCD ${atcd}` : '',
    texteListe(PUCES_TRAITEMENTS, v.traitements_puces, v.traitements),
    plein(v.allergies) ? `allergie : ${v.allergies.trim()}` : '',
    plein(v.bilan_vital?.avpu) ? `conscience ${v.bilan_vital.avpu}` : '',
    plein(v.notes) ? 'notes' : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
