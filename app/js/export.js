// Export de la fiche (cahier des charges 2.11, 4.10) : fabrication du document HTML AUTONOME, du texte à copier, partage, impression, copie.
// SANS dépendance (Q-3 : pas de vraie bibliothèque PDF) et SANS aucune requête réseau. Aucune donnée du patient dans le NOM du fichier ni dans
// le TITRE du document (ils apparaissent dans Fichiers, les fichiers récents et les sauvegardes). Aucun contenu médical ici : le document ne reprend
// que ce que la fiche contient (mêmes pages que le mode transmission, D-9, puis la frise du journal) — constantes en valeurs brutes, sans jugement (D-19).
// Première partie : fonctions PURES (testées sous Node). Seconde partie : ce qui touche le navigateur (File, partage, impression, presse-papiers).
import { construireTransmission, frise, hhmm, MOYENS } from './bilan.js';
import { heureLocale } from './dom.js';

// ───────── Textes : avertissements du cahier des charges 2.11 (repris par « À propos » et la notice, lot L9) ─────────

export const TITRE_DOCUMENT = "Fiche d'intervention";
export const QUESTION_REMISE = 'Le document a-t-il été remis ?';
export const TEXTE_BROUILLON_DOCUMENT = 'BROUILLON — protocoles non validés par le médecin référent';
export const AVERTISSEMENT_PARTAGE = "Ce document contient des données de santé. Il sort de l'appli : ne l'enregistrez pas dans un dossier synchronisé (iCloud, Google Drive…) ; préférez la remise en main propre au SMUR ; supprimez-le après remise. La messagerie et le courriel sont déconseillés.";
export const AVERTISSEMENT_SAUVEGARDE = "La sauvegarde automatique du téléphone (iCloud, Google) peut inclure le document enregistré ; si elle inclut aussi le stockage de l'appli, on ne l'a pas établi.";
export const AVERTISSEMENT_PRESSE_PAPIERS = "Le texte copié reste dans le presse-papiers, et peut passer sur vos autres appareils (iPhone) ou dans l'historique du clavier (Android)";
// Lot R1e : sur l'écran de clôture, UNE phrase visible par avertissement ; le texte complet ci-dessus reste dans « Pourquoi ? » (on raccourcit, on ne retire rien).
export const RESUME_SANTE = 'Données de santé : remise en main propre de préférence, pas de dossier synchronisé, à supprimer après remise.';
export const RESUME_PRESSE_PAPIERS = "Le texte copié reste dans le presse-papiers : il peut passer sur d'autres appareils ou dans l'historique du clavier (Android).";
/** Les libellés des moyens de remise sont dans bilan.js (le journal les dit aussi) : réexportés ici pour l'écran de clôture. */
export { MOYENS };
const PIED_DOCUMENT = 'Ce document contient des données de santé : confidentiel, à remettre en main propre et à supprimer après remise.';


// ───────── Nom du fichier ─────────

const deux = (n) => String(n).padStart(2, '0');
const dateFr = (ms) => `${deux(new Date(ms).getDate())}/${deux(new Date(ms).getMonth() + 1)}/${new Date(ms).getFullYear()}`;
const debutDe = (fiche) => fiche.journal?.[0]?.t ?? fiche.cree_le;

/** « fiche-intervention-hhmm.html » : l'heure de DÉBUT de l'intervention seulement (aucun nom, prénom, date de naissance ni autre donnée du patient). */
export function nomFichier(fiche) {
  const d = new Date(debutDe(fiche));
  return `fiche-intervention-${deux(d.getHours())}${deux(d.getMinutes())}.html`;
}

// ───────── Modèle du document (un seul modèle, deux sorties : HTML et texte) ─────────

/**
 * @param {{fiche: object, structure?: object|null, champsSensibles?: object, appelant?: object|null, protocoleId?: string|null, maintenant?: number, version?: string}} entree
 * @returns {{titre: string, simulation: boolean, entete: string[], sections: {id: string, titre: string, lignes: string[]}[], journal: object[], pied: string}}
 */
