// Modèle de la fiche (cahier des charges 3.3) : fonctions PURES, sans accès au stockage ni au navigateur — testables sous Node.
// Une fiche vit en mémoire ; stockage.js l'écrit après l'affichage. Aucune donnée patient dans ce fichier.

/** Format courant des fiches stockées. Toute évolution ajoute une migration n-1 → n dans MIGRATIONS (parade 3 de 2.4). */
export const FORMAT_FICHE = 1;

/** Types d'entrées du journal (3.3). */
export const TYPES_JOURNAL = [
  'urgence', 'situation', 'role', 'profession', 'case', 'evenement', 'constante', 'geste', 'appel_lance', 'appel_fait', 'appel_simule',
  'chronometre', 'echeance', 'rattrapage', 'horloge_modifiee', 'reprise', 'nouvelle_urgence', 'stockage_echec', 'version_differente',
  'secours_protocole', 'purge_reportee', 'correction', 'export', 'note',
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
    identite: {},
    circonstances: {},
    bilan_vital: {},
    constantes: [],
    antecedents: '', traitements: '', allergies: '', medecin_traitant: '',
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
  return raisons;
}

/** Résumé SANS contenu (accueil, purge) : jamais d'identité ni de saisie. */
export function resumer(fiche) {
  return {
    id: fiche.id, mode: fiche.mode, etat: fiche.etat, cree_le: fiche.cree_le, derniere_activite: fiche.derniere_activite,
    expire_le: fiche.expire_le, terminee_le: fiche.terminee_le, export_fait: fiche.export !== null && fiche.export !== undefined,
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
    Object.assign(copie, etape(copie));
    format += 1;
    copie.format = format;
  }
  return { fiche: copie, migree: depart !== formatCourant, plusRecente: false };
}

/** Table des migrations : vide tant qu'il n'existe qu'un format. Ajouter ici `1: (fiche) => ({ … })` au passage au format 2. */
export const MIGRATIONS = {};
