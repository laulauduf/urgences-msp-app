// Fiche bilan, mode transmission et journal (cahier des charges 3.3, 4.6, 4.8, 4.10) : modèles PURS, sans DOM ni stockage.
// RÈGLES : les constantes sont affichées en valeurs BRUTES, horodatées, sans aucun jugement de l'appli (D-19, R14 : ni couleur, ni icône, ni seuil) ;
// la transmission suit la répartition SAED de la HAS (D-9) ; un champ vide de la fiche ne s'affiche pas ; aucune valeur médicale n'est écrite ici
// (les libellés de types de mesure viennent de SPEC.md, déroulé 4 ; les sigles sans source sont écrits en toutes lettres, D-10).
import { formaterT } from './horloge.js';
import { ROLES } from './roles.js';
import { avecUnite } from './unites.js';
import { titreDe } from './catalogue.js';
import { PUCES_ANTECEDENTS, PUCES_TRAITEMENTS, TRANCHES_AGE, texteListe, numeroVictime } from './victimes.js';

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
/** Libellés des moyens de remise (écran de clôture, journal) : ici, pour que le journal ne dise jamais le code interne (L8c, revue L8 m4). */
export const MOYENS = { montre: 'montré au SMUR', impression: 'imprimé', partage: 'partagé', enregistrement: 'enregistré dans un fichier', copie: 'copié dans le presse-papiers' };
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

/** « 42 ans », « 11 mois » avant 2 ans ; sans date valide : l'âge exact saisi (D-64), sinon l'âge estimé, montré COMME estimé ; rien → null. */
export function texteAge(identite, maintenant = Date.now()) {
  const age = ageDepuis(identite?.date_naissance, maintenant);
  if (age) return age.annees >= 2 ? `${age.annees} ans` : `${age.annees * 12 + age.mois} mois`;
  if (plein(identite?.age_exact)) return `${identite.age_exact.trim()} ans`;
  return plein(identite?.age_estime) ? `âge estimé : ${identite.age_estime.trim()}` : null;
}

// ───────── Corrections du journal (L7c, revue L7 C1) ─────────
// Une correction est une NOUVELLE entrée du journal qui renvoie à l'entrée corrigée ; l'original n'est jamais réécrit (3.3). Mais ce que la fiche, la
// transmission et l'export disent doit être la valeur CORRIGÉE : on retrouve donc, pour chaque constante, geste, case ou événement, sa dernière correction.

const AVANT_URGENCE = 'avant URGENCE';
/**
 * Une heure saisie « hh:mm » n'a pas de secondes : une constante notée « maintenant » peut tomber jusqu'à 59 s AVANT l'entrée URGENCE. On compare donc à la MINUTE :
 * seule une heure d'une minute antérieure à celle d'URGENCE est « avant URGENCE » ; dans la même minute, elle compte comme T+00:00.
 */
const estAvantUrgence = (t, debut) => Math.floor(t / 60000) < Math.floor(debut / 60000);
/** Clé de tri de la frise : une entrée de la même minute qu'URGENCE mais « plus tôt » ne passe pas devant URGENCE. */
const cleTri = (t, debut) => (estAvantUrgence(t, debut) ? t : Math.max(t, debut));
/** « T+mm:ss » depuis URGENCE ; avant l'entrée URGENCE le « T+ » serait faux : on le dit. */
const tPlusOuAvant = (t, debut) => (estAvantUrgence(t, debut) ? AVANT_URGENCE : formaterT(Math.max(0, t - debut)));

/** Dernière correction d'une entrée du journal : `{heure, texte}`, ou null. */
export function correctionDeEntree(fiche, idEntree) {
  if (!idEntree) return null;
  const c = (fiche?.journal ?? []).filter((e) => e.type === 'correction' && e.correction_de === idEntree).at(-1);
  return c ? { heure: hhmm(c.t), texte: String(c.donnees?.texte ?? '') } : null;
}

/** Entrée de journal d'une constante (lien `journal_id`, ou — fiche écrite par L7 — même heure, même type, même valeur). */
export function idJournalConstante(fiche, x) {
  if (x?.journal_id) return x.journal_id;
  return (fiche?.journal ?? []).find((e) => e.type === 'constante' && e.t === x?.t && e.donnees?.type === x?.type && String(e.donnees?.valeur) === String(x?.valeur))?.id ?? null;
}

