// Fiche bilan, mode transmission et journal (cahier des charges 3.3, 4.6, 4.8, 4.10) : modèles PURS, sans DOM ni stockage.
// RÈGLES : les constantes sont affichées en valeurs BRUTES, horodatées, sans aucun jugement de l'appli (D-19, R14 : ni couleur, ni icône, ni seuil) ;
// la transmission suit la répartition SAED de la HAS (D-9) ; un champ vide de la fiche ne s'affiche pas ; aucune valeur médicale n'est écrite ici
// (les libellés de types de mesure viennent de SPEC.md, déroulé 4 ; les sigles sans source sont écrits en toutes lettres, D-10).
import { formaterT } from './horloge.js';
import { ROLES } from './roles.js';

/** Types de constantes de SPEC.md (déroulé 4), dans cet ordre. SpO₂ : sigle sourcé du glossaire ; les autres, en toutes lettres (D-10). */
export const TYPES_CONSTANTE = [
  { id: 'pa', libelle: 'Pression artérielle', clavier: 'text' },
  { id: 'fc', libelle: 'Fréquence cardiaque', clavier: 'decimal' },
  { id: 'fr', libelle: 'Fréquence respiratoire', clavier: 'decimal' },
  { id: 'spo2', libelle: 'SpO₂', clavier: 'decimal' },
  { id: 'temperature', libelle: 'Température', clavier: 'decimal' },
  { id: 'glycemie', libelle: 'Glycémie capillaire', clavier: 'decimal' },
  { id: 'douleur', libelle: 'Douleur', clavier: 'decimal' },
];
const libelleType = (id) => TYPES_CONSTANTE.find((t) => t.id === id)?.libelle ?? String(id);

const deux = (n) => String(n).padStart(2, '0');
export const hhmm = (ms) => `${deux(new Date(ms).getHours())}:${deux(new Date(ms).getMinutes())}`;
const plein = (v) => typeof v === 'string' && v.trim() !== '';

// ───────── Âge ─────────

/** Date de naissance en trois champs (jour, mois, année) : vraie date du calendrier, ni vide ni absurde. */
export function dateNaissanceValide(n) {
  if (!n || typeof n !== 'object') return false;
  const [j, m, a] = [n.jour, n.mois, n.annee].map((x) => (/^\d{1,4}$/.test(String(x ?? '').trim()) ? Number(x) : NaN));
  if (![j, m, a].every(Number.isInteger) || a < 1850) return false;
  const d = new Date(a, m - 1, j);
  return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === j;
}

/** @returns {{annees: number, mois: number}|null} âge à `maintenant` ; null si la date est invalide ou future */
export function ageDepuis(naissance, maintenant = Date.now()) {
  if (!dateNaissanceValide(naissance)) return null;
  const ref = new Date(maintenant);
  const j = Number(naissance.jour); const m = Number(naissance.mois); const a = Number(naissance.annee);
  const total = (ref.getFullYear() - a) * 12 + (ref.getMonth() + 1 - m) - (ref.getDate() < j ? 1 : 0);
  if (total < 0) return null;
  return { annees: Math.floor(total / 12), mois: total % 12 };
}

/** « 42 ans », « 11 mois » avant 2 ans ; sans date valide, l'âge estimé est montré COMME estimé ; rien → null. */
export function texteAge(identite, maintenant = Date.now()) {
  const age = ageDepuis(identite?.date_naissance, maintenant);
  if (age) return age.annees >= 2 ? `${age.annees} ans` : `${age.annees * 12 + age.mois} mois`;
  return plein(identite?.age_estime) ? `âge estimé : ${identite.age_estime.trim()}` : null;
}

// ───────── Constantes : valeurs brutes, sans interprétation ─────────

/** @returns {{type: string, libelle: string, valeurs: {t: number, valeur: string}[]}[]} un tableau par type, types dans l'ordre de SPEC.md, valeurs chronologiques */
export function tableauConstantes(constantes) {
  const liste = Array.isArray(constantes) ? constantes : [];
  return TYPES_CONSTANTE.map((ty) => ({
    type: ty.id, libelle: ty.libelle,
    valeurs: liste.filter((c) => c?.type === ty.id).map((c) => ({ t: c.t, valeur: String(c.valeur) })).sort((a, b) => a.t - b.t),
  })).filter((l) => l.valeurs.length > 0);
}

// ───────── Mode transmission (4.8) ─────────

const ligne = (texte) => ({ valeur: texte });
const lignes = (...l) => l.filter((x) => x !== null && x !== undefined && x.valeur !== '');
const champ = (libelle, v) => (plein(v) ? ligne(`${libelle} : ${v.trim()}`) : null);

