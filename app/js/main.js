// Démarrage de l'appli (lot L2 : socle). Règle de fond : l'écran d'accueil s'affiche IMMÉDIATEMENT, sans attendre ni le service
// worker, ni la vérification du cache, ni le chargement de la structure ni celui des protocoles ; tout cela tourne en parallèle
// et vient seulement renseigner la ligne d'état de préparation (cahier des charges 2.8, 4.1).
import { definirPoint, retirerPoint, definirNote, pointCodesLocaux, rendre as rendreEtat } from './etat-preparation.js';
import { testerSonEtEcran, pointsDuTest, phraseDuTest } from './test-appareil.js';
import { enregistrer, verifierCache, activerNouvelleVersion, ETATS_MAJ } from './mise-a-jour.js';
import { chargerStructure, problemeStructure } from './structure.js';
import { chargerProtocole } from './protocole.js';
import { lireEnvironnement, bandeauInstallationNecessaire, pointInstallation, TEXTE_BANDEAU_INSTALLATION } from './installation.js';
import { stockage } from './stockage.js';
import { appliquerTheme, themeLocal } from './theme.js';
import { chargerGroupes } from './professions.js';
import { afficherReglages } from './ecrans/reglages.js';
import { afficherGlossaire } from './ecrans/glossaire.js';
import { chargerGlossaire } from './glossaire.js';
import { afficherAccueil as afficherEcranAccueil } from './ecrans/accueil.js';
import { InterfaceIntervention } from './ecrans/interface-intervention.js';
import { Intervention } from './intervention.js';
import { Son } from './son.js';
import { EcranAllume } from './ecran-allume.js';
import { lireNumeros, chargerNumeros } from './numeros.js';
import { afficherCloture } from './ecrans/cloture.js';
import { afficherMateriel } from './ecrans/materiel.js';
import { afficherAPropos } from './ecrans/a-propos.js';
import { construireMateriel } from './materiel.js';
import { messageEffacement, viderPressePapiers, TEXTE_BROUILLON_DOCUMENT } from './export.js';
import { creer } from './dom.js';
import { appelant } from './roles.js';

// Thème mémorisé localement : appliqué avant tout le reste, pour éviter un clignotement clair → sombre.
appliquerTheme(themeLocal());

// POUR UN 2e PROTOCOLE, toucher ces endroits (revue aval M3) : cette constante et ses usages dans main.js (clôture depuis l'accueil, reprise, ouverture d'une urgence, À propos) ;
// intervention.js (ACR / AUTRE, protocoleId unique à la construction) ; ecrans/interface-intervention.js (barre selon ACR, choix de situation) ; bilan.js (filtre par protocole) ; le texte BROUILLON est global.
// DEUXIÈME PROTOCOLE DÉJÀ PRÉVU (D-51) : la checklist commune de « Autre situation », `protocoles/urgence-commune.json` (même format que l'ACR, sans cycle ni DAE). Elle est chargée par
// protocole-commun.js (aucune requête tant que le fichier n'est pas dans la liste de cache), tenue par `Intervention.protocoleCommun` (identifiants préfixés « commun: » dans `fiche.checklist`, copie dans
// `fiche.protocoles_utilises`), affichée par `afficherAutre` (interface-intervention.js) avec `afficherAcr`. Pour la publier : ajouter le fichier, `node outils/preparer-version.mjs` (liste de cache), et laisser
// tests/controle-json.mjs dispenser CE fichier de la règle R9 (pas de premier écran). Un NOUVEAU protocole d'une autre situation suit la même voie : un id, un chargeur, un préfixe, un écran.
const PROTOCOLE_PAR_DEFAUT = 'acr-adulte-dae';

/** État de l'appli : une seule intervention à la fois, un seul son, un seul verrou d'écran. */
const app = { son: new Son(), ecran: new EcranAllume(), intervention: null, interface: null, accueilTouche: false, accueilUI: null, etatMaj: null, numeros: lireNumeros(null) };