/** Entrée de journal d'un geste saisi (même principe). */
export function idJournalGeste(fiche, g) {
  if (g?.journal_id) return g.journal_id;
  return (fiche?.journal ?? []).find((e) => e.type === 'geste' && e.t === g?.t && e.donnees?.texte === g?.texte)?.id ?? null;
}

/** « <début> — CORRIGÉ à hh:mm : <correction> (<mot> d'origine barrée : <original>) » : la correction est lue AVANT l'original, qui n'est jamais dit « nu ». */
const texteCorrige = (debut, original, c, mot) => `${debut} — CORRIGÉ à ${c.heure} : ${c.texte} (${mot} d'origine barrée : ${original})`;

// ───────── Constantes : valeurs brutes, sans interprétation ─────────

/**
 * @param {object[]} constantes
 * @param {object|null} fiche  si elle est donnée, chaque valeur porte sa correction éventuelle (`corrige`)
 * @returns {{type: string, libelle: string, valeurs: {t: number, valeur: string, unite: string, corrige: {heure: string, texte: string}|null}[]}[]} un tableau par type, types dans l'ordre de SPEC.md, valeurs chronologiques
 */
export function tableauConstantes(constantes, fiche = null) {
  const liste = Array.isArray(constantes) ? constantes : [];
  return TYPES_CONSTANTE.map((ty) => ({
    type: ty.id, libelle: ty.libelle,
    valeurs: liste.filter((c) => c?.type === ty.id).map((c) => ({ t: c.t, valeur: String(c.valeur), unite: typeof c.unite === 'string' ? c.unite : '', corrige: fiche ? correctionDeEntree(fiche, idJournalConstante(fiche, c)) : null })).sort((a, b) => a.t - b.t),
  })).filter((l) => l.valeurs.length > 0);
}

// ───────── Mode transmission (4.8) ─────────

const ligne = (texte) => ({ valeur: texte });
const lignes = (...l) => l.filter((x) => x !== null && x !== undefined && x.valeur !== '');
// une ligne « libellé : valeur » garde le libellé et la valeur séparés (l'écran de transmission met la valeur en gras) ET le texte entier (document, texte copié)
// `edit` (D-65, d) : où écrire la valeur quand l'écran de transmission la rend modifiable (voir edition.js) ; `initial` = ce que le champ propose d'abord
const champ = (libelle, v, edit = null) => (plein(v) ? { valeur: `${libelle} : ${v.trim()}`, libelle, texte: v.trim(), ...(edit ? { edit: { ...edit, initial: edit.initial ?? v.trim() } } : {}) } : null);
/** Ligne simple modifiable. */
const ligneEd = (texte, edit) => ({ valeur: texte, edit });
const edV = (v, bloc, cle) => ({ cible: 'victime', victime: v.id, bloc, cle, initial: String((bloc ? v[bloc]?.[cle] : v[cle]) ?? '') });