function pageLieu({ fiche, structure, champsSensibles }) {
  const lieu = fiche.lieu ?? { type: 'cabinet' };
  if (lieu.type === 'domicile') {
    const adresse = [lieu.adresse, plein(lieu.etage) ? `étage ${lieu.etage}` : null].filter(plein).join(', ');
    return {
      id: 'lieu', titre: 'Lieu', adresse: adresse || 'Domicile : adresse à saisir',
      lignes: lignes(champ('Adresse', lieu.adresse), champ('Étage', lieu.etage), champ("Code d'accès", lieu.code_acces), champ('Accès', lieu.acces)),
    };
  }
  const t = (c) => structure?.texte?.(c) ?? 'non renseigné';
  const d = structure?.donnees ?? {};
  const manque = (c) => t(c) === 'non renseigné';
  const adresse = [t('adresse.ligne1'), [t('adresse.code_postal'), t('adresse.commune')].filter((x) => x !== 'non renseigné').join(' ')].filter((x) => x !== '' && x !== 'non renseigné').join(', ');
  const code = champsSensibles?.code_entree;
  const optionnel = (libelle, chemin) => (manque(chemin) ? null : ligne(`${libelle} : ${t(chemin)}`));
  return {
    id: 'lieu', titre: 'Lieu', adresse: adresse || 'Adresse de la structure : non renseignée',
    lignes: lignes(
      // donnée de structure manquante sur ce téléphone : dite, jamais masquée (4.8)
      plein(code) ? ligne(`Code d'entrée : ${code.trim()}`) : ligne("Code d'entrée : non renseigné sur ce téléphone"),
      ligne(`Structure : ${t('structure.nom')}`),
      ligne(`Adresse : ${adresse || 'non renseignée'}`),
      optionnel('Repère', 'adresse.repere'), optionnel('Accès', 'acces.description'), optionnel('Stationnement des secours', 'acces.stationnement_secours'),
      optionnel("Point d'accueil", 'acces.point_accueil'), optionnel('Défibrillateur (DAE)', 'dae.emplacement'),
      ...(Array.isArray(d.materiel?.contenants) ? d.materiel.contenants.filter((c) => plein(c?.libelle) && plein(c?.emplacement)).map((c) => ligne(`${c.libelle} : ${c.emplacement}`)) : []),
      ligne(`Numéro de rappel : ${t('numero_rappel')}`),
    ),
  };
}

function pageS({ fiche, appelant, protocoleId, maintenant }) {
  const id = fiche.identite ?? {}; const c = fiche.circonstances ?? {}; const bv = fiche.bilan_vital ?? {};
  const debut = fiche.journal?.[0]?.t ?? fiche.cree_le;
  const acr = (fiche.situations ?? []).find((s) => s.protocole === protocoleId);
  const events = {};
  for (const e of fiche.journal ?? []) if (e.type === 'evenement') (events[e.donnees?.libelle ?? e.donnees?.id ?? '?'] ??= []).push(e.t);
  const gestes = [
    ...(fiche.gestes_produits ?? []).map((g) => ({ t: g.t, texte: g.texte })),
    ...(fiche.journal ?? []).filter((e) => e.type === 'geste' && e.donnees?.id).map((e) => ({ t: e.t, texte: e.donnees.libelle ?? e.donnees.id })),
  ].filter((g) => plein(g.texte)).sort((a, b) => a.t - b.t);
  const constantes = (fiche.constantes ?? []).filter((x) => x && plein(String(x.valeur))).sort((a, b) => a.t - b.t);
  return {
    id: 's', titre: 'S — Situation',
    lignes: lignes(
      appelant ? ligne(`Appelant : ${appelant.personne} (${appelant.fonction})`) : null,
      champ('Patient', [id.prenom, id.nom].filter(plein).join(' ')), champ('Sexe', id.sexe), champ('Âge', texteAge(id, maintenant)),
      champ('Circonstances : début', c.heure_debut), champ('Lieu dans la structure', c.lieu_dans_structure), champ('Témoin', c.temoin), champ('Gestes déjà faits', c.gestes_deja_faits),
      ligne(`Début de l'intervention : ${hhmm(debut)}`),
      acr ? ligne(`ACR constaté à ${hhmm(acr.depuis)}`) : null,
      champ('Conscience', [bv.avpu ? `AVPU ${bv.avpu}` : '', bv.conscience].filter(plein).join(' — ')), champ('Respiration', bv.respiration), champ('Circulation', bv.circulation),
      ...constantes.map((x) => ligne(`${hhmm(x.t)} ${libelleType(x.type)} : ${x.valeur}`)),     // valeurs brutes datées, ordre chronologique, aucune tendance (Q-29)
      ...gestes.map((g) => ligne(`${hhmm(g.t)} (${formaterT(g.t - debut)}) geste : ${g.texte.trim()}`)),
      ...Object.entries(events).map(([libelle, ts]) => ligne(`${libelle} : ${ts.length} ${ts.length > 1 ? 'fois' : 'fois'} (${ts.map(hhmm).join(', ')})`)),   // simple comptage des touchers
    ),
  };
}