/** Accueil : URGENCE immédiat ; les fiches en attente s'ajoutent quand le stockage a répondu (jamais attendues). */
function montrerAccueil() {
  app.accueilUI = afficherEcranAccueil(document.getElementById('contenu'), {
    auUrgence: () => demarrerUrgence('reel'),
    auAutre: () => demarrerUrgence('reel', 'autre'),
    auSimulation: () => demarrerUrgence('simulation'),
    auxReglages: ouvrirReglages,
    auGlossaire: ouvrirGlossaire,
    auMateriel: ouvrirMateriel,
    auAPropos: ouvrirAPropos,
    auTester: testerLaPreparation,
    auToucher: () => { app.accueilTouche = true; },
  });
  afficherMiseAJour(app.etatMaj);   // revue m1 : le bandeau « Nouvelle version » appartient à l'accueil : il y revient après l'intervention
  rafraichirEnAttente();
}

async function rafraichirEnAttente() {
  const ui = app.accueilUI;
  await stockage.vider(); // les écritures en attente (fiche terminée, mise en pause) doivent être en base avant qu'on liste
  const { enAttente } = await stockage.trouverReprise({ accueilTouche: true });
  if (ui !== app.accueilUI || app.intervention) return; // l'écran a changé entre-temps
  ui.afficherEnAttente(enAttente, {
    reprendre: (r) => reprendreFiche(r),
    exporter: (r) => ouvrirCloture(r),
    effacer: async (r) => {
      const vidage = r.presse_papiers_utilise ? viderPressePapiers() : null;   // EN PREMIER, dans le toucher (L8c, revue L8 M3)
      let res = await stockage.effacerFiche(r.mode, r.id);
      if (res.ok && vidage && (await vidage) === 'vide') res = { ...res, pressePapiers: 'vide' };
      if (ui === app.accueilUI) {
        // revue m10 (2.9) : le résultat est dit — heure d'effacement, ou cause de l'échec avec invitation à réessayer (L8 : et le sort du presse-papiers)
        ui.afficherResultat(messageEffacement(res));
        rafraichirEnAttente();
      }
    },
  });
}

/**
 * « Exporter » sur la ligne d'une fiche en attente (4.1) : l'écran de clôture s'ouvre SANS intervention (ni en-tête, ni barre, ni son, ni chronomètre).
 * La fiche est marquée « affichée » tant que l'écran est ouvert : la purge ne l'efface jamais en silence pendant qu'on la montre (2.9).
 */
async function ouvrirCloture(resume) {
  const ui = app.accueilUI;
  const lu = await stockage.lireFiche(resume.mode, resume.id);
  if (app.intervention || ui !== app.accueilUI) return;
  if (!lu.ok) {
    ui?.afficherResultat?.(lu.raison === 'purge_en_attente' ? "Vérification d'effacement en cours : réessayez dans un instant." : "Cette fiche n'a pas pu être ouverte : elle reste sur l'appareil, vous pouvez l'effacer.");
    return;
  }
  const fiche = lu.fiche;
  stockage.definirAffichee(fiche.id);
  const reglages = await stockage.lireReglages();
  if (app.intervention || ui !== app.accueilUI) { stockage.definirAffichee(null); return; }
  const contenu = document.getElementById('contenu');
  afficherCloture(contenu, {
    fiche, stockage,
    structure: () => contexte.structure, champsSensibles: () => reglages.champs_sensibles ?? {}, appelant: () => appelant(fiche.roles), protocoleId: PROTOCOLE_PAR_DEFAUT,
    effacer: () => stockage.effacerFiche(fiche.mode, fiche.id),
    apresEffacement: (res) => { stockage.definirAffichee(null); montrerAccueil(); app.accueilUI.afficherResultat(messageEffacement(res)); },
    auFermer: () => { stockage.definirAffichee(null); montrerAccueil(); },
    // URGENCE reste à un toucher même sur cet écran (L8c, revue L8 m8) ; la fiche exportée reste en attente, intacte
    auUrgence: () => { stockage.definirAffichee(null); demarrerUrgence('reel'); },
    libelleFermer: "Retour à l'accueil",
  });
  contenu.focus({ preventScroll: true }); window.scrollTo(0, 0);   // m1 (revue aval) : le nouvel écran s'ouvre en haut de page, sinon le bandeau BROUILLON sort de la vue
}

// ───────── Intervention ─────────

