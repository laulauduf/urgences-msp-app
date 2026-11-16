// Modèle de la fiche (cahier des charges 3.3) : fonctions PURES, sans accès au stockage ni au navigateur — testables sous Node.
// Une fiche vit en mémoire ; stockage.js l'écrit après l'affichage. Aucune donnée patient dans ce fichier.
import { victimeVide } from './victimes.js';

/** Format courant des fiches stockées. Toute évolution ajoute une migration n-1 → n dans MIGRATIONS (parade 3 de 2.4). */
export const FORMAT_FICHE = 2;

/** Types d'entrées du journal (3.3). */
export const TYPES_JOURNAL = [
  'urgence', 'situation', 'role', 'profession', 'case', 'evenement', 'constante', 'geste', 'appel_lance', 'appel_fait', 'appel_simule',
  'chronometre', 'echeance', 'rattrapage', 'horloge_modifiee', 'reprise', 'nouvelle_urgence', 'stockage_echec', 'version_differente',
  'secours_protocole', 'acr_illisible', 'purge_reportee', 'correction', 'export', 'note', 'victime_ajoutee', 'victime_retiree',
];

/** Événements qu'on écrit tout de suite, sans regroupement (2.8) : URGENCE, appels, case cochée, événement du DAE. */
export const TYPES_CRITIQUES = ['urgence', 'appel_lance', 'appel_fait', 'appel_simule', 'case', 'evenement', 'nouvelle_urgence'];

export const MODES = ['reel', 'simulation'];

/** Identifiant aléatoire (jamais dérivé d'une donnée du patient). */
export function identifiantAleatoire() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const octets = new Uint8Array(16);
  globalThis.crypto.getRandomValues(octets);
  return [...octets].map((o) => o.toString(16).padStart(2, '0')).join('');
}

/**
 * Crée une fiche vide, avec l'entrée `urgence` du journal (T+00:00).
 * @param {{mode: 'reel'|'simulation', maintenant?: number, versionAppli?: string, id?: string, delaiEffacementH?: number}} options
 */
export function creerFiche({ mode, maintenant = Date.now(), versionAppli = globalThis.URGENCES_VERSION ?? '?', id = identifiantAleatoire(), delaiEffacementH = 24 } = {}) {
  if (!MODES.includes(mode)) throw new Error(`mode invalide : ${mode}`);
  return {
    id,
    format: FORMAT_FICHE,
    mode,
    etat: 'en_cours',
    version_appli: versionAppli,
    versions_protocoles: {},
    cree_le: maintenant,
    derniere_activite: maintenant,
    expire_le: maintenant + delaiEffacementH * 3600 * 1000,
    terminee_le: null,
    export: null,
    presse_papiers_utilise: false,
    protocoles_utilises: {},
    situations: [],
    lieu: { type: 'cabinet' },
    roles: [],
    // D-64 : un onglet par victime ; identité, circonstances, bilan vital, antécédents… sont DANS la victime (format 2). Les constantes et les gestes restent ici, avec le champ `victime`.
    victimes: [victimeVide('v1')], victime_active: 'v1', victime_suivante: 2,
    constantes: [],
    gestes_produits: [],
    evaluation: '', demande: '',
    checklist: {},
    chronometres: [],
    journal: [{ id: `${id}-1`, t: maintenant, t_ecoule: 0, type: 'urgence', donnees: {} }],
  };
}

/** Temps écoulé depuis URGENCE, en secondes entières (jamais négatif) : ne dépend ni du fuseau ni du changement d'heure (2.7). */
export function tEcoule(fiche, maintenant = Date.now()) {
  const debut = fiche.journal?.[0]?.type === 'urgence' ? fiche.journal[0].t : fiche.cree_le;
  return Math.max(0, Math.floor((maintenant - debut) / 1000));
}

/** Ajoute une entrée au journal (en ajout seul). Renvoie l'entrée. */
export function ajouterJournal(fiche, type, donnees = {}, { maintenant = Date.now(), correction_de } = {}) {
  if (!TYPES_JOURNAL.includes(type)) throw new Error(`type de journal inconnu : ${type}`);
  const entree = { id: `${fiche.id}-${fiche.journal.length + 1}`, t: maintenant, t_ecoule: tEcoule(fiche, maintenant), type, donnees };
  if (correction_de !== undefined) entree.correction_de = correction_de;
  fiche.journal.push(entree);
  fiche.derniere_activite = Math.max(fiche.derniere_activite, maintenant);
  return entree;
}

/**
 * Une fiche lue dans une base doit porter le mode de CETTE base (3.3) : sinon elle n'est pas ouverte.
 * Renvoie une liste de raisons (vide = cohérente).
 */