function pageLieu({ fiche, structure, champsSensibles }) {
  const lieu = fiche.lieu ?? { type: 'cabinet' };
  if (lieu.type === 'domicile') {
    const adresse = [lieu.adresse, plein(lieu.etage) ? `étage ${lieu.etage}` : null].filter(plein).join(', ');
    const edL = (cle) => ({ cible: 'lieu-champ', cle });
    return {
      id: 'lieu', titre: 'Lieu', adresse: adresse || 'Domicile : adresse à saisir',
      lignes: lignes(champ('Adresse', lieu.adresse, edL('adresse')), champ('Étage', lieu.etage, edL('etage')), champ("Code d'accès", lieu.code_acces, edL('code_acces')), champ('Accès', lieu.acces, edL('acces'))),
    };
  }
  // au cabinet, une valeur propre à CETTE intervention (fiche.lieu.surcharges, modifiée sur place dans la transmission) prime sur la structure ; la structure n'est jamais modifiée (D-65, d)
  const sur = lieu.surcharges ?? {};
  const t = (c) => (plein(sur[c]) ? sur[c].trim() : (structure?.texte?.(c) ?? 'non renseigné'));
  const edS = (cle, initial) => ({ cible: 'lieu-surcharge', cle, initial });
  const d = structure?.donnees ?? {};
  const manque = (c) => t(c) === 'non renseigné';
  // adresse exacte (L7c, revue L7 mineur 6) : ligne 1, complément (bâtiment, étage…), code postal et commune
  const adresse = plein(sur.adresse) ? sur.adresse.trim() : [t('adresse.ligne1'), t('adresse.complement'), [t('adresse.code_postal'), t('adresse.commune')].filter((x) => x !== 'non renseigné').join(' ')].filter((x) => x !== '' && x !== 'non renseigné').join(', ');
  const code = plein(sur.code_entree) ? sur.code_entree : champsSensibles?.code_entree;
  const optionnel = (libelle, chemin) => (manque(chemin) ? null : ligneEd(`${libelle} : ${t(chemin)}`, edS(chemin, t(chemin))));
  // donnée attendue au cabinet : dite « non renseigné », jamais masquée (4.8, 3.2)
  const attendu = (libelle, chemin) => ligneEd(`${libelle} : ${t(chemin)}`, edS(chemin, manque(chemin) ? '' : t(chemin)));
  // les autres codes que la structure déclare (portail, etc.) : sur ce téléphone seulement, et dits s'ils manquent
  // D-88 / CABINET-1 (PROVISOIRE, le plus protecteur) : les lignes de CODE D'ACCÈS sont marquées `prive` — dites à l'écran de transmission (le 15 en a besoin, 4.8), JAMAIS écrites dans le document exporté
  // ni dans le texte copié (export.js les retire) : ce sont des secrets du lieu, pas des données de la fiche.
  const prive = (l) => ({ ...l, prive: true });
  const autresCodes = (Array.isArray(d.champs_sensibles_locaux) ? d.champs_sensibles_locaux : []).filter((c) => plein(c?.id) && c.id !== 'code_entree' && plein(c?.libelle))
    .map((c) => prive(plein(champsSensibles?.[c.id]) ? ligne(`${c.libelle} : ${champsSensibles[c.id].trim()}`) : ligne(`${c.libelle} : non renseigné sur ce téléphone`)));
  return {
    id: 'lieu', titre: 'Lieu', adresse: adresse || 'Adresse de la structure : non renseignée',
    lignes: lignes(
      // donnée de structure manquante sur ce téléphone : dite, jamais masquée (4.8)
      prive(plein(code) ? ligneEd(`Code d'entrée : ${code.trim()}`, edS('code_entree', code.trim())) : ligneEd("Code d'entrée : non renseigné sur ce téléphone", edS('code_entree', ''))),
      ...autresCodes,
      ligneEd(`Structure : ${t('structure.nom')}`, edS('structure.nom', manque('structure.nom') ? '' : t('structure.nom'))),
      ligneEd(`Adresse : ${adresse || 'non renseignée'}`, edS('adresse', adresse)),
      optionnel('Repère', 'adresse.repere'), attendu('Accès', 'acces.description'), attendu('Stationnement des secours', 'acces.stationnement_secours'),
      attendu("Point d'accueil", 'acces.point_accueil'), attendu('Défibrillateur (DAE)', 'dae.emplacement'),
      ...(Array.isArray(d.materiel?.contenants) ? d.materiel.contenants.filter((c) => plein(c?.libelle) && plein(c?.emplacement)).map((c) => ligne(`${c.libelle} : ${c.emplacement}`)) : []),
      ligneEd(`Numéro de rappel : ${t('numero_rappel')}`, edS('numero_rappel', manque('numero_rappel') ? '' : t('numero_rappel'))),
    ),
  };
}

/** Sous-titre d'une victime dans une page (écran : `titre: true`) ; seulement quand la fiche en porte plusieurs. Le numéro est STABLE (tiré de l'identifiant). */
const sousTitre = (numero) => ({ valeur: `— Victime ${numero} —`, titre: true });
/** Victime sans rien de noté : dite, jamais passée sous silence (D-64b, D4). */
const RIEN_NOTE = { valeur: 'rien noté', vide: true };