/**
 * Toucher « Arrêt cardiaque » (ou « Autre urgence », « Simulation ») : SYNCHRONE — la fiche, le son et le verrou d'écran sont lancés dans le geste, la situation est posée
 * dans le même geste (refonte R1 : plus d'écran de choix avant la conduite à tenir) et l'écran suivant s'affiche à l'instant ; le protocole arrive en parallèle.
 */
function demarrerUrgence(mode, situation = 'acr') {
  app.accueilTouche = true;
  const i = nouvelleIntervention();
  i.demarrer(mode);
  if (situation === 'autre') i.choisirAutre(); else i.choisirAcr().catch(() => {});
  ouvrirInterface(i);
}

const nouvelleIntervention = () => new Intervention({ stockage, son: app.son, ecran: app.ecran, chargerProtocole, protocoleId: PROTOCOLE_PAR_DEFAUT });

function ouvrirInterface(i) {
  app.intervention = i;
  document.querySelector('#bandeaux [data-bandeau="maj"]')?.remove();   // revue m1
  app.interface = new InterfaceIntervention({
    intervention: i, son: app.son, ecran: app.ecran, numeros: () => app.numeros, structure: () => contexte.structure, groupes: () => contexte.groupes,
    actions: {
      accueil: () => quitterIntervention({ aller: true }),
      professionChangee: () => majPointProfession(),
      testeFait: (r) => appliquerResultatTest(r),   // « Tester le son et l'écran » du menu alimente aussi la ligne d'état (M5)
      nouvelleUrgence: () => { quitterIntervention({ aller: false }); demarrerUrgence('reel'); },
      urgenceReelle: () => { quitterIntervention({ aller: false }); demarrerUrgence('reel'); }, // la simulation reste en pause, la VRAIE fiche s'ouvre
      terminee: () => quitterIntervention({ aller: true, detruite: true }),
      // « Clôturer et effacer » réussi depuis l'intervention (L8) : retour à l'accueil, qui dit « Fiche effacée à hh:mm »
      effacee: (res) => { quitterIntervention({ aller: true, detruite: true }); app.accueilUI?.afficherResultat(messageEffacement(res)); },
    },
  });
  app.interface.monter();
}

/** Sort de l'intervention SANS la terminer (sa fiche reste en base, intacte) ; l'écriture en attente est forcée sans être attendue. */
function quitterIntervention({ aller, detruite = false }) {
  const i = app.intervention;
  app.interface?.demonter();
  app.interface = null; app.intervention = null;
  if (i && !detruite) i.mettreEnPause(); // la partie qui compte (arrêt, détachement) est synchrone ; le vidage de l'écriture part en parallèle
  if (aller) montrerAccueil();
}

async function reprendreFiche(resume, { automatique = false } = {}) {
  const lu = await stockage.lireFiche(resume.mode, resume.id);
  if (!lu.ok || app.intervention || (automatique && app.accueilTouche)) { if (!app.intervention) rafraichirEnAttente(); return; }
  const i = nouvelleIntervention();
  try {
    await i.reprendre(lu.fiche, { automatique });
  } catch {
    // revue m11 : une fiche qui fait échouer la reprise ne doit ni rester « affichée » (la purge la reporterait toute la session) ni laisser l'accueil muet
    i.detruire();
    app.accueilUI?.afficherResultat?.("Une fiche n'a pas pu être reprise (contenu incomplet) : elle reste sur l'appareil, vous pouvez l'effacer.");
    if (!app.intervention) rafraichirEnAttente();
    return;
  }
  if (app.intervention || (automatique && app.accueilTouche)) { i.detruire(); return; }
  ouvrirInterface(i);
}

/** Au lancement, APRÈS l'affichage de l'accueil et la purge : reprise directe d'une fiche récente (règles de 2.8), sinon lignes « en attente ». */
async function lancerReprise() {
  const { reprise } = await stockage.trouverReprise({ accueilTouche: app.accueilTouche });
  if (reprise && !app.accueilTouche && !app.intervention) await reprendreFiche(reprise, { automatique: true });
  else if (!app.intervention) rafraichirEnAttente();
}

function poserBandeauBrouillon() {
  // légende du signe ✱ des étapes (relecture design D4) : l'information « provisoire » reste lisible sans badge sur chaque ligne
  document.getElementById('bandeaux').append(creer('div', 'bandeau bandeau-brouillon', `✱ provisoire ou à valider · ${TEXTE_BROUILLON_DOCUMENT}`));
}