export function verifierFiche(fiche, modeAttendu) {
  const raisons = [];
  if (fiche === null || typeof fiche !== 'object') return ['enregistrement illisible'];
  if (typeof fiche.id !== 'string' || fiche.id === '') raisons.push('identifiant absent');
  if (fiche.mode !== modeAttendu) raisons.push(`mode « ${fiche.mode} » dans une base « ${modeAttendu} »`);
  if (!['en_cours', 'terminee'].includes(fiche.etat)) raisons.push(`état inconnu « ${fiche.etat} »`);
  if (!Number.isFinite(fiche.cree_le)) raisons.push('date de création absente');
  if (!Array.isArray(fiche.journal)) raisons.push('journal absent');
  else if (fiche.journal.length === 0) raisons.push('journal vide');
  // revue m11 : une fiche lisible mais incomplète ferait échouer la reprise (promesse rejetée, fiche « affichée » mais invisible)
  for (const champ of ['situations', 'chronometres', 'roles']) if (!Array.isArray(fiche[champ])) raisons.push(`${champ} absent ou mal formé`);
  for (const champ of ['checklist', 'protocoles_utilises', 'versions_protocoles', 'lieu']) {
    if (fiche[champ] === null || typeof fiche[champ] !== 'object' || Array.isArray(fiche[champ])) raisons.push(`${champ} absent ou mal formé`);
  }
  // D-64 : au format 2, au moins une victime, et la victime ouverte existe (verifierFiche lit la fiche AVANT sa migration : les formats 1 et les plus récents ne sont pas contrôlés ici)
  if (fiche.format === 2) {
    if (!Array.isArray(fiche.victimes) || fiche.victimes.length === 0 || fiche.victimes.some((v) => v === null || typeof v !== 'object' || typeof v.id !== 'string')) raisons.push('victimes absentes ou mal formées');
    else if (!fiche.victimes.some((v) => v.id === fiche.victime_active)) raisons.push('victime ouverte inconnue');
  }
  return raisons;
}

/** Résumé SANS contenu (accueil, purge) : jamais d'identité ni de saisie. */
export function resumer(fiche) {
  return {
    id: fiche.id, mode: fiche.mode, etat: fiche.etat, cree_le: fiche.cree_le, derniere_activite: fiche.derniere_activite,
    expire_le: fiche.expire_le, terminee_le: fiche.terminee_le, presse_papiers_utilise: fiche.presse_papiers_utilise === true, export_fait: fiche.export !== null && fiche.export !== undefined,
  };
}

/**
 * Migre une fiche d'un format antérieur vers le format courant, étape par étape, SANS perte (les champs inconnus sont conservés).
 * `migrations[n]` transforme une fiche de format n en format n+1. Une fiche d'un format PLUS RÉCENT que le code n'est pas modifiée
 * (on ne dégrade jamais une fiche) : elle est renvoyée telle quelle avec `plusRecente: true`.
 * @returns {{fiche: object, migree: boolean, plusRecente: boolean}}
 */
export function migrerFiche(fiche, { formatCourant = FORMAT_FICHE, migrations = MIGRATIONS } = {}) {
  const copie = structuredClone(fiche);
  const depart = Number.isInteger(copie.format) ? copie.format : 0;
  if (depart > formatCourant) return { fiche: copie, migree: false, plusRecente: true };
  let format = depart;
  while (format < formatCourant) {
    const etape = migrations[format];
    if (typeof etape !== 'function') throw new Error(`aucune migration du format ${format} vers ${format + 1}`);
    const { _retirer = [], ...changements } = etape(copie);   // `_retirer` : champs qui quittent le premier niveau (déplacés ailleurs par la migration)
    Object.assign(copie, changements);
    for (const cle of _retirer) delete copie[cle];
    format += 1;
    copie.format = format;
  }
  return { fiche: copie, migree: depart !== formatCourant, plusRecente: false };
}

/**
 * Format 1 → 2 (D-64, un onglet par victime). La fiche d'avant n'avait qu'UN patient, au premier niveau : il devient la victime 1, SANS rien perdre.
 *  - identité, circonstances, bilan vital, antécédents, traitements, allergies, médecin traitant → dans la victime 1 ;
 *  - le « nombre de victimes » saisi (D-63) est remplacé par les onglets : sa valeur, si elle existe, passe dans les NOTES de la victime 1 (en toutes lettres) ;
 *  - chaque constante et chaque geste saisis reçoit `victime` = la victime 1 ; évaluation, demande, checklist, lieu, journal et champs inconnus ne bougent pas.
 * Une valeur mal formée (fiche très ancienne) ne fait pas échouer la migration : elle est remplacée par du vide.
 */
const objet = (x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {});
const texte = (x) => (typeof x === 'string' ? x : '');
const liste = (x) => (Array.isArray(x) ? x : []);
const CHAMPS_PATIENT_FORMAT_1 = ['identite', 'circonstances', 'bilan_vital', 'antecedents', 'traitements', 'allergies', 'medecin_traitant'];
function migrer1vers2(f) {
  const { nombre_victimes: nombre, ...circonstances } = objet(f.circonstances);
  const v = {
    ...victimeVide('v1'),
    identite: objet(f.identite), circonstances, bilan_vital: objet(f.bilan_vital),
    antecedents: texte(f.antecedents), traitements: texte(f.traitements), allergies: texte(f.allergies), medecin_traitant: texte(f.medecin_traitant),
    notes: (typeof nombre === 'string' || Number.isFinite(nombre)) && String(nombre).trim() !== '' ? `Nombre de victimes noté : ${String(nombre).trim()}` : '',
  };
  return {
    victimes: [v], victime_active: 'v1', victime_suivante: 2,
    // une entrée nulle ou mal formée (fiche très ancienne) est écartée : elle deviendrait « NaN:NaN undefined » (D-64b, m1)
    constantes: liste(f.constantes).filter((c) => c !== null && typeof c === 'object' && !Array.isArray(c)).map((c) => ({ ...c, victime: 'v1' })),
    gestes_produits: liste(f.gestes_produits).filter((g) => g !== null && typeof g === 'object' && !Array.isArray(g)).map((g) => ({ ...g, victime: 'v1' })),
    _retirer: CHAMPS_PATIENT_FORMAT_1,
  };
}

/** Table des migrations : `MIGRATIONS[n]` transforme une fiche de format n en format n+1. */
export const MIGRATIONS = { 1: migrer1vers2 };