export function modeleDocument({ fiche, structure = null, champsSensibles = {}, appelant = null, protocoleId = null, maintenant = Date.now(), version = globalThis.URGENCES_VERSION ?? '?' }) {
  const debut = debutDe(fiche);
  const pages = construireTransmission({ fiche, structure, champsSensibles, appelant, protocoleId, maintenant });
  return {
    titre: TITRE_DOCUMENT,
    simulation: fiche.mode === 'simulation',
    entete: [
      `Intervention du ${dateFr(debut)}, début ${hhmm(debut)}`,
      `Document établi à ${hhmm(maintenant)} par l'appli Urgences MSP APSIS, version ${version}`,
      TEXTE_BROUILLON_DOCUMENT,
    ],
    // D-88 / CABINET-1 (PROVISOIRE) : les lignes marquées `prive` (codes d'accès du lieu) restent à l'écran de transmission ; le document, qui peut sortir de l'appareil, ne les porte jamais
    sections: pages.map((p) => ({ id: p.id, titre: p.titre, lignes: p.lignes.filter((l) => l.prive !== true).map((l) => l.valeur) })),
    journal: frise(fiche),
    pied: PIED_DOCUMENT,
  };
}

const echapper = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Feuille de style du document exporté (incluse dans le fichier). Les mêmes règles, limitées à l'impression, sont dans app.css (`#impression`) :
 * la politique de sécurité de l'appli interdit les styles en ligne, le document est donc imprimé depuis la page elle-même.
 */
export const CSS_DOCUMENT = `
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12pt; line-height: 1.4; margin: 1.5rem auto; max-width: 48rem; padding: 0 1rem; color: black; background: white; }
.doc-entete { border-bottom: 0.15rem solid black; margin-bottom: 1rem; }
.doc-titre-principal { font-size: 1.6rem; margin: 0 0 0.25rem; }
.doc-meta { margin: 0.125rem 0; font-size: 0.9rem; }
.doc-brouillon { margin: 0.125rem 0 0.5rem; font-weight: 700; border: 0.1rem solid black; padding: 0.125rem 0.5rem; display: inline-block; }
.doc-simulation { margin: 0.25rem 0; padding: 0.125rem 0.5rem; display: inline-block; font-weight: 800; letter-spacing: 0.08em; border: 0.15rem dashed black; }
.doc-section { margin: 0 0 1.25rem; break-inside: avoid; page-break-inside: avoid; }
.doc-titre { font-size: 1.2rem; margin: 0.5rem 0; border-bottom: 0.05rem solid black; }
.doc-ligne { margin: 0.2rem 0; overflow-wrap: anywhere; }
.doc-vide { margin: 0.2rem 0; font-style: italic; }
.doc-journal { list-style: none; margin: 0; padding: 0; }
.doc-entree { margin: 0.25rem 0; padding-top: 0.25rem; border-top: 0.05rem solid black; overflow-wrap: anywhere; }
.doc-heure { font-weight: 700; font-variant-numeric: tabular-nums; margin-right: 0.5rem; }
.doc-correction { display: block; font-weight: 700; margin-left: 1rem; }
.doc-pied { margin-top: 1.5rem; border-top: 0.15rem solid black; padding-top: 0.5rem; font-size: 0.9rem; }
`.trim();