/** Contexte partagé, rempli au fil des chargements (la page ne les attend jamais). */
const contexte = { structure: null, groupes: [], reglages: null };

async function ouvrirReglages() {
  const contenu = document.getElementById('contenu');
  await afficherReglages(contenu, {
    stockage,
    structure: contexte.structure,
    groupes: contexte.groupes,
    onRetour: () => { montrerAccueil(); },
    onChangement: (cle) => { if (cle === 'profession' || cle === 'champs_sensibles') majPointProfession(); },
  });
  contenu.focus({ preventScroll: true }); window.scrollTo(0, 0);   // m1 (revue aval) : le nouvel écran s'ouvre en haut de page, sinon le bandeau BROUILLON sort de la vue
}

/** Glossaire consulté depuis l'accueil (4.12) : lu à l'ouverture ; fichier illisible → message, jamais d'exception. */
async function ouvrirGlossaire() {
  const contenu = document.getElementById('contenu');
  const glossaire = await chargerGlossaire();
  afficherGlossaire(contenu, { glossaire, auFermer: () => { montrerAccueil(); } });
  contenu.focus({ preventScroll: true }); window.scrollTo(0, 0);   // m1 (revue aval) : le nouvel écran s'ouvre en haut de page, sinon le bandeau BROUILLON sort de la vue
}

/** « Matériel » depuis l'accueil (4.14) : les contenants et leurs emplacements, tirés de config/structure.json. */
function ouvrirMateriel() {
  const contenu = document.getElementById('contenu');
  afficherMateriel(contenu, { modele: construireMateriel({ protocole: null, structure: contexte.structure }), avecArticles: false, auFermer: () => { montrerAccueil(); } });
  contenu.focus({ preventScroll: true }); window.scrollTo(0, 0);   // m1 (revue aval) : le nouvel écran s'ouvre en haut de page, sinon le bandeau BROUILLON sort de la vue
}

/** « À propos » depuis l'accueil (4.15). */
function ouvrirAPropos() {
  const contenu = document.getElementById('contenu');
  afficherAPropos(contenu, { chargerProtocole: () => chargerProtocole(PROTOCOLE_PAR_DEFAUT), stockage, auFermer: () => { montrerAccueil(); } });
  contenu.focus({ preventScroll: true }); window.scrollTo(0, 0);   // m1 (revue aval) : le nouvel écran s'ouvre en haut de page, sinon le bandeau BROUILLON sort de la vue
}

const NOTE_NON_TESTE = "Son et écran : pas encore testés sur ce téléphone (tuile « Préparer ce téléphone » de l'accueil).";
let testEnCours = false;

/** M5 : le résultat du test alimente la ligne d'état (points « son », « écran », « stockage persistant ») ; la note « pas encore testés » disparaît. */
function appliquerResultatTest(r) {
  const p = pointsDuTest(r);
  definirPoint('son', p.son); definirPoint('ecran', p.ecran); definirPoint('persistance', p.persistance);
  definirNote(null);
}

/**
 * « Préparer ce téléphone » (test du son et de l'écran) depuis l'accueil (M5, cahier 2.5, 2.6, 2.8) : UN geste de l'utilisateur pour essayer le son (bip d'alerte), demander le verrou d'écran d'essai
 * et la persistance du stockage — sans lancer d'intervention. Jamais bloquant ; le résultat est dit sur l'accueil et dans la ligne d'état.
 */
async function testerLaPreparation() {
  if (testEnCours) return;
  testEnCours = true;
  const ui = app.accueilUI;
  ui?.afficherTest('Test en cours…');
  try {
    const r = await testerSonEtEcran({ son: app.son, ecran: app.ecran });
    appliquerResultatTest(r);
    if (ui === app.accueilUI) { ui.afficherTest(phraseDuTest(r)); if (r.son.contexte === 'running' && r.son.canal !== 'aucun') ui.demanderConfirmationSon(); }   // r1 : pas de « Avez-vous entendu ? » quand le test dit qu'aucun son n'a pu partir
  } catch {
    if (ui === app.accueilUI) ui.afficherTest("Le test n'a pas pu se faire sur ce téléphone : touchez à nouveau le bouton.");
  } finally { testEnCours = false; }
}