/**
 * Pages du mode transmission : Lieu, puis S, A, E, D (D-9). Chaque page porte `lignes` (champs vides omis) ; la page Lieu porte aussi `adresse`
 * (ligne d'adresse toujours visible en tête de chaque page).
 */
export function construireTransmission({ fiche, structure, champsSensibles = {}, appelant = null, protocoleId = null, maintenant = Date.now() }) {
  const lieu = pageLieu({ fiche, structure, champsSensibles });
  const id = fiche.identite ?? {};
  return [
    lieu,
    pageS({ fiche, appelant, protocoleId, maintenant }),
    { id: 'a', titre: 'A — Antécédents', lignes: lignes(champ('Antécédents', fiche.antecedents), champ('Traitements', fiche.traitements), champ('Allergies', fiche.allergies), champ('Médecin traitant', fiche.medecin_traitant), champ('Poids estimé', id.poids_estime)) },
    { id: 'e', titre: 'E — Évaluation', lignes: lignes(plein(fiche.evaluation) ? ligne(fiche.evaluation.trim()) : null) },
    { id: 'd', titre: 'D — Demande', lignes: lignes(plein(fiche.demande) ? ligne(fiche.demande.trim()) : null) },
  ];
}

// ───────── Journal (4.10) ─────────

/** Texte lisible d'une entrée du journal (aucun contenu médical : seulement ce que l'équipe a fait ou saisi). */
export function libelleEntree(e) {
  const d = e?.donnees ?? {};
  const role = (id) => ROLES.find((r) => r.id === id)?.libelle ?? String(id);
  switch (e?.type) {
    case 'urgence': return 'URGENCE touchée';
    case 'situation': return d.libelle ? `Situation : ${d.libelle}` : d.protocole ? `Situation : ${d.protocole}` : 'Situation';
    case 'role': return `Rôle ${role(d.role)} : ${d.de ?? '—'} → ${d.vers ?? '—'}`;
    case 'profession': return `Profession : ${d.vers ?? 'non réglée'}`;
    case 'case': return d.decochee ? `Case décochée : ${d.libelle ?? d.id}` : `Case cochée : ${d.libelle ?? d.id}`;
    case 'evenement': return d.libelle ?? String(d.id ?? 'événement');
    case 'constante': return `${libelleType(d.type)} : ${d.valeur}`;
    case 'geste': return `Geste : ${d.texte ?? d.libelle ?? d.id ?? ''}`.trim();
    case 'appel_lance': return `Appel lancé : ${d.numero ?? ''}`.trim();
    case 'appel_simule': return `Appel simulé : ${d.numero ?? ''}`.trim();
    case 'appel_fait': return "J'ai appelé";
    case 'chronometre': return `Chronomètre ${d.id ?? ''} : ${d.action ?? ''}${d.cycle ? ` (cycle ${d.cycle})` : ''}`.trim();
    case 'echeance': return `Échéance : ${d.id ?? ''}`.trim();
    case 'rattrapage': return 'Échéance franchie pendant l\'absence';
    case 'horloge_modifiee': return 'Heure du téléphone modifiée';
    case 'reprise': return 'Fiche reprise';
    case 'nouvelle_urgence': return 'Nouvelle urgence';
    case 'stockage_echec': return 'Enregistrement en échec';
    case 'version_differente': return `Appli mise à jour : version ${d.de ?? '?'} → ${d.vers ?? '?'}`;
    case 'secours_protocole': return 'Protocole illisible : écran de secours';
    case 'purge_reportee': return "Délai d'effacement atteint (effacement reporté)";
    case 'export': return 'Export';
    case 'note': return d.texte ?? 'Note';
    case 'correction': return `Correction : ${d.texte ?? ''}`.trim();
    default: return String(e?.type ?? 'entrée');
  }
}

/**
 * Frise chronologique : une ligne par entrée (les entrées « correction » sont rattachées à l'entrée d'origine, qui reste lisible et BARRÉE).
 * @returns {{id: string, type: string, heure: string, tPlus: string, texte: string, barree: boolean, corrigeable: boolean, corrections: {texte: string, heure: string, tPlus: string}[]}[]}
 */
export function frise(fiche) {
  const journal = Array.isArray(fiche?.journal) ? fiche.journal : [];
  const lignesFrise = journal.filter((e) => e.type !== 'correction').map((e) => ({
    id: e.id, type: e.type, heure: hhmm(e.t), tPlus: formaterT((e.t_ecoule ?? 0) * 1000), texte: libelleEntree(e), barree: false, corrigeable: true, corrections: [],
  }));
  for (const c of journal.filter((e) => e.type === 'correction')) {
    const cible = lignesFrise.find((l) => l.id === c.correction_de);
    if (cible) { cible.corrections.push({ texte: c.donnees?.texte ?? '', heure: hhmm(c.t), tPlus: formaterT((c.t_ecoule ?? 0) * 1000) }); cible.barree = true; }
  }
  return lignesFrise;
}