/** Document HTML autonome : UN fichier, sans script, sans adresse, sans ressource externe ; tout texte de la fiche est échappé. */
export function documentHtml(m) {
  const marque = m.simulation ? '<p class="doc-simulation">SIMULATION</p>' : '';
  const sections = m.sections.map((s) => [
    `<section class="doc-section" data-section="${echapper(s.id)}">`,
    marque,
    `<h2 class="doc-titre">${echapper(s.titre)}</h2>`,
    ...(s.lignes.length > 0 ? s.lignes.map((l) => `<p class="doc-ligne">${echapper(l)}</p>`) : ['<p class="doc-vide">Aucune information saisie.</p>']),
    '</section>',
  ].filter(Boolean).join('\n'));
  const journal = [
    '<section class="doc-section" data-section="journal">',
    marque,
    '<h2 class="doc-titre">Journal</h2>',
    '<ol class="doc-journal">',
    ...m.journal.map((l) => [
      '<li class="doc-entree">',
      `<span class="doc-heure">${echapper(`${l.heure} · ${l.tPlus}`)}</span>`,
      l.barree ? `<s>${echapper(l.texte)}</s>` : echapper(l.texte),
      ...l.corrections.map((c) => `<span class="doc-correction">${echapper(`correction à ${c.heure} (${c.tPlus}) : ${c.texte}`)}</span>`),
      '</li>',
    ].join('')),
    '</ol>',
    '</section>',
  ].filter(Boolean).join('\n');
  return [
    '<!doctype html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // politique de sécurité PROPRE au document (L8c, revue L8 m5) : ouvert hors de l'appli, rien ne doit s'y exécuter ni s'y charger, même si un oubli d'échappement survenait
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`,
    `<title>${echapper(m.titre)}</title>`,
    `<style>\n${CSS_DOCUMENT}\n</style>`,
    '</head>',
    '<body>',
    '<header class="doc-entete">',
    `<h1 class="doc-titre-principal">${echapper(m.titre)}</h1>`,
    marque,
    ...m.entete.slice(0, 2).map((l) => `<p class="doc-meta">${echapper(l)}</p>`),
    `<p class="doc-brouillon">${echapper(m.entete[2])}</p>`,
    '</header>',
    ...sections,
    journal,
    `<footer class="doc-pied">${echapper(m.pied)}</footer>`,
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n');
}

/** Même contenu en texte brut (copie dans le presse-papiers) : aucune balise. */
export function documentTexte(m) {
  const l = [m.titre.toUpperCase()];
  if (m.simulation) l.push('SIMULATION — ceci n\'est pas une intervention réelle');
  l.push(...m.entete, '');
  for (const s of m.sections) {
    l.push(`== ${s.titre} ==`);
    if (m.simulation) l.push('SIMULATION');
    l.push(...(s.lignes.length > 0 ? s.lignes : ['Aucune information saisie.']), '');
  }
  l.push('== Journal ==');
  if (m.simulation) l.push('SIMULATION');
  for (const e of m.journal) {
    l.push(`${e.heure} · ${e.tPlus} ${e.texte}${e.barree ? ' [corrigé]' : ''}`);
    for (const c of e.corrections) l.push(`    correction à ${c.heure} (${c.tPlus}) : ${c.texte}`);
  }
  l.push('', m.pied);
  return l.join('\n');
}

/** « Fiche effacée à hh:mm » (avec le sort du presse-papiers), ou la cause de l'échec et l'invitation à réessayer — jamais un échec silencieux (2.9). */
export function messageEffacement(res) {
  if (!res?.ok) return `Effacement non terminé : ${res?.raison ?? 'cause inconnue'} — réessayez.`;
  const base = `Fiche effacée à ${heureLocale(res.effaceeA ?? Date.now())}`;
  if (res.pressePapiers === 'vide') return `${base} — presse-papiers vidé`;
  if (res.pressePapiers === 'echec') return `${base} — videz le presse-papiers vous-même (il peut contenir la fiche)`;
  return base;
}

// ───────── Navigateur : fichier, partage, enregistrement, impression, copie ─────────

/** Le document en fichier HTML au nom neutre. */
export function fichierDocument(entree) {
  return new File([documentHtml(modeleDocument(entree))], nomFichier(entree.fiche), { type: 'text/html;charset=utf-8' });
}

/** La feuille de partage de FICHIERS existe-t-elle ? (canShare testé avant share, 2.11) */
export function peutPartager(entree, nav = globalThis.navigator) {
  try { return typeof nav?.share === 'function' && typeof nav?.canShare === 'function' && nav.canShare({ files: [fichierDocument(entree)] }) === true; } catch { return false; }
}

/** @returns {Promise<{ok: true} | {ok: false, raison: 'indisponible'|'annule'|'echec'}>} un titre neutre, jamais de texte ni d'adresse joints */
export async function partagerFichier(entree, nav = globalThis.navigator) {
  if (!peutPartager(entree, nav)) return { ok: false, raison: 'indisponible' };
  try { await nav.share({ files: [fichierDocument(entree)], title: TITRE_DOCUMENT }); return { ok: true }; }
  catch (e) { return { ok: false, raison: e?.name === 'AbortError' ? 'annule' : 'echec' }; }
}

const urlsEmises = new Set();
/** Révoque les adresses « blob: » créées par « Enregistrer le fichier » : à l'effacement, le document complet ne reste pas adressable en mémoire (L8c, revue L8 m1). */
export function revoquerExports() {
  for (const url of urlsEmises) { try { URL.revokeObjectURL(url); } catch { /* déjà révoquée */ } }
  urlsEmises.clear();
}

/**
 * Vide le presse-papiers (texte vide). L'écriture part IMMÉDIATEMENT, avant toute attente : appelée dans le toucher de « Confirmer : clôturer et effacer », elle
 * profite du geste de l'utilisateur, que Safari exige (L8c, revue L8 M3 ; refus sur iPhone SUPPOSÉ, à mesurer : T16).
 * @returns {Promise<'vide'|'echec'>}
 */
export function viderPressePapiers(nav = globalThis.navigator) {
  try { return Promise.resolve(nav.clipboard.writeText('')).then(() => 'vide', () => 'echec'); } catch { return Promise.resolve('echec'); }
}

/**
 * Empreinte du CONTENU transmis (hors heure d'établissement et hors entrées sans contenu : reprise, export, version, horloge, chronomètres, échéances…).
 * Elle ne dépend ni de la structure ni des codes sensibles de l'appareil (lus en différé au lancement : une reprise rapide ne doit pas périmer à tort la remise). Elle est gardée dans `fiche.export` à la remise : si elle change ensuite, le document remis est PÉRIMÉ (L8c, revue L8 M2). Ce n'est pas un secret : un hachage simple.
 */
const ENTREES_SANS_CONTENU = ['reprise', 'export', 'version_differente', 'horloge_modifiee', 'chronometre', 'echeance', 'rattrapage', 'purge_reportee', 'stockage_echec'];
export function empreinteContenu(entree) {
  const copie = structuredClone(entree.fiche);
  copie.journal = copie.journal.filter((e) => !ENTREES_SANS_CONTENU.includes(e.type));
  const texte = documentTexte(modeleDocument({ ...entree, structure: null, champsSensibles: {}, fiche: copie, maintenant: 0, version: '' }));
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h * 33) ^ texte.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Enregistrement par lien de téléchargement : seulement sur un geste explicite, après l'avertissement (jamais par défaut, 2.11). */
export function telechargerFichier(entree, { doc = globalThis.document } = {}) {
  const fichier = fichierDocument(entree);
  const url = URL.createObjectURL(fichier);
  urlsEmises.add(url);
  const a = doc.createElement('a');
  a.href = url; a.download = fichier.name; a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { ok: true, nom: fichier.name };
}

/** @returns {Promise<{ok: boolean}>} copie le TEXTE du document ; l'appelant a déjà retenu que le presse-papiers a servi (il sera vidé à l'effacement) */
export async function copierTexte(entree, nav = globalThis.navigator) {
  try { await nav.clipboard.writeText(documentTexte(modeleDocument(entree))); return { ok: true }; } catch { return { ok: false }; }
}

/** Retire le document d'impression de la page (idempotent). Appelé à `afterprint`, à la sortie de l'écran de clôture et à l'effacement. */
export function retirerImpression(doc = globalThis.document) { doc?.getElementById?.('impression')?.remove(); }

/**
 * « Imprimer » : le document est placé dans la page (#impression, masqué à l'écran) ; app.css n'imprime que lui. Une feuille de style en ligne
 * serait refusée par la politique de sécurité (style-src 'self') : on ne passe donc pas par un cadre ou une fenêtre. Sur Android, l'impression propose
 * « Enregistrer en PDF » (SUPPOSÉ) ; sur iPhone installé, non documenté (T5).
 */
export function imprimerDocument(entree, { fenetre = globalThis.window, doc = globalThis.document } = {}) {
  retirerImpression(doc);
  const analyse = new DOMParser().parseFromString(documentHtml(modeleDocument(entree)), 'text/html');
  const zone = doc.createElement('div');
  zone.id = 'impression';
  for (const n of [...analyse.body.childNodes]) zone.append(doc.importNode(n, true));
  doc.body.append(zone);
  fenetre.addEventListener('afterprint', () => retirerImpression(doc), { once: true });
  fenetre.print();
}