/** Point « codes d'accès du lieu » (4.1) : informatif, jamais bloquant ; ne dit jamais les valeurs. */
function majPointCodes() {
  const p = pointCodesLocaux(contexte.structure, contexte.reglages?.champs_sensibles);
  if (p) definirPoint('codes', p); else retirerPoint('codes');
}

/** Point « profession » de la ligne d'état (4.1) : ne bloque jamais, signale seulement. */
async function majPointProfession() {
  const r = await stockage.lireReglages();
  contexte.reglages = r;
  majPointCodes();
  const groupe = contexte.groupes.find((g) => g.id === r.profession);
  definirPoint('profession', r.profession === null
    ? { texte: 'Profession non réglée — à régler dans Réglages (comportement du groupe le plus restreint)', ok: false }
    : { texte: `Profession : ${groupe ? groupe.libelle : r.profession} — modifiable dans Réglages`, ok: true });
}

/** Bandeaux du stockage : non bloquants, jamais sur un bouton vital (écran ACR : lot L5a). */
function poserBandeau(cle, texte, { bouton } = {}) {
  const zone = document.getElementById('bandeaux');
  zone.querySelector(`[data-bandeau="${cle}"]`)?.remove();
  if (texte === null) return;
  const b = creer('div', 'bandeau bandeau-avertissement', texte);
  b.dataset.bandeau = cle;
  if (bouton) {
    const x = creer('button', 'bouton', bouton.libelle);
    x.type = 'button';
    x.addEventListener('click', () => { bouton.action(); poserBandeau(cle, null); });
    b.append(' ', x);
  }
  zone.append(b);
}

function brancherStockage() {
  stockage.ecouter((e) => {
    if (e.type === 'degrade') {
      poserBandeau('stockage', e.actif ? 'Fiche non enregistrée — ne fermez pas l\'appli' : null);
      definirPoint('stockage', { texte: e.actif ? 'Stockage de l\'appareil indisponible : les fiches ne sont pas enregistrées' : 'Stockage de l\'appareil opérationnel', ok: !e.actif });
    }
    if (e.type === 'presse_papiers_non_vide') poserBandeau('presse', 'Une fiche effacée avait été copiée : videz le presse-papiers (la copie peut contenir des données de santé)');
    if (e.type === 'purge_reportee') poserBandeau('purge', 'Délai d\'effacement atteint — exportez maintenant ou effacez');
    if (e.type === 'horloge') poserBandeau('horloge', 'Horloge du téléphone modifiée — vérifier puis effacer', { bouton: { libelle: "J'ai vérifié l'heure", action: () => stockage.acquitterHorloge() } });
  });
}

function afficherBandeauInstallation() {
  if (!bandeauInstallationNecessaire(lireEnvironnement())) return;
  const b = creer('div', 'bandeau bandeau-danger', TEXTE_BANDEAU_INSTALLATION);
  b.dataset.bandeau = 'installation';
  document.getElementById('bandeaux').prepend(b);
}

/** Bouton « Nouvelle version disponible — Recharger » : seulement quand aucune fiche n'est ouverte (2.4). */
function afficherMiseAJour(etat) {
  app.etatMaj = etat;
  const zone = document.getElementById('bandeaux');
  zone.querySelector('[data-bandeau="maj"]')?.remove();
  definirPoint('version', { texte: `Version ${self.URGENCES_VERSION ?? '?'}`, ok: etat !== ETATS_MAJ.attenteFiche });
  if (etat === ETATS_MAJ.disponible) {
    definirPoint('version', { texte: 'Nouvelle version disponible — Recharger', ok: false });
    if (app.intervention) return;   // revue m1 : jamais de bouton « Recharger » pendant une intervention (il perdrait une fiche gardée en mémoire si le stockage est en panne)
    const b = creer('div', 'bandeau');
    b.dataset.bandeau = 'maj';
    const bouton = creer('button', 'bouton bouton-accent', 'Nouvelle version disponible — Recharger');
    bouton.type = 'button';
    bouton.addEventListener('click', () => { activerNouvelleVersion(); });
    b.append(bouton);
    zone.append(b);
  } else if (etat === ETATS_MAJ.attenteFiche) {
    definirPoint('version', { texte: 'Mise à jour en attente : une fiche est encore ouverte', ok: false });
  }
}