/** Lignes de S propres à UNE victime (D-64) : identité, âge, circonstances, conscience, notes. Le sous-titre n'est posé que si la victime a au moins une ligne. */
function lignesSVictime(v, numero, multi, maintenant) {
  const id = v.identite ?? {}; const c = v.circonstances ?? {}; const bv = v.bilan_vital ?? {};
  const ageTexte = texteAge(id, maintenant);
  const ageLigne = ageTexte === null ? null : ageTexte.startsWith('âge estimé : ') ? ligne(`Âge estimé : ${ageTexte.slice('âge estimé : '.length)}`) : champ('Âge', ageTexte);
  const tranche = TRANCHES_AGE.find((t) => t.id === id.tranche_age);
  const l = lignes(
    champ('Patient', [id.prenom, id.nom].filter(plein).join(' ')), champ('Sexe', id.sexe), ageLigne, tranche ? champ("Tranche d'âge", tranche.court) : null,
    champ('Début des signes', c.heure_debut, edV(v, 'circonstances', 'heure_debut')), champ('Lieu dans la structure', c.lieu_dans_structure, edV(v, 'circonstances', 'lieu_dans_structure')), champ('Témoin', c.temoin, edV(v, 'circonstances', 'temoin')), champ('Gestes déjà faits', c.gestes_deja_faits, edV(v, 'circonstances', 'gestes_deja_faits')),
    champ('Conscience', [bv.avpu ? `AVPU ${bv.avpu}` : '', bv.conscience].filter(plein).join(' — '), edV(v, 'bilan_vital', 'conscience')), champ('Respiration', bv.respiration, edV(v, 'bilan_vital', 'respiration')), champ('Circulation', bv.circulation, edV(v, 'bilan_vital', 'circulation')),
    champ('Notes', v.notes, edV(v, null, 'notes')),
  );
  return multi ? [sousTitre(numero), ...(l.length > 0 ? l : [RIEN_NOTE])] : l;
}