async function verifierPreparation() {
  // Fichiers hors ligne : on attend que le service worker soit prêt avant de juger (au tout premier lancement, il s'installe encore).
  definirPoint('hors-ligne', { texte: 'Préparation hors ligne en cours…', ok: false });
  const controle = async () => {
    const { complet } = await verifierCache();
    definirPoint('hors-ligne', {
      texte: complet ? 'Fichiers hors ligne complets' : "Hors ligne non garanti : ouvrez l'appli une fois avec du réseau",
      ok: complet,
    });
  };
  const { pris } = await enregistrer({ onEtat: afficherMiseAJour, onPret: controle });
  if (!pris) await controle();
}

async function verifierStructure() {
  const analyse = await chargerStructure();
  contexte.structure = analyse;
  const probleme = problemeStructure(analyse);
  definirPoint('structure', { texte: probleme ?? 'Configuration de la structure renseignée', ok: probleme === null });
  majPointCodes();
}

async function verifierProtocoles() {
  // Contrôle de cohérence à l'exécution du protocole du prototype ; en cas d'échec, c'est l'ouverture de la situation (Intervention.choisirAcr)
  // qui basculera vers l'écran de secours. Ici, on prévient seulement dans la ligne d'état.
  const resultat = await chargerProtocole(PROTOCOLE_PAR_DEFAUT);
  definirPoint('protocole', {
    texte: resultat.ok ? `Protocole « ${resultat.protocole.titre_court} » lisible` : `Protocole illisible : l'écran de secours sera utilisé (${resultat.raisons.join(' ; ')})`,
    ok: resultat.ok,
  });
}

function demarrer() {
  // iPhone : l'état :active d'un bouton ne s'affiche que si la page a un gestionnaire tactile (retour visuel immédiat, 5.1).
  document.addEventListener('touchstart', () => {}, { passive: true });
  montrerAccueil();
  poserBandeauBrouillon();
  afficherBandeauInstallation();
  definirPoint('installation', pointInstallation(lireEnvironnement()));
  definirNote(NOTE_NON_TESTE);
  rendreEtat();
  // Tout le reste en parallèle, sans que l'accueil l'attende.
  brancherStockage();
  verifierPreparation();
  const structure = verifierStructure();
  verifierProtocoles();
  demarrerStockage(structure);
}

/**
 * Démarre le stockage (purge de l'ouverture, retour au premier plan, minuterie) APRÈS la structure — elle peut régler le plancher du
 * délai et la durée de reprise — mais sans l'attendre plus d'une seconde. Rien de tout cela ne retarde l'accueil.
 */
async function demarrerStockage(promesseStructure) {
  const attente = new Promise((r) => setTimeout(r, 1000));
  await Promise.race([promesseStructure, attente]);
  const p = contexte.structure?.donnees?.parametres;
  stockage.demarrer({
    plancherH: Number.isFinite(p?.delai_effacement_plancher_h) ? p.delai_effacement_plancher_h : undefined,
    repriseMaxH: Number.isFinite(p?.reprise_directe_max_h) ? p.reprise_directe_max_h : undefined,
  });
  // « Vérification d'effacement en attente » si la purge de l'ouverture dépasse environ 1 s (2.8)
  definirPoint('purge', { texte: "Vérification d'effacement en cours…", ok: true });
  Promise.race([stockage.purgeTerminee().then(() => 'faite'), new Promise((r) => setTimeout(() => r('attente'), 1000))]).then((r) => {
    if (r === 'attente') definirPoint('purge', { texte: "Vérification d'effacement en attente", ok: false });
    stockage.purgeTerminee().then(() => retirerPoint('purge'));
  });
  lancerReprise();
  chargerNumeros().then((json) => { app.numeros = lireNumeros(json, contexte.structure); });
  contexte.groupes = await chargerGroupes({ structure: contexte.structure });
  await majPointProfession();
  const r = await stockage.lireReglages();
  appliquerTheme(r.theme);
}

demarrer();