function pageS({ fiche, appelant, protocoleId, maintenant }) {
  const victimes = Array.isArray(fiche.victimes) ? fiche.victimes : [];
  const multi = victimes.length > 1;
  const numeroDe = (idVictime) => numeroVictime(fiche, idVictime);
  /** « (Victime 2) » quand il y a plusieurs victimes et que la saisie est rattachée à l'une d'elles. */
  const marque = (idVictime) => (multi && numeroDe(idVictime) > 0 ? ` (Victime ${numeroDe(idVictime)})` : '');
  const journal = fiche.journal ?? [];
  const debut = journal[0]?.t ?? fiche.cree_le;
  // « ACR constaté » seulement tant que l'intervention EST en ACR (R1f, M1) : après un retour en « Autre situation », la transmission ne le dit plus (le journal garde la bascule et le retour horodatés)
  // `protocoleId` : l'identifiant de l'ACR, OU la liste des identifiants des ACR (adulte, enfant…).
  // L'heure est celle de l'ENTRÉE DANS L'ACR EN COURS (P4c, n2 de la revue R1f) : la première situation de la série d'ACR qui se termine la fiche — pas celle d'une première bascule annulée
  // (ACR, retour en « Autre situation », nouvelle bascule : l'heure de la seconde) ; de l'ACR adulte à l'ACR enfant, la série continue : l'heure de l'adulte.
  const situations = fiche.situations ?? [];
  const idsAcr = Array.isArray(protocoleId) ? protocoleId : [protocoleId];
  const estAcr = (s) => s?.protocole != null && idsAcr.includes(s.protocole);
  let acr;
  for (let k = situations.length - 1; k >= 0 && estAcr(situations[k]); k--) acr = situations[k];
  // événements répétables : on compte les touchers VALIDES ; un toucher corrigé au journal est compté à part (L7c, revue L7 C1)
  const events = {};
  for (const e of journal) {
    if (e.type !== 'evenement') continue;
    const groupe = (events[e.donnees?.libelle ?? e.donnees?.id ?? '?'] ??= { valides: [], corriges: 0 });
    if (correctionDeEntree(fiche, e.id)) groupe.corriges += 1; else groupe.valides.push(e.t);
  }
  // gestes saisis, gestes notés « fait à hh:mm » (checklist) et ÉTAPES COCHÉES (tuiles et checklist) : tous les gestes réalisés vont dans S (D-9, revue L7 M2)
  const faits = [
    ...(fiche.gestes_produits ?? []).map((g) => ({ mot: `geste${marque(g.victime)}`, t: g.t, texte: g.texte, entree: idJournalGeste(fiche, g) })),
    ...journal.filter((e) => e.type === 'geste' && e.donnees?.id).map((e) => ({ mot: 'geste', t: e.t, texte: e.donnees.libelle ?? e.donnees.id, entree: e.id })),
    // (G1, D-66 : une étape de RECUEIL cochée par sa saisie n'est pas un geste : sa valeur est déjà dite par ses propres lignes — début des signes, notes, antécédents, constantes —, jamais en double « fait : … »)
    ...Object.entries(fiche.checklist ?? {}).filter(([, v]) => Number.isFinite(v?.coche_le) && v.saisie !== true).map(([cle, v]) => {
      const entree = journal.filter((e) => e.type === 'case' && e.donnees?.id === cle && !e.donnees?.decochee).at(-1);
      return { mot: 'fait', t: v.coche_le, texte: entree?.donnees?.libelle ?? cle, entree: entree?.id ?? null };
    }),
  ].filter((g) => plein(g.texte)).sort((a, b) => a.t - b.t);
  const constantes = (fiche.constantes ?? []).filter((x) => x && x.valeur !== undefined && x.valeur !== null && plein(String(x.valeur))).sort((a, b) => a.t - b.t);
  return {
    id: 's', titre: 'S — Situation',
    lignes: lignes(
      appelant ? ligne(`Appelant : ${appelant.personne} (${appelant.fonction})`) : null,
      // D-63 / D-64 : le nombre de victimes est le nombre d'onglets, premier renseignement du message au 15 (PSC p. 11)
      multi ? ligne(`Nombre de victimes : ${victimes.length}`) : null,   // D-64b (m5) : jamais « 1 » par défaut — seulement quand il y a au moins deux fiches
      ligne(`Début de l'intervention : ${hhmm(debut)}`),
      acr ? ligne(`ACR constaté à ${hhmm(acr.depuis)}`) : null,
      ...victimes.flatMap((v) => lignesSVictime(v, numeroVictime(fiche, v.id), multi, maintenant)),
      // valeurs brutes datées, ordre chronologique, aucune tendance (Q-29) ; une valeur corrigée au journal est transmise CORRIGÉE, l'original dit « barré »
      ...constantes.map((x) => {
        const debutLigne = `${hhmm(x.t)} ${libelleType(x.type)}${marque(x.victime)}`;
        const corr = correctionDeEntree(fiche, idJournalConstante(fiche, x));
        return ligne(corr ? texteCorrige(debutLigne, avecUnite(x.valeur, x.unite), corr, 'valeur') : `${debutLigne} : ${avecUnite(x.valeur, x.unite)}`);
      }),
      ...faits.map((g) => {
        const debutLigne = `${hhmm(g.t)} (${tPlusOuAvant(g.t, debut)}) ${g.mot}`;
        const corr = correctionDeEntree(fiche, g.entree);
        return ligne(corr ? texteCorrige(debutLigne, g.texte.trim(), corr, 'entrée') : `${debutLigne} : ${g.texte.trim()}`);
      }),
      // simple comptage des touchers, chacun avec son heure ET son T+ (4.8)
      ...Object.entries(events).map(([libelle, e]) => {
        const n = e.valides.length;
        const heures = e.valides.map((t) => `${hhmm(t)} (${tPlusOuAvant(t, debut)})`).join(', ');
        const corriges = e.corriges > 0 ? `${n > 0 ? ', ' : ' ('}dont ${e.corriges} corrigé${e.corriges > 1 ? 's' : ''}, voir le journal${n > 0 ? '' : ')'}` : '';
        return ligne(`${libelle} : ${n} fois${n > 0 ? ` — ${heures}` : ''}${corriges}`);
      }),
    ),
  };
}

/**
 * Pages du mode transmission : Lieu, puis S, A, E, D (D-9). Chaque page porte `lignes` (champs vides omis) ; la page Lieu porte aussi `adresse`
 * (ligne d'adresse toujours visible en tête de chaque page).
 */
export function construireTransmission({ fiche, structure, champsSensibles = {}, appelant = null, protocoleId = null, maintenant = Date.now() }) {
  const lieu = pageLieu({ fiche, structure, champsSensibles });
  const victimes = Array.isArray(fiche.victimes) ? fiche.victimes : [];
  const multi = victimes.length > 1;
  // A : par victime (D-64) ; le sous-titre n'est posé que si la victime a au moins une ligne
  const lignesA = victimes.flatMap((v) => {
    const l = lignes(
      champ('Antécédents', texteListe(PUCES_ANTECEDENTS, v.antecedents_puces, v.antecedents), edV(v, null, 'antecedents')), champ('Traitements', texteListe(PUCES_TRAITEMENTS, v.traitements_puces, v.traitements), edV(v, null, 'traitements')),
      champ('Allergies', v.allergies, edV(v, null, 'allergies')), champ('Médecin traitant', v.medecin_traitant, edV(v, null, 'medecin_traitant')), champ('Poids estimé', v.identite?.poids_estime, edV(v, 'identite', 'poids_estime')),
    );
    return multi ? [sousTitre(numeroVictime(fiche, v.id)), ...(l.length > 0 ? l : [RIEN_NOTE])] : l;
  });
  return [
    lieu,
    pageS({ fiche, appelant, protocoleId, maintenant }),
    { id: 'a', titre: 'A — Antécédents', lignes: lignesA },
    { id: 'e', titre: 'E — Évaluation', lignes: lignes(plein(fiche.evaluation) ? ligne(fiche.evaluation.trim()) : null) },
    // D : la demande écrite par l'équipe, rien d'autre (D-91, DEMANDE-1 : A). Aucune demande par défaut : la phrase proposée n'est qu'une suggestion à toucher (écran de transmission), elle ne s'écrit que si on la touche.
    { id: 'd', titre: 'D — Demande', lignes: lignes(plein(fiche.demande) ? ligne(fiche.demande.trim()) : null) },
  ];
}

// ───────── Journal (4.10) ─────────

/** Texte lisible d'une entrée du journal (aucun contenu médical : seulement ce que l'équipe a fait ou saisi). */
const ACTIONS_CHRONO = { demarrage: 'démarré', relance: 'relancé', arret: 'arrêté', pause: 'en pause', reprise: 'repris' };
export function libelleEntree(e) {
  const d = e?.donnees ?? {};
  const role = (id) => ROLES.find((r) => r.id === id)?.libelle ?? String(id);
  switch (e?.type) {
    case 'urgence': return 'URGENCE touchée';
    // (V1, N2 : une entrée sans libellé — fiche ancienne, écran de secours — est traduite par le catalogue ; un identifiant inconnu reste tel quel)
    case 'situation': return d.libelle ? `Situation : ${d.libelle}` : d.protocole ? `Situation : ${titreDe(d.protocole) ?? d.protocole}` : 'Situation';
    case 'role': return `Rôle ${role(d.role)} : ${d.de ?? '—'} → ${d.vers ?? '—'}`;
    case 'profession': return `Profession : ${d.vers ?? 'non réglée'}`;
    case 'case': return d.decochee ? `Décoché : ${d.libelle ?? d.id}` : `Fait : ${d.libelle ?? d.id}`;
    case 'evenement': return d.libelle ?? String(d.id ?? 'événement');
    case 'constante': return `${libelleType(d.type)}${d.victime ? ` (Victime ${d.victime})` : ''} : ${avecUnite(d.valeur, d.unite)}`;
    case 'geste': return `Geste${d.victime ? ` (Victime ${d.victime})` : ''} : ${d.texte ?? d.libelle ?? d.id ?? ''}`.trim();
    case 'appel_lance': return `Appel lancé : ${d.numero ?? ''}`.trim();
    case 'appel_simule': return `Appel simulé : ${d.numero ?? ''}`.trim();
    case 'appel_fait': return "J'ai appelé";
    case 'chronometre': {
      // lot A, A10 : « Métronome démarré », « Cycle 2 relancé » — jamais « Chronomètre metronome : demarrage »
      const action = ACTIONS_CHRONO[d.action] ?? d.action ?? '';
      if (d.id === 'metronome') return `Métronome ${action}`.trim();
      if (d.id === 'cycle') return `Cycle${d.cycle ? ` ${d.cycle}` : ''} ${action}`.trim();
      return `Chronomètre ${d.id ?? ''} ${action}`.replace(/\s+/g, ' ').trim();
    }
    case 'echeance': return d.id === 'cycle' ? 'Échéance du cycle' : `Échéance : ${d.id ?? ''}`.trim();
    case 'rattrapage': return 'Échéance franchie pendant l\'absence';
    case 'horloge_modifiee': return 'Heure du téléphone modifiée';
    case 'reprise': return 'Fiche reprise';
    case 'nouvelle_urgence': return 'Nouvelle urgence';
    case 'stockage_echec': return 'Enregistrement en échec';
    case 'version_differente': return `Appli mise à jour : version ${d.de ?? '?'} → ${d.vers ?? '?'}`;
    case 'secours_protocole': return 'Protocole illisible : écran de secours';
    case 'acr_illisible': return "Autre arrêt cardiaque illisible : l'arrêt cardiaque en cours est gardé";
    case 'purge_reportee': return "Délai d'effacement atteint (effacement reporté)";
    case 'export': return d.moyen ? `Export confirmé : ${MOYENS[d.moyen] ?? d.moyen}` : 'Export';
    case 'note': return d.texte ?? 'Note';
    // D-64 : seulement le numéro et les quantités retirées, jamais l'identité de la victime
    case 'victime_ajoutee': return `Victime ${d.numero ?? '?'} ajoutée`;
    case 'victime_retiree': {
      const parts = [d.constantes > 0 ? `${d.constantes} constante${d.constantes > 1 ? 's' : ''}` : '', d.gestes > 0 ? `${d.gestes} geste${d.gestes > 1 ? 's' : ''}` : ''].filter(Boolean);
      return `Victime ${d.numero ?? '?'} retirée${parts.length > 0 ? ` — retiré de la fiche : ${parts.join(', ')} (le journal les garde)` : ''}`;
    }
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
  const debut = journal[0]?.t ?? fiche?.cree_le ?? 0;
  // frise CHRONOLOGIQUE (4.10) : par heure, et à heure égale dans l'ordre d'écriture (tri stable) — une constante saisie « pour 14:00 » à 14:30 reste à sa place
  const lignesFrise = journal.filter((e) => e.type !== 'correction').map((e) => ({
    id: e.id, type: e.type, t: e.t, heure: hhmm(e.t), tPlus: estAvantUrgence(e.t, debut) ? AVANT_URGENCE : formaterT((e.t_ecoule ?? 0) * 1000), texte: libelleEntree(e), barree: false, corrigeable: true, corrections: [],
  })).sort((a, b) => cleTri(a.t, debut) - cleTri(b.t, debut));
  for (const c of journal.filter((e) => e.type === 'correction')) {
    const cible = lignesFrise.find((l) => l.id === c.correction_de);
    if (cible) { cible.corrections.push({ texte: c.donnees?.texte ?? '', heure: hhmm(c.t), tPlus: formaterT((c.t_ecoule ?? 0) * 1000) }); cible.barree = true; }
  }
  return lignesFrise;
}

/** Page « Journal » de l'aperçu « Montrer au SMUR » (L8c, revue L8 m3) : la frise, avec heure ET T+, les entrées corrigées marquées et leur correction. */
export function pageJournal(fiche) {
  const l = [];
  for (const e of frise(fiche)) {
    l.push({ valeur: `${e.heure} · ${e.tPlus} ${e.texte}${e.barree ? ' (corrigé)' : ''}` });
    for (const c of e.corrections) l.push({ valeur: `correction à ${c.heure} (${c.tPlus}) : ${c.texte}` });
  }
  return { id: 'journal', titre: 'Journal', lignes: l };
}
