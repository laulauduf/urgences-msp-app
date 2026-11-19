// Interface d'une intervention : en-tête fixe, barre du bas, bandeaux, et l'écran courant (choix de situation, écran ACR, panneau d'alerte,
// lieu, menu, secours). Cahier des charges 4.0 à 4.3 bis, 4.7, 4.11, 5.1 à 5.3.
// RÈGLES : rien ne recouvre l'en-tête, la barre d'outils ni la conduite à tenir ; aucun bouton n'attend le stockage ;
// aucun ordre ni texte médical en dur — tout vient du protocole. Refonte R1 (D-39) : l'ancienne barre à cinq boutons, les tuiles vitales et la checklist
// sont réunies dans l'écran ACR (ecrans/acr.js) ; le menu « ⋯ » est dans l'en-tête.
import { creer, bouton, heureLocale } from '../dom.js';
import { formaterDuree, texteDepassement, MARQUE_PROVISOIRE, MARQUE_A_VALIDER } from '../horloge.js';

/**
 * Marques à ajouter après le texte d'un chronomètre (zone du cycle, rappel, bandeau d'échéance) : « provisoire — non validé » si le protocole
 * porte `provisoire` (sauf si la note le dit déjà) et A_VALIDER si le contenu n'est pas établi (revue m6). Jamais d'ajout sans l'une de ces causes.
 */
function suffixeMarques(c, { note = c.note } = {}) {
  const dejaProvisoire = /provisoire/i.test(note ?? '');
  const provisoire = (c.provisoire || c.noteProvisoire) && !dejaProvisoire ? ` — ${MARQUE_PROVISOIRE}` : '';
  return `${provisoire}${c.aValider ? ` — ${MARQUE_A_VALIDER}` : ''}`;
}
import { afficherSecours } from './secours.js';
import { afficherAlerte } from './alerte.js';
import { afficherLieu } from './lieu.js';
import { testerSonEtEcran, phraseDuTest, etatTest, confirmerSon } from '../test-appareil.js';
import { actionsVitales, libelleBarre } from '../barre-vitale.js';
import { afficherRoles } from './roles.js';
import { afficherProfession } from './profession.js';
import { afficherAcr, etatAcrInitial } from './acr.js';
import { afficherGlossaire } from './glossaire.js';
import { construireVolet } from './fiche.js';
import { resumeVictime } from '../victimes.js';
import { afficherTransmission } from './transmission.js';
import { afficherJournal } from './journal.js';
import { afficherCloture } from './cloture.js';
import { afficherMateriel } from './materiel.js';
import { afficherAPropos } from './a-propos.js';
import { construireMateriel } from '../materiel.js';
import { construireTransmission } from '../bilan.js';
import { texteBandeau, texteBandeauCourt, texteBandeauRempli } from '../roles.js';
import { ACR, AUTRE } from '../intervention.js';
import { PROTOCOLES_ACR, CONDUITES, titreDe } from '../catalogue.js';
import { ID_COMMUN, protocolePublie } from '../protocole-commun.js';
/** Après la bascule « Autre situation » → ACR, les touchers sur le contenu sont ignorés ce temps (R1f, M2). */
const DELAI_REBOND_BASCULE_MS = 600;
/** P-1 (revue du lot K) : à l'ARRIVÉE dans une conduite, un toucher du bandeau « Arrêt cardiaque » aussi proche est le 2e toucher d'un double toucher sur le menu : il est ignoré (les autres touchers, jamais). */
const DELAI_REBOND_ARRIVEE_MS = 220;
/** M-1 : au-delà de cette part de la zone de la liste, le bandeau « Arrêt cardiaque » n'est plus collant (il reste en tête de liste, dans le flux). */
const PART_MAX_BANDEAU_ACR = 0.15;
const PLANCHER_TEXTE_ACR = 14;   // D-97b (m-1) : plus petite taille (px) du texte des boutons ACR, dernier recours avant de laisser un mot déborder

/** D-97 : vrai si le texte d'un bouton sort de sa case (à droite ou à gauche ; en hauteur le bouton grandit avec ses lignes, il ne déborde pas) ; position réelle des lignes de texte contre la zone intérieure du bouton (bordure et remplissage exclus). */
function texteDeborde(bouton) {
  const r = bouton.getBoundingClientRect();
  const s = getComputedStyle(bouton);
  const bord = (p) => (parseFloat(s[`border${p}Width`]) || 0) + (parseFloat(s[`padding${p}`]) || 0);
  const plage = document.createRange(); plage.selectNodeContents(bouton);
  const t = plage.getBoundingClientRect();
  if (t.width === 0 && t.height === 0) return false;
  return t.right > r.right - bord('Right') + 0.5 || t.left < r.left + bord('Left') - 0.5 || bouton.scrollWidth > bouton.clientWidth + 1;
}

/**
 * ÉCRANS DE SAISIE : liste UNIQUE des panneaux où l'on tape. Ils ne sont JAMAIS reconstruits sur l'événement « changement » : sinon la
 * frappe en cours serait effacée à chaque événement (bug silencieux, sans erreur). Tout nouvel écran avec un champ de saisie doit être
 * ajouté ici ; un test (tests/unitaires/protections-surete.test.mjs) échoue s'il manque. Exception voulue : l'écran ACR (écran principal, pas un panneau) se redessine
 * mais garde sa saisie de l'heure dans `this.cl`. D-64 : la fiche bilan n'est PLUS un panneau : c'est le volet (`ecrans/fiche.js`), monté une fois HORS de #contenu, que
 * `rendre()` ne touche jamais (test dédié dans protections-surete.test.mjs).
 */
export const ECRANS_DE_SAISIE = ['lieu', 'roles', 'profession', 'transmission', 'journal', 'cloture', 'apropos'];

/**
 * Barre d'OUTILS du bas (refonte R1, D-39) : Temps · Métronome · Appeler le 15 · Fiche — dans cet ordre, comme la maquette. Le menu « ⋯ » est dans l'en-tête.
 * « Appeler le 15 » ouvre le panneau d'alerte (l'ancien bouton ALERTER) ; « Fiche » ouvre la fiche bilan (un second toucher revient à la conduite à tenir).
 */
export const OUTILS = [
  { id: 'temps', libelle: 'Temps' },
  { id: 'metronome', libelle: 'Métronome' },
  { id: 'alerter', libelle: 'Appeler le 15' },
  { id: 'fiche', libelle: 'Fiche' },
];

export class InterfaceIntervention {
  /**
   * @param {{intervention: object, son: object, ecran: object, numeros: object, structure: () => object|null,
   *          actions: {accueil: () => void, nouvelleUrgence: () => void, urgenceReelle: () => void, terminee: () => void}}} options
   */
  constructor({ intervention, son, ecran, numeros, structure, groupes = () => [], actions }) {
    Object.assign(this, { intervention, son, ecran, numerosFn: numeros, structureFn: structure, groupesFn: groupes, actions });
    this.panneau = null;            // null (écran principal : conduite à tenir) | 'alerte' | 'lieu' | 'menu' | 'situation' | 'roles' | 'profession' | 'glossaire' | 'transmission' | 'journal' | 'cloture' | 'materiel' | 'apropos'
    this.repriseRepliee = false; this.versionVue = false;   // bandeaux « Fiche reprise » (replié au premier toucher) et « Appli mise à jour » (acquitté)
    this.volet = null; this.voletOuvert = false; this.delaiVolet = null; this.cleVolet = ''; this.dernierResume = null;   // fiche bilan : le volet (D-64), indépendant de `panneau`
    this.tr = { page: 0, edition: false, ligne: null };     // mode transmission : page courante, saisie E / D ouverte
    this.jr = { corrige: null, texte: '', erreur: null };   // journal : entrée en cours de correction
    this.cloture = null;                       // écran « Clôture et export » (L8) : il a son propre état et se redessine lui-même
    this.cl = etatAcrInitial();   // précisions dépliées, saisie de l'heure, pastille courante : survit au redessin de l'écran ACR
    this.clCommun = etatAcrInitial();   // idem pour la checklist commune de « Autre situation » (D-51)
    this.lieuRetour = 'alerte';         // écran où revient « Retour » du lieu : 'alerte' (d'origine) ou null = écran principal (« Autre situation »), voir ouvrirLieu
    this.secours = null; this.minuteur = null; this.debranchements = []; this.messageTest = null; this.echeances = new Map();
    this.zone = { entete: document.getElementById('entete'), barre: document.getElementById('barre'), contenu: document.getElementById('contenu'), bandeaux: document.getElementById('bandeaux'), appli: document.getElementById('appli') };
  }

  get structure() { return this.structureFn(); }

  // ───────── Montage ─────────

  monter() {
    const { appli, entete, barre } = this.zone;
    document.body.dataset.mode = 'intervention';
    appli.classList.add('gabarit');
    entete.hidden = false; barre.hidden = false;
    this.construireEntete();
    this.construireBarre();
    this.monterInsufflationsCentre();
    this.monterVolet();
    this.monterSuiviClavier();   // D-70 : le champ en cours de saisie reste visible au-dessus du clavier, aussi dans la zone centrale
    if (this.intervention.transmissionAuRetour) { this.intervention.transmissionAuRetour = false; this.panneau = 'transmission'; }   // reprise après un appel : transmission d'abord
    this.debranchements.push(this.intervention.ecouter((e) => this.surEvenement(e)));
    // premier toucher dans la fiche reprise : le bandeau « Fiche reprise » se replie APRÈS l'action touchée (jamais entre le toucher et le clic :
    // le contenu ne bouge pas sous le doigt)
    // R1f (M2) : après un changement de situation (tuile rouge, bouton « Passer en ACR »), les touchers sur le contenu sont ignorés ~600 ms : un double toucher ne doit rien cocher sur l'écran qui s'ouvre
    // P4c (n1 de la revue R1f, règle absolue 5) : le toucher de la case « Alerter » (cochage_auto: appel) n'est JAMAIS ignoré — il ouvre le panneau d'alerte, il ne coche rien : le perdre sans signal serait gratuit
    const ouvreAlerte = (cible) => { const id = cible?.closest?.('button[data-case]')?.dataset.case; return typeof id === 'string' && this.intervention.etape(id)?.cochage_auto === 'appel'; };
    const ignorerRebond = (ev) => { if (this.panneau === null && performance.now() < this.touchesIgnoreesJusqua && !ouvreAlerte(ev.target)) { ev.stopPropagation(); ev.preventDefault(); } };
    this.zone.contenu.addEventListener('click', ignorerRebond, true);
    this.debranchements.push(() => this.zone.contenu.removeEventListener('click', ignorerRebond, true));
    // (P-1 : seul le TOUCHER est visé — le double toucher du téléphone ; un clic de souris de poste de bureau ne l'est jamais. `pointerType` absent (vieux navigateur) : on protège par prudence.)
    const ignorerBandeauArrivee = (ev) => { if (ev.pointerType !== 'mouse' && performance.now() < (this.bandeauIgnoreJusqua ?? 0) && ev.target.closest?.('#bandeau-acr')) { ev.stopPropagation(); ev.preventDefault(); } };
    this.zone.contenu.addEventListener('click', ignorerBandeauArrivee, true);
    this.debranchements.push(() => { this.zone.contenu.removeEventListener('click', ignorerBandeauArrivee, true); this.arreterBandeauAcr(); });
    const marquerToucher = () => { if (this.intervention.repriseDe) this.repriseRepliee = true; };
    const replier = () => { if (this.intervention.repriseDe && this.repriseRepliee) this.majBandeauxFixes(); };
    for (const zoneToucher of [this.zone.contenu, this.zone.barre]) {
      zoneToucher.addEventListener('click', marquerToucher, true);   // capture : le drapeau est posé avant l'action, qui redessine l'écran
      zoneToucher.addEventListener('click', replier);               // bulle : sans redessin, on replie quand même, après l'action
      this.debranchements.push(() => { zoneToucher.removeEventListener('click', marquerToucher, true); zoneToucher.removeEventListener('click', replier); });
    }
    this.son.onBattement = () => this.pulser();
    this.son.onEtat = () => this.majBandeauxSon();
    this.ecran.onEtat = () => this.majBandeauxSon();
    this.debranchements.push(this.son.brancherReprise(document), this.ecran.brancher(document));
    this.arreterBoucle = this.son.lancerBoucleVisuelle();
    this.minuteur = setInterval(() => this.rafraichir(), 250);
    this.rendre();
    this.rafraichir();
  }

  demonter() {
    clearInterval(this.minuteur); clearTimeout(this.delaiVolet);
    this.volet?.element.remove(); this.volet = null; this.voletOuvert = false; this.cleVolet = ''; this.dernierResume = null;
    this.arreterBoucle?.();
    this.secours?.arreter(); this.secours = null;
    this.cloture?.demonter(); this.cloture = null;
    for (const d of this.debranchements) { try { d(); } catch { /* déjà débranché */ } }
    this.debranchements = [];
    this.son.onBattement = () => {}; this.son.onEtat = () => {}; this.ecran.onEtat = () => {};
    const { appli, entete, barre, bandeaux } = this.zone;
    appli.classList.remove('gabarit');
    document.getElementById('insuf-centre')?.remove();
    entete.hidden = true; barre.hidden = true; entete.replaceChildren(); barre.replaceChildren();
    for (const b of bandeaux.querySelectorAll('[data-bandeau="simulation"],[data-bandeau="reprise"],[data-bandeau="acr-illisible"],[data-bandeau="version"],[data-bandeau="son"],[data-bandeau="ecran"],[data-bandeau="echeance"],[data-bandeau="rattrapage"]')) b.remove();
    delete document.body.dataset.mode; delete document.body.dataset.texte; delete document.body.dataset.agrandi; delete document.body.dataset.panneau;
  }

  surEvenement(e) {
    // pendant une saisie, un changement ne doit PAS reconstruire le formulaire (on perdrait la frappe en cours) : voir ECRANS_DE_SAISIE
    if (e.type === 'changement' && !ECRANS_DE_SAISIE.includes(this.panneau)) this.rendre();
    // D-66 : une saisie dans une étape de recueil écrit dans la fiche sans reconstruire l'écran (la frappe en cours serait perdue) ; seul le résumé sous l'en-tête est relu
    if (e.type === 'saisie') this.majResumeFiche();
    // retour d'un appel `tel:` (page revenue au premier plan) : le mode transmission s'ouvre seul (4.7, 2.10)
    // (L7c : seulement si l'appli a été masquée dans les secondes qui ont suivi l'appel — voir Intervention.surveillerDepart)
    if (e.type === 'retour' && this.intervention.appelEnAttente) {
      const parti = this.intervention.appelParti;
      this.intervention.appelEnAttente = false; this.intervention.appelParti = false;
      if (parti) this.ouvrirPanneau('transmission');
    }
    // la conduite à tenir dépend de la profession et des habilitations lues : elle se redessine quand l'une ou l'autre arrive ou change
    if ((e.type === 'reglages' || e.type === 'habilitations') && this.panneau === null) this.rendre();
    if (e.type === 'roles' || e.type === 'reglages') this.majPuceEtRoles();
    if (e.type === 'echeance') this.afficherEcheance(e);
    if (e.type === 'rattrapage') this.afficherRattrapage(e);
  }

  // ───────── En-tête ─────────

  construireEntete() {
    const { entete } = this.zone;
    entete.replaceChildren();
    // en-tête réduit à l'essentiel : le titre avec le TEMPS écoulé dessous (le chronomètre global ne prend plus de tuile), UNE pastille d'avertissement (son · écran, seulement tant
    // qu'une parade manque) et le menu
    const bloc = creer('div', 'entete-bloc');
    bloc.append(creer('h1', 'entete-titre', '', { id: 'entete-titre' }));
    const temps = creer('p', 'entete-temps', '', { id: 'barre-temps', role: 'group', 'aria-label': 'Temps depuis URGENCE' });
    temps.append(creer('span', null, 'Temps '), creer('b', null, '00:00', { id: 'chrono-global' }));
    bloc.append(temps);
    entete.append(bloc);
    entete.append(bouton('', 'bouton pastille-avert', () => this.ouvrirPanneau('telephone'), { id: 'pastille-avert', hidden: '' }));
    entete.append(bouton('⋯', 'bouton bouton-menu', () => this.ouvrirPanneau(this.panneau === 'menu' ? null : 'menu'), { id: 'barre-menu', 'aria-label': 'Menu' }));
    // ligne de RÉSUMÉ de la fiche (D-64), compacte, sous le titre : elle montre la victime ouverte et le nombre de victimes, et rouvre le volet ; absente tant que rien n'est noté
    const resume = bouton('', 'bouton resume-fiche', () => this.ouvrirVolet(), { id: 'resume-fiche', hidden: '', 'aria-controls': 'volet-fiche' });
    resume.append(creer('span', 'resume-txt', '', { id: 'resume-txt' }), creer('span', 'resume-ico', '✎', { 'aria-hidden': 'true' }));
    entete.append(resume);
    this.dernierResume = null;
  }

  // ───────── Volet « Fiche bilan » (D-64) ─────────

  /**
   * Monte le volet UNE fois (hors de #contenu : `rendre()` ne le touche jamais, la frappe survit à tous les redessins) et branche ce qui le concerne :
   * glissement de la poignée vers le bas, toucher de la liste au-dessus, touche Échap, remise en place quand la fenêtre ou la barre changent de taille.
   */
  monterVolet() {
    const i = this.intervention;
    this.volet = construireVolet({ intervention: i, auFermer: () => this.fermerVolet(), auChangement: () => this.majResumeFiche() });
    const { element, prise } = this.volet;
    this.zone.appli.append(element);
    // glisser la poignée (ou l'en-tête du volet) vers le bas : au-delà de 70 px, il se referme
    let y0 = null; let dy = 0;
    prise.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; element.classList.add('glisse'); prise.setPointerCapture?.(e.pointerId); });
    prise.addEventListener('pointermove', (e) => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); element.style.transform = `translateY(${dy}px)`; });
    const finGlisse = () => { if (y0 === null) return; const ferme = dy > 70; y0 = null; element.classList.remove('glisse'); element.style.transform = ''; if (ferme) this.fermerVolet(); };
    prise.addEventListener('pointerup', finGlisse); prise.addEventListener('pointercancel', finGlisse);
    // UNE seule règle (D-64d, N1-bis) : volet ouvert, tout toucher dans la liste NE FAIT QUE fermer le volet — jamais une case cochée ou décochée (« Alerter » comprise), un métronome ou un cycle lancé ou recalé,
    // un événement noté. Seule exception : la navigation marquée `data-vital` (« Passer en ACR », boutons de renvoi), qui n'écrit rien d'autre qu'un changement de situation et agit tout de suite ET ferme le volet
    // (un toucher perdu au moment de basculer en ACR retarderait un geste vital, D-64b M1). L'accès vital reste la BARRE du bas (Masser, Appeler, DAE, Fiche), toujours active en un toucher.
    const surListe = (ev) => {
      if (!this.voletOuvert) return;
      if (!ev.target.closest?.('[data-vital]')) { ev.stopPropagation(); ev.preventDefault(); }
      this.fermerVolet({ focus: false, immediat: true });
    };
    this.zone.contenu.addEventListener('click', surListe, true);
    const surTouche = (ev) => { if (ev.key === 'Escape' && this.voletOuvert) this.fermerVolet(); };
    document.addEventListener('keydown', surTouche);
    const replacer = () => this.placerVolet();
    window.addEventListener('resize', replacer);
    this.zone.contenu.addEventListener('scroll', replacer, { passive: true });
    window.visualViewport?.addEventListener('resize', replacer); window.visualViewport?.addEventListener('scroll', replacer);   // clavier du téléphone (D-65, c)
    element.addEventListener('focusin', (ev) => { if (/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) { this.cleVolet = ''; setTimeout(() => this.placerVolet(), 150); } });   // le champ touché passe au premier plan quand le clavier a fini de monter   // D-64c, N3 : la carte du cycle (collante) bouge avec le défilement, le volet la suit à l'image près
    const observateur = typeof ResizeObserver === 'function' ? new ResizeObserver(replacer) : null;
    observateur?.observe(this.zone.barre); observateur?.observe(this.zone.entete);
    this.debranchements.push(() => {
      this.zone.contenu.removeEventListener('click', surListe, true); document.removeEventListener('keydown', surTouche);
      window.removeEventListener('resize', replacer); this.zone.contenu.removeEventListener('scroll', replacer); window.visualViewport?.removeEventListener('resize', replacer); window.visualViewport?.removeEventListener('scroll', replacer); observateur?.disconnect();
    });
  }

  /**
   * Place le volet juste au-dessus de la barre (portrait) ou à gauche d'elle (paysage bas : la barre est en colonne à droite), sur ~55 % de la hauteur AU PLUS, et jamais
   * sur l'en-tête ni sur la carte du cycle (« Relancer ») : la hauteur est bornée par ce qui doit rester visible. Rien de vital n'est recouvert, quelle que soit la taille.
   */
  placerVolet() {
    const el = this.volet?.element;
    if (!el || el.hidden) return;
    const L = window.innerWidth; const H = window.innerHeight;
    const b = this.zone.barre.getBoundingClientRect();
    const lateral = b.width < L * 0.6;   // paysage bas : la barre est une colonne à droite
    const bas = lateral ? H : b.top;
    const droite = lateral ? L - b.left : 0;
    // la carte du cycle (« Relancer ») est épargnée dès qu'elle est entièrement visible dans la zone centrale ; sinon (écran très agrandi : elle est déjà hors d'atteinte sans défilement) on ne s'en soucie pas
    // ce qui est TOUJOURS épargné : l'en-tête (titre, temps écoulé) et, quand il est atteignable volet fermé, le bouton « Relancer » ou la carte du cycle (D-64b, M2 et M5)
    const cycle = document.getElementById('zone-cycle');
    const zc = this.zone.contenu.getBoundingClientRect();
    const entier = (r) => r && r.height > 0 && r.top >= zc.top - 1 && r.bottom <= zc.bottom + 1;
    const rCarte = cycle && !cycle.hidden ? cycle.getBoundingClientRect() : null;
    const rRelance = document.getElementById('relance-cycle')?.getBoundingClientRect();
    // la partie protégée du cycle : la carte entière si elle est visible ; sinon sa partie visible (haut de la carte jusqu'au bouton « Relancer » s'il est atteignable) ; sinon le seul bouton « Relancer »
    const carteCommence = rCarte && rCarte.height > 0 && rCarte.top >= zc.top - 1 && rCarte.top < zc.bottom - 1;
    let hautProt = null; let basProt = null;
    if (entier(rCarte)) { hautProt = rCarte.top; basProt = rCarte.bottom; }
    else if (carteCommence) { hautProt = rCarte.top; basProt = entier(rRelance) ? rRelance.bottom : Math.min(rCarte.bottom, zc.bottom); }
    else if (entier(rRelance)) { hautProt = rRelance.top; basProt = rRelance.bottom; }
    let apresEntete = this.zone.entete.getBoundingClientRect().bottom + 6;
    // P-2 (revue du lot K) : dans une conduite, le bandeau « Arrêt cardiaque » est épargné comme l'en-tête dès qu'il est entièrement visible (texte à 200 % : le volet le recouvrait et l'accès à l'ACR
    // demandait de fermer le volet d'abord). Collant ou non, s'il est hors de la zone (liste défilée, bandeau dans le flux), il n'est plus à protéger.
    const rBandeauAcr = document.getElementById('bandeau-acr')?.getBoundingClientRect();
    if (entier(rBandeauAcr)) apresEntete = Math.max(apresEntete, rBandeauAcr.bottom + 6);
    // D-65 (c) : CLAVIER du téléphone ouvert (le visualViewport est plus court que la fenêtre) : le volet se pose AU-DESSUS du clavier et le champ en cours de saisie est amené dans la vue ; la barre peut être
    // masquée par le clavier (c'est le système), elle redevient visible à sa fermeture. Garde l'en-tête visible s'il reste ≥ 140 px, sinon le volet prend toute la hauteur visible.
    const vv = window.visualViewport;
    const basVisible = vv ? vv.offsetTop + vv.height : H;
    if (vv && H - basVisible > 100) {
      const dispoK = basVisible - Math.max(apresEntete, vv.offsetTop + 8);
      const hauteurK = Math.max(0, Math.round(dispoK >= 140 ? dispoK : vv.height - 8));
      el.classList.toggle('volet-compact', hauteurK < 220); delete el.dataset.recouvre;
      const cleK = `k|${Math.round(basVisible)}|${Math.round(droite)}|${hauteurK}`;
      if (cleK === this.cleVolet) return;
      this.cleVolet = cleK;
      el.style.bottom = `${Math.round(H - basVisible)}px`; el.style.right = `${Math.round(droite)}px`; el.style.left = '0'; el.style.height = `${hauteurK}px`;
      const actif = document.activeElement;
      if (actif && el.contains(actif) && /^(INPUT|TEXTAREA)$/.test(actif.tagName)) requestAnimationFrame(() => actif.scrollIntoView?.({ block: 'center' }));
      return;
    }
    const placeSous = bas - (basProt !== null ? basProt + 6 : apresEntete);        // entre la carte du cycle et la barre (le cas ordinaire : le volet monte du bas)
    const placeSur = basProt !== null ? hautProt - 6 - apresEntete : 0;          // entre l'en-tête et la carte du cycle
    // Peu de place sous la carte (petit écran, texte agrandi) mais davantage au-dessus : le volet se pose AU-DESSUS de la carte, plutôt que de la recouvrir ou de ne laisser qu'un liseré
    const dessus = basProt !== null && placeSous < 150 && placeSur > placeSous;
    const finBas = dessus ? hautProt - 6 : bas;
    // ≈ 55 % au plus, JAMAIS plus que la place réellement libre : le volet est plus petit sur petit écran (il défile) mais ne recouvre ni la barre, ni l'en-tête, ni « Relancer »
    let hauteur = Math.max(0, Math.round(Math.min(0.55 * H, dessus ? placeSur : placeSous)));
    // N2 (D-64c) : sous 120 px, on commence par replier les événements du cycle s'ils sont déroulés (ils prennent la place) ; si la place reste inférieure à 56 px (une bande où « Fermer » n'entre même pas),
    // le volet passe en PLEIN ÉCRAN sous l'en-tête (il recouvre alors la liste et la carte du cycle : `data-recouvre`) — « Fermer » reste atteignable, la barre et le temps aussi
    if (hauteur < 120 && this.cl.evenements && !this.evenementsReplies) { this.cl.evenements = false; this.evenementsReplies = true; this.rendre(); this.cleVolet = ''; this.placerVolet(); return; }
    let finBasEff = finBas; const plein = hauteur < 56 && H - apresEntete > hauteur;
    if (plein) { finBasEff = bas; hauteur = Math.max(0, Math.round(bas - apresEntete)); }
    if (plein) el.dataset.recouvre = 'cycle'; else delete el.dataset.recouvre;
    el.classList.toggle('volet-compact', hauteur < 220);   // peu de place : titre, « Fermer » et onglets sur une rangée (feuille de style)
    const cle = `${Math.round(finBasEff)}|${Math.round(droite)}|${hauteur}`;
    if (cle === this.cleVolet) return;
    this.cleVolet = cle;
    el.style.bottom = `${Math.round(H - finBasEff)}px`; el.style.right = `${Math.round(droite)}px`; el.style.left = '0'; el.style.height = `${hauteur}px`;
  }

  ouvrirVolet() {
    if (this.voletOuvert || !this.volet) return;
    if (this.panneau !== null) { this.panneau = null; this.rendre(); }   // le volet se pose sur la conduite à tenir : on revient d'abord à l'écran principal
    const el = this.volet.element;
    this.voletOuvert = true; clearTimeout(this.delaiVolet); this.evenementsReplies = false;
    this.volet.redessiner();
    el.hidden = false; this.cleVolet = ''; this.placerVolet(); void el.offsetWidth;   // la mise en page est lue AVANT la transition
    el.classList.add('ouvert');
    this.majResumeFiche();
    document.getElementById('barre-fiche')?.setAttribute('aria-expanded', 'true');
    this.volet.titre.focus({ preventScroll: true });
  }

  fermerVolet({ focus = true, immediat = false } = {}) {
    if (!this.voletOuvert || !this.volet) return;
    const el = this.volet.element;
    this.voletOuvert = false;
    el.classList.remove('ouvert');
    this.majResumeFiche();
    document.getElementById('barre-fiche')?.setAttribute('aria-expanded', 'false');
    if (el.contains(document.activeElement)) document.activeElement.blur();
    this.volet.remettreEtat(); this.volet.redessiner();   // une demande de retrait en cours est abandonnée ; un brouillon d'ajout est gardé
    // M1 : le volet a pu corriger la fiche (heure, notes, antécédents, identité) pendant qu'une étape restait dépliée : ses champs se recalent sur la fiche, sinon la frappe suivante écraserait la correction
    // m-1 / m-2 : TOUTES les lignes de recueil sont recalées, dépliées ou non (la valeur affichée d'une étape repliée ne reste pas périmée) ; une case cochée par la saisie dont la valeur a été vidée se décoche
    for (const li of document.querySelectorAll('li.etape[data-etape]')) if (li.querySelector('[data-valeur]')) li.dispatchEvent(new Event('recaler'));
    const fin = () => { if (!this.voletOuvert) el.hidden = true; };
    if (immediat || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) fin(); else this.delaiVolet = setTimeout(fin, 280);
    if (focus) document.getElementById('barre-fiche')?.focus({ preventScroll: true });
  }

  basculerVolet() { if (this.voletOuvert) this.fermerVolet(); else this.ouvrirVolet(); }

  /** Résumé sous l'en-tête : relu à chaque saisie et à chaque tick (peu coûteux : le DOM n'est touché que si le texte change). */
  majResumeFiche() {
    const r = document.getElementById('resume-fiche');
    if (!r || !this.intervention.fiche) return;
    const t = resumeVictime(this.intervention.fiche);
    // volet ouvert, le résumé est redondant (les onglets disent la victime) et il ferait grandir l'en-tête, donc reculer la carte du cycle : il est caché tant que le volet est ouvert
    const masque = this.voletOuvert || this.panneau === 'transmission';   // la transmission dit déjà le nombre de victimes : le résumé lui volerait de la place
    const cle = `${masque}|${t}`;
    if (cle === this.dernierResume) return;
    this.dernierResume = cle;
    r.hidden = t === '' || masque;
    this.zone.entete.classList.toggle('avec-resume', !r.hidden);   // l'en-tête ne passe sur deux rangées que lorsque le résumé est affiché
    document.getElementById('resume-txt').textContent = t;
    r.setAttribute('aria-label', `Fiche : ${t}. Toucher pour modifier.`);
  }

  /** Pastille « ⚠ Son · Écran » : l'information ne disparaît QUE quand la parade est faite — bip ENTENDU et confirmé par l'utilisateur (revue R1, M1), veille d'écran obtenue (le blocage de la veille sur iPhone installé reste SUPPOSÉ). */
  etatAvertissements() {
    if (this.son.etat().bandeau) confirmerSon(false);   // r1 : si le son s'arrête (contexte hors « running »), la confirmation tombe
    const son = !etatTest.son;
    const veille = Boolean(this.ecran.etat().avertissement);
    return { son, veille, texte: son && veille ? '⚠ Son · Écran' : son ? '⚠ Son' : veille ? '⚠ Écran' : '' };
  }

  /** Titre de l'en-tête : la situation en cours (le titre du protocole, jamais écrit en dur ici). */
  majTitre() {
    const i = this.intervention;
    const el = document.getElementById('entete-titre');
    if (!el) return;
    // l'ACR en cours : le titre de SON protocole (le catalogue le nomme tant qu'il charge ou si un autre est encore en mémoire) ; la conduite : celui de son fichier, sinon le catalogue ; « Autre situation » : la commune
    const acr = i.protocole?.id === i.protocoleActifId ? (i.protocole?.titre_court ?? i.protocole?.titre) : null;
    const conduite = i.conduiteId === ID_COMMUN ? 'Autre situation' : (i.protocoleCommun?.titre_court ?? titreDe(i.conduiteId) ?? 'Autre situation');
    el.textContent = i.situation === ACR ? (acr ?? titreDe(i.protocoleActifId) ?? 'Urgence') : i.situation === AUTRE ? conduite : 'Urgence';
  }

  /**
   * Lignes en tête de la conduite à tenir, seulement quand elles ont quelque chose à dire (relecture design D1) : « ⚠ Profession non réglée — régler » tant que la profession n'est pas réglée
   * ou pas reconnue (elle conditionne les habilitations) ; les rôles dès que l'un est attribué. Sinon rien : profession et rôles sont dans le menu.
   * (CHOIX PROVISOIRE : SPEC partie 1 dit « les rôles restent visibles dans un bandeau » ; ici ils le sont dès qu'il y a quelque chose à voir.)
   */
  construireEquipe() {
    const i = this.intervention;
    const equipe = creer('div', 'equipe');
    if (i.profession === null || !i.professionReconnue) equipe.append(bouton('', 'bouton puce', () => this.ouvrirPanneau('profession'), { id: 'puce-profession' }));
    if (i.roles.length > 0) {
      const roles = bouton('', 'bouton bandeau-roles', () => this.ouvrirPanneau('roles'), { id: 'bandeau-roles' });
      roles.append(creer('span', 'roles-long', ''), creer('span', 'roles-court', ''));   // le long ne montre que les rôles attribués
      equipe.append(roles);
    }
    return equipe;
  }

  /** D-76 : montre ou cache le calque « 2 insufflations » du bouton « Masser » (appelé à chaque battement et à chaque tick de 250 ms : l'affichage s'éteint à ~5 s près d'une demi-seconde). */
  majInsufflations() {
    // H-1 : seulement en arrêt cardiaque, tuile « Masser » affichée ; hors ACR (« Autre situation », reprise d'activité) rien ne s'affiche, même si le métronome tourne encore (le métronome n'est pas touché : METRO-1)
    const tuile = document.getElementById('barre-masser');
    const montre = this.intervention.situation === ACR && !!tuile && !tuile.hidden && this.son.insufflationsAffichees();
    const el = document.getElementById('insuf-affichage');
    if (el) el.hidden = !montre;
    // D-79 : le même affichage, en très grand au centre de l'écran. Le texte n'est AJOUTÉ qu'à l'apparition et retiré à la disparition (jamais réécrit à chaque battement) :
    // la région role="status" l'annonce une seule fois aux lecteurs d'écran.
    const centre = document.getElementById('insuf-centre');
    if (centre) {
      const present = centre.childElementCount > 0;
      if (montre && !present) {
        const t = creer('div', 'insuf-centre-texte');
        t.append(creer('b', 'insuf-centre-chiffre', '2'), creer('span', 'insuf-centre-mot', 'insufflations'));
        centre.append(t);
      } else if (!montre && present) centre.replaceChildren();
    }
  }

  /** D-79 : calque central « 2 insufflations ». Élément de la grille, posé dans la MÊME case que la zone centrale (entre l'en-tête et la barre, ou à gauche de la barre en paysage) : il ne déplace rien,
   *  ne recouvre jamais la barre ni l'en-tête, et ne capte aucun toucher (`pointer-events: none`, voir app.css). */
  monterInsufflationsCentre() {
    this.zone.appli.append(creer('div', null, '', { id: 'insuf-centre', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
  }

  /**
   * D-80 (METRO-1 = C), corrigé par le lot J-b (M-1, M-2) : la question « Métronome en marche — Arrêter · Continuer » est une LIGNE du flux de l'écran « Autre situation » (et des conduites), sous la
   * tuile rouge — jamais une carte superposée : elle ne recouvre RIEN (panneau d'alerte, écran d'appel, transmission, volet « Fiche », « Lieu » : elle n'y existe pas) et ne pousse que la liste de cet écran.
   * Présente tant que le métronome bat hors ACR ; après « Continuer », seul « Arrêter » reste. Sans réponse le métronome continue (D-80).
   */
  construireLigneMetronome() {
    const etat = this.intervention.etatLigneMetronome();
    if (etat === null) return null;
    const ligne = creer('div', 'ligne-metronome', '', { id: 'ligne-metronome', role: 'group', 'aria-label': 'Métronome', 'data-etat': etat });
    ligne.append(creer('span', 'ligne-metronome-texte', 'Métronome en marche'));
    ligne.append(bouton('Arrêter', 'bouton', () => this.intervention.repondreQuestionMetronome('arreter'), { id: 'ligne-metronome-arreter' }));
    if (etat === 'question') ligne.append(bouton('Continuer', 'bouton', () => this.intervention.repondreQuestionMetronome('continuer'), { id: 'ligne-metronome-continuer' }));
    return ligne;
  }

  /** Redessine l'écran « Autre situation » seulement si la ligne affichée n'est plus celle qu'il faut (le métronome s'est arrêté sans toucher à la ligne) ; jamais à chaque tick. */
  majQuestionMetronome() {
    if (this.panneau !== null || this.intervention.situation !== AUTRE) return;
    const attendu = this.intervention.etatLigneMetronome() ?? '';
    const present = document.getElementById('ligne-metronome')?.dataset.etat ?? '';
    if (attendu !== present) this.rendre();
  }

  pulser() {
    this.majInsufflations();
    const r = document.getElementById('repere');
    if (!r) return;
    r.classList.add('repere-actif');
    setTimeout(() => r.classList.remove('repere-actif'), 120);
  }

  /** Texte très agrandi (≥ 200 % : racine ≥ 22 px) : l'en-tête et les bandeaux se resserrent (voir app.css, data-texte="grand"). */
  majTaille() {
    const racine = parseFloat(getComputedStyle(document.documentElement).fontSize);
    document.body.dataset.texte = racine >= 22 ? 'grand' : 'normal';
    // F2 : `data-agrandi` = texte agrandi dès 112 % (racine ≥ 18 px), AVANT le mode « grand » : dès 130 % le titre et le décompte du cycle n'ont plus la place de la mise en page normale
    document.body.dataset.agrandi = racine >= 18 ? 'oui' : 'non';
  }

  rafraichir() {
    const i = this.intervention;
    if (i.detruite) return;
    this.majTaille();
    i.tick();
    const global = document.getElementById('chrono-global');
    if (global) global.textContent = i.texteGlobal();
    this.majBarreVitale();
    this.majQuestionMetronome();
    this.majResumeFiche(); this.placerVolet();
    // pastille d'avertissement (son · écran) dans la rangée du titre
    const pastille = document.getElementById('pastille-avert');
    if (pastille) { const a = this.etatAvertissements(); pastille.hidden = a.texte === ''; pastille.textContent = a.texte; pastille.setAttribute('aria-label', `${a.texte.replace('⚠ ', 'Attention : ')}. Détails`); }
    this.majPuceEtRoles();
    this.majZoneCycle();
  }

  /** Numéro du plan A (numeros.json) : il n'est pas écrit en dur ; 15 par défaut tant que le fichier n'est pas lu. */
  numeroAppel() {
    const n = this.numerosFn()?.numeros ?? [];
    return String((n.find((x) => x.plan === 'A') ?? n[0])?.numero ?? '15');
  }

  /** Barre d'outils : « Masser » (métronome), « Appeler », « DAE » (cycle), « Fiche » — libellés pris dans le protocole ; masquées tant que le protocole n'est pas lu ou hors ACR. */
  majBarreVitale() {
    const i = this.intervention;
    const { masser, dae } = actionsVitales(i.situation === ACR && i.protocoleEtat === 'ok' ? i.etapesPremierEcran() : []);
    const appel = document.getElementById('barre-alerter');
    if (appel) { document.getElementById('appel-numero').textContent = this.numeroAppel(); appel.setAttribute('aria-label', `Appeler le ${this.numeroAppel()}`); }
    const tuileMasser = document.getElementById('barre-masser');
    if (tuileMasser) {
      const m = i.metronome;
      tuileMasser.hidden = !masser;
      if (masser) {
        const e = this.son.etat().metronome;
        document.getElementById('masser-libelle').textContent = libelleBarre(masser);
        document.getElementById('metronome-valeur').textContent = m ? String(m.frequence) : '';
        document.getElementById('metronome-etoile').hidden = !(m && (m.marque || m.modeMarque));
        const etat = !i.estCochee(masser.id) ? 'démarrer' : e.actif ? (e.mention ? 'visuel seul' : 'en cours') : 'en pause';   // « visuel seul » : le son s'est arrêté, le repère continue
        document.getElementById('metronome-etat').textContent = etat;
        tuileMasser.setAttribute('aria-pressed', String(e.actif));
        tuileMasser.setAttribute('aria-label', `${libelleBarre(masser)}${m ? `, métronome ${m.frequence} par minute${m.marque ? ' (provisoire, non validé)' : ''}` : ''} : ${etat}`);
      }
    }
    this.majInsufflations();   // H-1 : hors du « if (masser) » — le calque s'efface aussi quand la tuile disparaît
    const tuileDae = document.getElementById('barre-dae');
    if (tuileDae) {
      tuileDae.hidden = !dae;
      if (dae) {
        const c = i.chronoCycle; const l = c && i.gestion?.trouver(c.id) ? i.gestion.lire(c.id) : null;
        document.getElementById('dae-libelle').textContent = libelleBarre(dae);
        document.getElementById('dae-etat').textContent = l ? `cycle ${l.cycle}` : (i.estCochee(dae.id) ? 'fait' : '');
        tuileDae.setAttribute('aria-label', `${libelleBarre(dae)}${c ? ' : lance ou relance le cycle' : ''}`);
      }
    }
  }

  /** Libellé de la profession réglée, ou « non réglée » / « non reconnue ». */
  nomProfession() {
    const i = this.intervention;
    const groupe = this.groupesFn().find((g) => g.id === i.profession);
    return i.profession === null ? 'non réglée' : i.professionReconnue ? (groupe ? groupe.libelle : i.profession) : 'non reconnue';
  }

  /** Ligne « profession non réglée — régler » et ligne des rôles (présentes seulement dans ces cas). */
  majPuceEtRoles() {
    const i = this.intervention;
    const puce = document.getElementById('puce-profession');
    if (puce) {
      puce.textContent = `Profession ${this.nomProfession()} — régler`;   // A1 : le « ⚠ » vient de la feuille de style (.puce[data-regle="non"]::before), un seul
      puce.dataset.regle = 'non';
      puce.setAttribute('aria-label', `Profession ${this.nomProfession()}. Choisir`);
    }
    const bandeau = document.getElementById('bandeau-roles');
    if (bandeau) {
      bandeau.querySelector('.roles-long').textContent = i.roles.length > 0 ? texteBandeauRempli(i.roles) : texteBandeau(i.roles);
      bandeau.querySelector('.roles-court').textContent = texteBandeauCourt(i.roles);
      bandeau.setAttribute('aria-label', `Rôles : ${texteBandeau(i.roles)}`);
    }
  }

  majBandeauxSon() {
    const poser = (cle, texte) => {
      const zone = this.zone.bandeaux;
      zone.querySelector(`[data-bandeau="${cle}"]`)?.remove();
      if (texte) { const b = creer('div', 'bandeau bandeau-avertissement', texte, { 'data-bandeau': cle, title: texte }); zone.append(b); }
    };
    poser('son', this.son.etat().bandeau);
  }

  afficherEcheance({ id, alerte, depassementMs }) {
    if (alerte === 'aucune') return;
    const def = this.intervention.definitions.find((d) => d.id === id);
    const texte = [def?.libelle ?? id, def?.note].filter(Boolean).join(' — ');
    this.poserBandeauTemporaire('echeance', `${texte}${def ? suffixeMarques(def) : ''}`, 15000, 'Échéance : ');   // les mêmes marques que la zone du cycle (revue m6)
  }

  afficherRattrapage({ franchies }) {
    const texte = franchies.map((f) => `${this.intervention.definitions.find((d) => d.id === f.id)?.libelle ?? f.id} : ${texteDepassement(f.depassementMs)}`).join(' ; ');
    this.poserBandeauTemporaire('rattrapage', texte, 20000); // toujours en bandeau, jamais en voile
  }

  poserBandeauTemporaire(cle, texte, dureeMs, prefixe = '') {
    const zone = this.zone.bandeaux;
    zone.querySelector(`[data-bandeau="${cle}"]`)?.remove();
    // A3 : bandeau TEMPORAIRE (il porte un bouton « OK ») : le texte passe à la ligne et « OK » reste dans la largeur de l'écran (classe `bandeau-temporaire`)
    const b = creer('div', 'bandeau bandeau-avertissement bandeau-temporaire', '', { 'data-bandeau': cle, role: 'status', title: prefixe + texte });
    // r1 : le préfixe (« Échéance : ») est un morceau à part : à 200 % de texte il devient invisible (lu quand même par les lecteurs d'écran) pour que la ligne unique montre d'abord le texte utile
    const t = creer('span', 'bandeau-texte');
    if (prefixe) t.append(creer('span', 'bandeau-prefixe', prefixe));
    t.append(document.createTextNode(texte));
    b.append(t, bouton('OK', 'bouton', () => b.remove()));
    zone.append(b);
    setTimeout(() => b.remove(), dureeMs);
  }

  // ───────── Barre du bas ─────────

  construireBarre() {
    const { barre } = this.zone;
    barre.replaceChildren();
    barre.setAttribute('aria-label', "Barre d'outils");
    const rang = creer('div', 'outils');
    // Masser : un premier toucher coche l'étape et démarre le métronome ; ensuite il met en pause / reprend. Le repère visuel bat avec le son (iPhone muet, sourd : jamais le son seul).
    const masser = bouton('', 'outil outil-masser', () => this.surBarre('masser'), { id: 'barre-masser', 'aria-pressed': 'false', hidden: '' });
    const valeur = creer('b', null, '', {});
    valeur.append(creer('span', null, '', { id: 'metronome-valeur' }), creer('span', 'etoile', '✱', { id: 'metronome-etoile', hidden: '', 'aria-hidden': 'true' }), creer('span', 'repere', '', { id: 'repere', 'aria-hidden': 'true' }));
    masser.append(creer('span', null, '', { id: 'masser-libelle' }), valeur, creer('span', 'outil-etat', '', { id: 'metronome-etat' }));
    // D-76 (INSUF-1) : « 2 insufflations » s'affiche ~5 s tous les 30 battements, DANS le bouton « Masser » (calque en position absolue : aucune mise en page ne bouge, la barre reste entière, la checklist n'est pas touchée).
    // Le métronome ne s'arrête pas et aucun son n'est ajouté ; `son.insufflationsAffichees` dit quand (voir son.js).
    const insuf = creer('span', 'insuf-affichage', '', { id: 'insuf-affichage', hidden: '', 'aria-hidden': 'true' });
    insuf.append(creer('b', null, '2'), creer('span', null, 'insufflations'));
    masser.append(insuf);
    const appel = bouton('', 'outil outil-appel', () => this.surBarre('alerter'), { id: 'barre-alerter', 'aria-label': `Appeler le ${this.numeroAppel()}` });
    appel.append(creer('span', null, 'Appeler'), creer('b', null, this.numeroAppel(), { id: 'appel-numero' }));   // petit libellé + GROS chiffre : le plus lisible de la barre
    // DAE : coche l'étape (une fois) et lance — ou relance — le cycle où l'on note analyses et chocs
    const dae = bouton('', 'outil outil-dae', () => this.surBarre('dae'), { id: 'barre-dae', hidden: '' });
    dae.append(creer('span', null, '', { id: 'dae-libelle' }), creer('span', 'outil-etat', '', { id: 'dae-etat' }));
    const fiche = bouton('', 'outil outil-fiche', () => this.surBarre('fiche'), { id: 'barre-fiche', 'aria-label': 'Fiche bilan' });
    fiche.append(creer('span', null, 'Fiche'), creer('b', null, '✎', { 'aria-hidden': 'true' }));
    rang.append(masser, appel, dae, fiche);
    barre.append(rang);
  }

  /** ANNULER LE DÉMARRAGE (revue R1, C1) : seulement dans les 60 premières secondes et tant que rien n'a été fait ; la vérification est refaite au toucher (le menu ne rafraîchit pas). */
  async annulerDemarrage() {
    const effacee = await this.intervention.annulerDemarrage();
    if (!effacee) { this.rendre(); return; }   // plus annulable (délai dépassé, saisie faite) : on reste dans l'intervention, rien n'a été effacé
    this.actions.accueil({ dejaDetruite: true });
  }

  surBarre(id) {
    const i = this.intervention;
    if (id === 'alerter') { this.ouvrirPanneau('alerte'); return; }
    if (id === 'fiche') { this.basculerVolet(); return; }   // D-64 : le volet monte (ou redescend) ; la barre reste active
    const { masser, dae } = actionsVitales(i.etapesPremierEcran());
    // N2 (revue des correctifs R1c) : un second toucher involontaire (double toucher, retouche « pour confirmer ») dans les 1,5 s est ignoré
    const maintenant = performance.now();
    this.dernierToucher ??= {};
    if (id === 'masser' || id === 'dae') { if (maintenant - (this.dernierToucher[id] ?? -Infinity) < 1500) return; this.dernierToucher[id] = maintenant; }
    if (id === 'masser' && masser) {
      if (!i.estCochee(masser.id)) i.toucherTuile(masser.id);   // coche, journalise, démarre métronome et chronomètre (déclencheur du protocole)
      else i.basculerMetronome();
      this.majBarreVitale();
    }
    if (id === 'dae' && dae) {
      if (!i.estCochee(dae.id)) i.toucherTuile(dae.id);
      // CHOIX PROVISOIRE (D-44) : la barre LANCE le cycle (une seule fois) ; la relance se fait par « Relancer » de la carte du cycle (un toucher involontaire ne décale plus l'échéance)
      const c = i.chronoCycle;
      if (c && !i.gestion?.trouver(c.id)) i.relancerCycle();
      this.majBarreVitale();
    }
  }

  /** Ouvre un écran. `null` = « fermer » : retour à l'écran principal (la conduite à tenir en ACR). */
  ouvrirPanneau(nom) {
    this.fermerVolet({ focus: false, immediat: true });   // un autre écran (alerte, menu…) prend la place : le volet se retire d'un coup
    // F5 (m1 de la relecture D-65) : une ligne ouverte en modification dans la transmission est REFERMÉE quand on quitte l'écran (ou qu'on y revient, y compris à l'ouverture automatique après un appel) :
    // sinon le champ se rouvrait seul, focalisé, et le clavier pouvait monter sans avoir été demandé
    if ((nom === 'transmission') !== (this.panneau === 'transmission')) { this.tr.ligne = null; this.tr.edition = false; }
    this.panneau = nom; this.messageTest = null; this.rendre();
  }

  /**
   * D-70 : un champ de saisie de la zone centrale (mode transmission, écran « Lieu »…) reste VISIBLE au-dessus du clavier du téléphone, sans défilement à la main — comme le volet « Fiche » (`placerVolet`, D-65 c).
   * Le clavier recouvre le bas de la page (le `visualViewport` devient plus court que la fenêtre) : on réserve à la zone centrale de quoi défiler (marge basse égale à la partie recouverte), puis on la fait défiler
   * jusqu'à ce que le champ soit au-dessus du clavier. Clavier fermé : la réserve est retirée. NON MESURÉ sur un vrai téléphone (comme D-65 c).
   */
  placerChampActif() {
    const c = this.zone.contenu;
    const vv = window.visualViewport; const H = window.innerHeight;
    const bas = vv ? vv.offsetTop + vv.height : H;
    const clavier = Math.max(0, H - bas);
    const actif = document.activeElement;
    const champ = actif && c.contains(actif) && /^(INPUT|TEXTAREA)$/.test(actif.tagName) ? actif : null;
    if (!champ || clavier <= 100) { if (c.style.paddingBottom) c.style.paddingBottom = ''; return; }
    const zone = c.getBoundingClientRect();
    c.style.paddingBottom = `${Math.max(0, Math.round(zone.bottom - bas))}px`;   // de quoi défiler : le bas de la zone est sous le clavier
    const r = champ.getBoundingClientRect();
    const limite = bas - 12; const haut = Math.max(zone.top, vv?.offsetTop ?? 0) + 8;
    if (r.bottom > limite) c.scrollTop += r.bottom - limite;
    const r2 = champ.getBoundingClientRect();
    if (r2.top < haut) c.scrollTop -= haut - r2.top;   // un champ plus haut que la place libre : on garde son début en vue
  }

  /** Branche le suivi du clavier : événements du visualViewport et prise de focus dans la zone centrale (le champ passe au premier plan quand le clavier a fini de monter). */
  monterSuiviClavier() {
    const suivre = () => this.placerChampActif();
    const surFocus = (ev) => { if (/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) { suivre(); setTimeout(suivre, 150); setTimeout(suivre, 450); } };
    window.visualViewport?.addEventListener('resize', suivre); window.visualViewport?.addEventListener('scroll', suivre);
    this.zone.contenu.addEventListener('focusin', surFocus);
    this.debranchements.push(() => {
      window.visualViewport?.removeEventListener('resize', suivre); window.visualViewport?.removeEventListener('scroll', suivre);
      this.zone.contenu.removeEventListener('focusin', surFocus); this.zone.contenu.style.paddingBottom = '';
    });
  }

  /** Retour à l'écran principal (ACR, choix de situation…). */
  versPrincipal() { this.panneau = null; }


  // ───────── Bandeaux d'état : simulation, reprise ─────────

  majBandeauxFixes() {
    const zone = this.zone.bandeaux;
    const i = this.intervention;
    zone.querySelector('[data-bandeau="simulation"]')?.remove();
    zone.querySelector('[data-bandeau="reprise"]')?.remove();
    zone.querySelector('[data-bandeau="version"]')?.remove();
    if (i.simulation) {
      // texte + couleur + motif rayé, différent de tout autre bandeau ; présent sur CHAQUE écran de simulation
      const b = creer('div', 'bandeau-simulation', '', { 'data-bandeau': 'simulation' });
      const mot = creer('span', 'simulation-mot', 'SIMULATION');
      // A5 : une simulation REPRISE ne pose pas un second bandeau « Fiche reprise » : la mention est dans le bandeau violet (une seule rangée)
      if (i.repriseDe) mot.append(creer('small', 'simulation-reprise', `reprise (${heureLocale(i.repriseDe.debut)})`));
      b.append(mot);
      b.append(bouton('URGENCE RÉELLE', 'bouton bouton-urgence', () => this.actions.urgenceReelle(), { id: 'urgence-reelle' }));
      b.append(bouton('Quitter', 'bouton', () => this.demanderQuitterSimulation(b), { id: 'quitter-simulation' }));
      zone.prepend(b);
    }
    if (i.repriseDe && !i.simulation) {
      // UNE ligne (revue M3). D-28 (cahier 2.8) : « NOUVELLE URGENCE » reste à UN toucher dans tous les cas. Tant que personne n'a rien touché dans la fiche, « Accueil »
      // l'accompagne ; dès le premier toucher le bandeau se replie (texte court ; « Accueil » passe au menu, 2 touchers) mais GARDE son bouton NOUVELLE URGENCE. La ligne ne
      // prend pas plus de place qu'avant (le bouton fait 48 px dans les deux cas) et l'équipe n'a jamais à chercher le menu pour repartir sur une autre victime.
      const texte = this.repriseRepliee ? `Fiche reprise (${heureLocale(i.repriseDe.debut)})` : `Fiche reprise — intervention commencée à ${heureLocale(i.repriseDe.debut)}`;
      const b = creer('div', 'bandeau bandeau-reprise', '', { 'data-bandeau': 'reprise', title: texte });
      b.append(creer('span', 'bandeau-texte', texte));
      b.append(bouton('NOUVELLE URGENCE', 'bouton bouton-urgence', () => this.actions.nouvelleUrgence(), { id: 'nouvelle-urgence-reprise' }));
      if (!this.repriseRepliee) b.append(bouton('Accueil', 'bouton', () => this.actions.accueil(), { id: 'accueil-reprise' }));
      zone.append(b);
    }
    // P4d (m4) : un CHANGEMENT d'ACR a échoué (fichier illisible) : on reste sur l'ACR en cours — Masser, DAE, métronome, cycle — et on le dit, sans écran de secours
    zone.querySelector('[data-bandeau="acr-illisible"]')?.remove();
    if (i.echecAcr && i.situation === ACR) {
      const nom = PROTOCOLES_ACR.find((p) => p.id === i.echecAcr.id)?.libelle ?? i.echecAcr.id;
      // r2 (revue ciblée AF-b) : le texte, coupé par « … » sur une ligne, reste lisible en entier par l'infobulle (`title`), comme les autres bandeaux temporaires
      const texte = `${nom} illisible : on reste sur l'arrêt cardiaque en cours.`;
      const b = creer('div', 'bandeau bandeau-avertissement bandeau-temporaire', '', { 'data-bandeau': 'acr-illisible', role: 'status', title: texte });
      b.append(creer('span', 'bandeau-texte', texte), bouton('OK', 'bouton', () => { i.echecAcr = null; b.remove(); }, { id: 'acr-illisible-ok' }));
      zone.append(b);
    }
    if (i.versionDifferente && !this.versionVue) {
      // parade 3 (2.4, revue M2) : l'appli a changé de version pendant l'intervention ; dit une fois, acquittable en un toucher
      const texte = `Appli mise à jour pendant l'intervention (version ${i.versionDifferente.de} → ${i.versionDifferente.vers})`;
      const b = creer('div', 'bandeau bandeau-avertissement bandeau-temporaire', '', { 'data-bandeau': 'version', title: texte, role: 'status' });
      b.append(creer('span', 'bandeau-texte', texte), bouton('OK', 'bouton', () => { this.versionVue = true; b.remove(); }, { id: 'version-ok' }));
      zone.append(b);
    }
  }

  demanderQuitterSimulation(bandeau) {
    // une seule confirmation au second toucher (4.0, fonction 27)
    const quitter = bandeau.querySelector('#quitter-simulation');
    if (quitter.dataset.confirme === '1') { this.actions.accueil(); return; }
    quitter.dataset.confirme = '1'; quitter.textContent = 'Confirmer : quitter';
    setTimeout(() => { if (quitter.isConnected) { quitter.dataset.confirme = '0'; quitter.textContent = 'Quitter'; } }, 4000);
  }

  // ───────── Écran courant ─────────

  /**
   * Dessine l'écran courant. Quand on CHANGE d'écran, la zone centrale repart du haut : sinon un écran ouvert après avoir fait défiler le précédent
   * (ACR défilé jusqu'aux tuiles, puis ALERTER) apparaissait déjà défilé, « Appeler le 15 » hors de vue (trouvé par les tests de L6c).
   * Un redessin du MÊME écran (case cochée, tuile touchée) garde la position.
   */
  rendre() {
    this.dessiner();
    this.majBarreVitale();   // R1f (m7) : « Masser » et « DAE » apparaissent avec l'écran ACR, sans attendre la boucle de 250 ms
    // la clé inclut la situation : de « Autre situation » à l'ACR le panneau reste null, mais l'écran change (R1f, M2 : l'ACR s'ouvrait défilé, « Masser » sous le doigt)
    // (P4a : et le protocole choisi — de l'ACR adulte à l'ACR enfant, ou d'une conduite à l'autre, l'écran repart aussi du haut)
    const cle = `${this.panneau ?? 'principal'}|${this.intervention.situation ?? ''}|${this.intervention.situation === ACR ? this.intervention.protocoleActifId : this.intervention.situation === AUTRE ? this.intervention.conduiteId : ''}`;
    const cleSituation = `${this.intervention.situation ?? ''}|${this.intervention.situation === AUTRE ? this.intervention.conduiteId : ''}`;
    if (cleSituation !== this.cleSituation) { this.cleSituation = cleSituation; if (this.intervention.situation === AUTRE) this.bandeauIgnoreJusqua = performance.now() + DELAI_REBOND_ARRIVEE_MS; }   // P-1
    if (cle !== this.cleEcran) {
      if (this.situationAffichee === AUTRE && this.intervention.situation === ACR) this.touchesIgnoreesJusqua = performance.now() + DELAI_REBOND_BASCULE_MS;
      this.zone.contenu.scrollTop = 0; this.cleEcran = cle; this.situationAffichee = this.intervention.situation;
    }
  }

  dessiner() {
    const i = this.intervention;
    const { contenu } = this.zone;
    this.secours?.arreter(); this.secours = null;
    this.arreterBandeauAcr();   // M-1 : le bandeau de l'écran précédent n'est plus suivi
    document.body.dataset.panneau = this.panneau ?? '';   // l'en-tête se compacte pendant l'appel (app.css, L9c étape 2, M4)
    this.majResumeFiche();   // le résumé de la fiche se masque pendant la transmission (D-64b)
    this.majBandeauxFixes();
    this.majBandeauxSon();
    this.majBarre();
    if (this.panneau !== 'cloture' && this.cloture) { this.cloture.demonter(); this.cloture = null; }   // quitter l'écran retire aussi le document d'impression de la page
    if (this.panneau === 'cloture') {
      this.cloture?.demonter();
      this.cloture = afficherCloture(contenu, {
        fiche: i.fiche, stockage: i.stockage,
        structure: () => this.structure, champsSensibles: () => i.champsSensibles, appelant: () => i.appelant, protocoleId: i.protocolesAcr,
        effacer: () => i.cloturerEtEffacer(),
        apresEffacement: (res) => this.actions.effacee?.(res),
        auFermer: () => (i.detruite ? this.actions.terminee() : this.ouvrirPanneau(null)),   // L8c (revue L8 m2) : l'intervention est déjà terminée (effacement échoué) : retour à l'accueil, où la fiche attend (Exporter, Effacer)
      });
    } else if (this.panneau === 'materiel') {
      // le protocole de la fiche (copie), sinon celui en mémoire : « Autre situation » n'en a pas, la liste est alors dite vide
      const protocole = i.protocole ?? i.fiche.protocoles_utilises?.[i.protocoleActifId] ?? this.materielAcr ?? null;   // (this.materielAcr : le protocole de l'ACR, chargé à la demande depuis une conduite)
      if (i.situation === AUTRE && !this.materielAcr) {
        // A8 : dans une conduite, la liste de la CONDUITE (ses articles et rien d'autre) ; sans liste propre, on le dit et l'ACR est proposé sous son nom — jamais le matériel de l'arrêt cardiaque sous le titre « du protocole »
        const nom = i.conduiteId === ID_COMMUN ? 'Autre situation' : (i.protocoleCommun?.titre_court ?? titreDe(i.conduiteId) ?? 'cette conduite');
        afficherMateriel(contenu, {
          modele: construireMateriel({ protocole: i.protocoleCommun, structure: this.structure, seulementListe: true }), avecArticles: true,
          titre: `Matériel : ${nom}`, messageVide: this.materielAcrEchec ? "Le matériel de l'arrêt cardiaque est indisponible (fichier illisible)." : 'Pas de liste de matériel pour cette conduite.',
          actionVide: { libelle: "Voir le matériel de l'arrêt cardiaque", action: async () => { const rc = await i.chargerProtocoleFn(i.protocoleId); this.materielAcr = rc.ok ? rc.protocole : null; this.materielAcrEchec = !rc.ok; if (this.panneau === 'materiel') this.rendre(); } },
          auFermer: () => this.ouvrirPanneau(null),
        });
      } else {
        afficherMateriel(contenu, { modele: construireMateriel({ protocole, structure: this.structure }), avecArticles: true, titre: i.situation === AUTRE ? "Matériel de l'arrêt cardiaque" : null, auFermer: () => this.ouvrirPanneau(null) });
      }
    } else if (this.panneau === 'apropos') {
      afficherAPropos(contenu, { chargerProtocole: () => (i.protocole ? Promise.resolve({ ok: true, protocole: i.protocole }) : i.chargerProtocoleFn(i.protocoleId)), stockage: i.stockage, auFermer: () => this.ouvrirPanneau(null) });
    } else if (this.panneau === 'transmission') {
      const pages = construireTransmission({ fiche: i.fiche, structure: this.structure, champsSensibles: i.champsSensibles, appelant: i.appelant, protocoleId: i.protocolesAcr, maintenant: Date.now() });
      afficherTransmission(contenu, { pages, etat: this.tr, intervention: i, auFermer: () => this.ouvrirPanneau(null), auRendre: () => this.rendre() });
    } else if (this.panneau === 'journal') {
      afficherJournal(contenu, { intervention: i, etat: this.jr, auFermer: () => this.ouvrirPanneau(null), auRendre: () => this.rendre() });
    } else if (this.panneau === 'telephone') {
      this.afficherTelephone();
    } else if (this.panneau === 'glossaire') {
      afficherGlossaire(contenu, { glossaire: i.glossaire, auFermer: () => this.ouvrirPanneau(null) });
    } else if (this.panneau === 'alerte') {
      afficherAlerte(contenu, { intervention: i, numeros: this.numerosFn(), structure: this.structure, auFermer: () => this.ouvrirPanneau(null), auLieu: () => this.ouvrirLieu('alerte'), auTransmission: () => this.ouvrirPanneau('transmission') });
    } else if (this.panneau === 'lieu') {
      afficherLieu(contenu, { intervention: i, structure: this.structure, auRetour: () => this.ouvrirPanneau(this.lieuRetour) });
    } else if (this.panneau === 'roles') {
      afficherRoles(contenu, { intervention: i, auFermer: () => this.ouvrirPanneau(null) });
    } else if (this.panneau === 'profession') {
      afficherProfession(contenu, {
        groupes: this.groupesFn(), courante: i.profession,
        auChoix: (id) => { i.changerProfession(id); this.actions.professionChangee?.(); this.ouvrirPanneau(null); },
        auFermer: () => this.ouvrirPanneau(null),
      });
    } else if (this.panneau === 'menu') {
      this.afficherMenu();
    } else if (this.panneau === 'situation' || i.situation === null) {
      this.afficherChoix();
    } else if (i.situation === AUTRE) {
      this.afficherAutre();
    } else if (i.protocoleEtat === 'secours') {
      this.secours = afficherSecours(contenu, { raisons: i.raisons, t0: i.fiche.journal[0].t, simulation: i.simulation, journaliser: () => {} });
    } else if (i.protocoleEtat !== 'ok') {
      contenu.replaceChildren(creer('p', 'page', 'Chargement du protocole…', { role: 'status' }));
    } else {
      this.afficherAcr();
    }
  }

  majBarre() {
    const alerte = document.getElementById('barre-alerter');
    if (alerte) alerte.setAttribute('aria-current', this.panneau === 'alerte' ? 'page' : 'false');
    const fiche = document.getElementById('barre-fiche');
    if (fiche) fiche.setAttribute('aria-expanded', String(this.voletOuvert));   // D-64 : le volet est ouvert ou non (plus d'écran « Fiche »)
    const menu = document.getElementById('barre-menu');
    if (menu) { const ouvert = this.panneau === 'menu'; menu.setAttribute('aria-expanded', String(ouvert)); menu.textContent = ouvert ? '✕' : '⋯'; menu.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Menu'); }
    this.majTitre();
  }

  afficherChoix() {
    const i = this.intervention;
    const page = creer('section', 'choix-situation');
    page.setAttribute('aria-label', 'Situation');
    // (rendre() explicite : si la situation est déjà celle-là — menu « Changer de situation » — aucun événement ne la réaffiche)
    // P4a : un bouton par ACR (adulte, puis enfant s'il est publié), un par conduite publiée, puis « Autre situation » (la conduite commune) ; les noms viennent du catalogue
    for (const p of PROTOCOLES_ACR) {
      if (p.id !== i.protocoleId && !(i.protocolesAcr.includes(p.id) && protocolePublie(p.id))) continue;
      page.append(bouton(p.libelle, 'bouton bouton-accent bouton-tres-grand bouton-plein', async () => { this.versPrincipal(); const a = i.choisirAcr(p.id); this.rendre(); await a; this.rendre(); }, { id: p.id === i.protocoleId ? 'choix-acr' : `choix-${p.id}` }));
    }
    for (const c of CONDUITES) {
      if (!i.conduites.includes(c.id) || !protocolePublie(c.id)) continue;
      page.append(bouton(c.titre, 'bouton bouton-plein', () => { this.versPrincipal(); i.choisirAutre(c.id); this.rendre(); }, { id: `choix-${c.id}` }));
    }
    page.append(bouton('Autre situation', 'bouton bouton-plein', () => { this.versPrincipal(); i.choisirAutre(); this.rendre(); }, { id: 'choix-autre' }));
    // « Annuler (démarrage par erreur) » : seulement sur CET écran, tant que la fiche ne contient rien d'autre que l'entrée « urgence »
    this.zone.contenu.replaceChildren(page);
  }

  /**
   * Écran « Autre situation » (lot R1e, CHOIX PROVISOIRE, aucun texte médical) : même style que l'accueil. De haut en bas : la tuile ROUGE « Arrêt cardiaque » (passage en ACR en UN toucher,
   * journalisé, fiche et coches conservées — `Intervention.choisirAcr`), la checklist COMMUNE (D-51) quand son fichier est publié, les outils (fiche, transmission, lieu), la ligne « Bientôt ».
   * Le chronomètre global est dans l'en-tête ; la barre du bas reste « Appeler le 15 » + « Fiche » (pas de protocole ACR : ni Masser, ni DAE).
   */
  afficherAutre() {
    const i = this.intervention;
    const page = creer('section', 'accueil autre-situation', '', { 'aria-label': i.conduiteId === ID_COMMUN ? 'Autre situation' : (i.protocoleCommun?.titre_court ?? titreDe(i.conduiteId) ?? 'Autre situation'), 'data-conduite': i.conduiteId });
    /** Grosse tuile : titre + sous-titre discret (comme l'accueil). */
    const gros = (titre, sous, classe, action, id, attrs = {}) => { const b = bouton(titre, classe, action, { id, ...attrs }); b.append(creer('small', null, sous)); return b; };
    // D-83 (ACR-UNIQUE = A) : UN SEUL accès à l'arrêt cardiaque, quelle que soit la conduite : un bandeau rouge bas « Arrêt cardiaque : adulte | enfant » tout en haut (collant : il reste sous le doigt
    // quand la liste défile ; il fait partie du flux, donc ne recouvre ni la barre ni l'en-tête et ne bouge pas aux redessins). Un toucher = même effet que l'ancienne tuile (`choisirAcr`, journalisé).
    // Un seul ACR publié : un seul bouton « Passer en ACR ». L'étape « Arrêt cardiaque ? » du protocole reste dans les données ; seul son affichage dans la liste est retiré (`masquerRenvois`).
    const bandeau = creer('div', 'bandeau-acr', '', { id: 'bandeau-acr', role: 'group', 'aria-label': 'Arrêt cardiaque' });
    const acrs = PROTOCOLES_ACR.filter((p) => p.id === i.protocoleId || (i.protocolesAcr.includes(p.id) && protocolePublie(p.id)));
    bandeau.append(creer('span', 'bandeau-acr-texte', acrs.length > 1 ? 'Arrêt cardiaque :' : 'Arrêt cardiaque'));
    for (const p of acrs) {
      const mot = acrs.length > 1 ? `ACR ${p.sous.split(' · ')[0]}` : 'Passer en ACR';   // M-1 : libellé court (« ACR adulte | ACR enfant ») pour tenir sur une rangée ; le nom accessible reste « Arrêt cardiaque, adulte »
      bandeau.append(bouton(mot, 'bouton bouton-acr', () => { this.versPrincipal(); i.choisirAcr(p.id).catch(() => {}); }, { id: p.id === i.protocoleId ? 'passer-acr' : `passer-${p.id}`, 'data-vital': 'acr', 'aria-label': `${mot} — arrêt cardiaque, ${p.sous.split(' · ')[0]}` }));   // commande vitale : agit tout de suite même volet ouvert (D-64c, N1)
    }
    page.append(bandeau);
    const ligneMetronome = this.construireLigneMetronome();   // D-80 corrigé (J-b) : dans le flux, sous la tuile rouge
    if (ligneMetronome) page.append(ligneMetronome);
    page.append(this.construireChecklistCommune());
    const outils = creer('div', 'accueil-grille autre-outils');
    outils.append(
      gros('Fiche bilan', 'noter les informations', 'bouton gros', () => this.ouvrirVolet(), 'autre-fiche'),
      gros('Transmission au 15', 'message structuré', 'bouton gros', () => this.ouvrirPanneau('transmission'), 'autre-transmission'),
      gros('Lieu / adresse', 'où envoyer les secours', 'bouton gros', () => this.ouvrirLieu(null), 'autre-lieu'),
    );
    page.append(outils);
    page.append(creer('p', 'presentation', "L'alerte, le chronomètre global, la fiche bilan et le mode transmission restent disponibles."));
    this.zone.contenu.replaceChildren(page);
    this.suivreBandeauAcr(bandeau);
    this.majPuceEtRoles();
  }

  /**
   * M-1 (revue du lot K) : le bandeau « Arrêt cardiaque » tient sur UNE rangée ; MESURÉ (jamais une valeur en dur) : s'il prend plus de 15 % de la zone de la liste, il cesse d'être collant (classe `bandeau-acr-flux` :
   * il reste en tête de liste, dans le flux) ; sinon il est collant et la marge de défilement de la zone (`--marge-bandeau-acr`) vaut sa hauteur réelle : un élément amené en vue ne finit jamais dessous.
   * Remesuré à chaque changement de taille (rotation, texte agrandi, clavier) ; arrêté dès que l'écran change.
   */
  suivreBandeauAcr(bandeau) {
    this.arreterBandeauAcr();
    const zone = this.zone.contenu;
    const mesurer = () => {
      if (!bandeau.isConnected) { this.arreterBandeauAcr(); return; }
      // D-97b : priorité à la LARGEUR des boutons (commande vitale), décidée par la MESURE, du plus confortable au dernier recours ; on repart toujours de l'étape 1 (aucune dépendance à l'état précédent) :
      //   1 libellé « Arrêt cardiaque : » visible, boutons sur UNE ligne ; 2 libellé masqué (toujours lu à voix haute), UNE ligne ; 3 libellé masqué, texte sur 2 lignes (coupé entre les mots) ;
      //   4 texte réduit de 1 px en 1 px jusqu'à un plancher de 14 px, sans jamais couper un mot. Un bouton « déborde » quand son texte sort de sa case (position réelle des lignes, `texteDeborde`).
      const boutons = [...bandeau.querySelectorAll('.bouton-acr')];
      bandeau.classList.remove('bandeau-acr-compact', 'bandeau-acr-deux-lignes');
      for (const bt of boutons) bt.style.removeProperty('font-size');
      const deborde = () => boutons.some(texteDeborde);
      let etape = 1;
      if (deborde()) { bandeau.classList.add('bandeau-acr-compact'); etape = 2; }
      const part = () => (zone.clientHeight > 0 ? bandeau.getBoundingClientRect().height / zone.clientHeight : Infinity);
      const base = parseFloat(getComputedStyle(boutons[0]).fontSize) || 16;
      const reduire = () => { for (let t = Math.floor(base) - 1; t >= PLANCHER_TEXTE_ACR; t--) { for (const bt of boutons) bt.style.fontSize = `${t}px`; if (!deborde()) return true; } return false; };
      if (etape === 2 && deborde()) {
        // étape 3 : 2 lignes, seulement si le bandeau y reste COLLANT (part ≤ 15 % de la zone, D-97b M-2) : une commande vitale qui sort de l'écran au défilement vaut moins qu'un texte un peu plus petit
        bandeau.classList.add('bandeau-acr-deux-lignes'); etape = 3;
        if (deborde() || part() > PART_MAX_BANDEAU_ACR) {
          // étape 4 : texte réduit, d'abord sur UNE ligne ; si même au plancher il déborde, retour à 2 lignes réduites (aucun mot coupé, jamais de débordement tant que 14 px suffit)
          etape = 4; bandeau.classList.remove('bandeau-acr-deux-lignes');
          if (!reduire()) { bandeau.classList.add('bandeau-acr-deux-lignes'); for (const bt of boutons) bt.style.removeProperty('font-size'); reduire(); }
        }
      }
      bandeau.dataset.etapeAcr = String(etape);   // lu par les tests (1 à 4)
      const h = bandeau.getBoundingClientRect().height; const z = zone.clientHeight;
      const collant = z > 0 && h / z <= PART_MAX_BANDEAU_ACR;
      bandeau.classList.toggle('bandeau-acr-flux', !collant);
      zone.style.setProperty('--marge-bandeau-acr', collant ? `${Math.ceil(h) + 4}px` : '0px');
    };
    mesurer();
    if (typeof ResizeObserver !== 'function') return;
    this.suiviBandeauAcr = new ResizeObserver(mesurer);
    this.suiviBandeauAcr.observe(bandeau); this.suiviBandeauAcr.observe(zone);
    for (const bt of bandeau.querySelectorAll('.bouton-acr')) this.suiviBandeauAcr.observe(bt);   // D-97b (r-1) : un changement de largeur du bouton sans changement du bandeau est remesuré
  }

  arreterBandeauAcr() {
    this.suiviBandeauAcr?.disconnect(); this.suiviBandeauAcr = null;
    this.zone?.contenu?.style.removeProperty('--marge-bandeau-acr');
  }

  /**
   * POINT D'EXTENSION (D-51) : la checklist courte de `protocoles/urgence-commune.json`, affichée par `afficherAcr` (mêmes lignes, mêmes coches T+, mêmes précisions, même pastille Sources).
   * Tant que le fichier n'est pas publié (`protocole-commun.js`), `protocoleCommun` reste vide : cette fonction ne rend RIEN (aucune requête, aucune erreur). Fichier publié mais illisible : une ligne le dit.
   */
  construireChecklistCommune() {
    const i = this.intervention;
    const hote = creer('div', 'autre-checklist');
    if (i.communEtat === 'illisible') {
      hote.append(creer('p', 'avertissement-checklist', 'Liste de contrôle indisponible (fichier illisible) : les outils ci-dessous restent utilisables.', { id: 'commun-illisible', role: 'status' }));
      return hote;
    }
    if (!i.protocoleCommun || i.vueChecklistCommune.racines.length === 0) return hote;
    const equipe = this.construireEquipe();
    const zone = document.createElement('div');   // afficherAcr remplit un conteneur ; on récupère sa section
    afficherAcr(zone, {
      intervention: i, etat: this.clCommun, structure: this.structure, avantEcran: equipe.childElementCount > 0 ? [equipe] : [],
      auAlerte: () => this.ouvrirPanneau('alerte'), auRendre: () => this.rendre(), auRenvoi: (id) => this.renvoyerVers(id), renvoiPossible: (id) => i.protocolesAcr.includes(id),
      renvoiCibles: (id) => (i.protocolesAcr.includes(id) ? PROTOCOLES_ACR.filter((p) => p.id === id || (i.protocolesAcr.includes(p.id) && protocolePublie(p.id))).map((p) => ({ id: p.id, libelle: p.libelle })) : []),
      vue: i.vueChecklistCommune, protocole: i.protocoleCommun, classe: 'checklist-commune', sansMateriel: true, masquerRenvois: true,   // D-83 : le bandeau « Arrêt cardiaque » de l'écran remplace les étapes de renvoi vers l'ACR
    });
    hote.append(...zone.childNodes);
    return hote;
  }

  /**
   * RENVOI d'une étape de la checklist commune (`renvoi_protocole`) : bascule vers le protocole ACR par le MÊME chemin que la tuile rouge (un toucher, journalisé, fiche et coches conservées).
   * Les identifiants des ACR sont ceux de l'intervention (`protocolesAcr`, qui viennent de main.js), jamais une chaîne écrite ici ; toute autre valeur est ignorée, sans erreur.
   */
  renvoyerVers(idProtocole) {
    const i = this.intervention;
    if (!i.protocolesAcr.includes(idProtocole) || i.situation !== AUTRE) return;
    this.versPrincipal(); i.choisirAcr(idProtocole).catch(() => {});
  }

  /** Ouvre le lieu ; `retour` = l'écran où revient « Retour » : 'alerte' depuis le panneau d'alerte (comportement d'origine), null depuis « Autre situation ». */
  ouvrirLieu(retour) { this.lieuRetour = retour; this.ouvrirPanneau('lieu'); }

  afficherAcr() {
    const i = this.intervention;
    const avant = [];
    const equipe = this.construireEquipe();
    if (equipe.childElementCount > 0) avant.push(equipe);
    afficherAcr(this.zone.contenu, {
      intervention: i, etat: this.cl, structure: this.structure, avantEcran: avant, zoneCycle: this.construireZoneCycle(),
      auAlerte: () => this.ouvrirPanneau('alerte'), auRendre: () => this.rendre(),
    });
    this.majPuceEtRoles();
    this.majZoneCycle();
  }

  /** Panneau de la pastille : ce qui manque (son à tester et à CONFIRMER, veille de l'écran), la parade, et le détail du métronome (marque « provisoire »). */
  afficherTelephone() {
    const i = this.intervention;
    const page = creer('section', 'ecran-info ecran-telephone', '', { 'aria-label': 'Son et écran' });
    const titre = creer('div', 'panneau-titre');
    titre.append(creer('h1', 'info-titre', 'Son et écran'), bouton('Fermer', 'bouton', () => this.ouvrirPanneau(null), { id: 'fermer-telephone' }));
    page.append(titre);
    const a = this.etatAvertissements();
    if (!a.son && !a.veille) page.append(creer('p', null, 'Bip entendu et écran maintenu allumé : rien à signaler.', { role: 'status' }));
    if (a.son) page.append(creer('p', null, this.son.etat().avertissement));
    if (a.veille) page.append(creer('p', null, this.ecran.etat().avertissement));
    page.append(bouton('Tester maintenant', 'bouton bouton-accent bouton-plein', async () => {
      this.messageTest = 'Test en cours…'; this.rendre();
      const r = await testerSonEtEcran({ son: this.son, ecran: this.ecran });
      this.messageTest = phraseDuTest(r);
      this.testASonConfirmer = true;
      this.actions.testeFait?.(r);
      this.rendre();
    }, { id: 'telephone-tester' }));
    if (this.messageTest) page.append(creer('p', 'plan-aide', this.messageTest, { role: 'status' }));
    // le son n'est « vérifié » que si l'utilisateur dit l'avoir ENTENDU (le contexte audio « running » ne prouve pas que le son sort : cahier 2.6)
    if (this.testASonConfirmer && !etatTest.son) {
      page.append(creer('p', null, 'Avez-vous entendu le bip ?'));
      page.append(bouton("Oui, j'ai entendu", 'bouton bouton-plein', () => { confirmerSon(true); this.testASonConfirmer = false; this.rendre(); }, { id: 'telephone-entendu' }));
      page.append(bouton("Non, pas entendu", 'bouton bouton-plein', () => { confirmerSon(false); this.testASonConfirmer = false; this.messageTest = 'Bip non entendu : vérifiez le mode silencieux et le volume média, puis testez de nouveau.'; this.rendre(); }, { id: 'telephone-pas-entendu' }));
    }
    const m = i.metronome;
    if (m && (m.marque || m.modeMarque)) {
      const detail = `${m.frequence}/min${m.marque ? ` — ${m.marque}` : ''}${m.modeMarque ? ` · mode ${m.mode} — ${m.modeMarque}` : ''}`;
      page.append(creer('p', 'plan-aide', `✱ Métronome : ${detail}`, { id: 'frequence' }));
    }
    this.zone.contenu.replaceChildren(page);
  }

  /** La carte du cycle apparaît dès le PREMIER TOUCHER d'une action vitale (revue R1, M2) — même si l'étape « Cycles » n'est pas cochable (profession, fichier illisible) — ou dès que le cycle tourne. */
  cycleMasque() {
    const i = this.intervention;
    const c = i.chronoCycle;
    return !i.tuileTouchee && !(c && i.gestion?.trouver(c.id));
  }

  /**
   * Carte du cycle, collée en haut de l'écran ACR une fois le cycle démarré, sur UNE rangée : statut et décompte à gauche, « Relancer » et le bouton des événements à droite
   * (analyse, choc, relève… viennent du protocole ; la note du chronomètre et les rappels échus s'ouvrent avec eux).
   */
  construireZoneCycle() {
    const i = this.intervention;
    const cycle = creer('div', 'zone-cycle', '', { id: 'zone-cycle' });   // volet ouvert, un toucher ici NE FAIT QUE fermer le volet (D-64d, N1-bis) : « Relancer » accidentel recalerait le cycle, un événement noterait une fausse heure
    cycle.hidden = this.cycleMasque();
    const haut = creer('div', 'cycle-haut');
    haut.append(creer('p', 'cycle-statut', '', { id: 'cycle-statut' }));
    haut.append(creer('p', 'cycle-decompte', '--:--', { id: 'cycle-decompte' }));
    cycle.append(haut);
    if (i.chronoCycle) cycle.append(bouton('Relancer', 'bouton bouton-accent bouton-relance', () => i.relancerCycle(), { id: 'relance-cycle', 'aria-label': `Relancer le cycle : ${i.libelleRelance}` }));
    if (i.evenements.length > 0 || i.chronoCycle?.note) {
      const ouverts = this.cl.evenements;
      cycle.append(bouton(ouverts ? '▴' : '▾', 'bouton bouton-evenements', () => { this.cl.evenements = !this.cl.evenements; this.rendre(); }, { id: 'evenements-bascule', 'aria-expanded': String(ouverts), 'aria-label': 'Événements et précisions du cycle' }));
    }
    const evenements = creer('div', 'evenements', '', { id: 'evenements', hidden: this.cl.evenements ? null : '' });
    if (i.chronoCycle?.note) evenements.append(creer('p', 'cycle-note', `${i.chronoCycle.note}${suffixeMarques(i.chronoCycle, { note: i.chronoCycle.note })}`, { id: 'cycle-note' }));
    for (const ev of i.evenements) {
      const b = bouton('', 'bouton', () => { i.noterEvenement(ev.id); }, { 'data-evenement': ev.id });
      // A2 : l'espace est HORS du compteur (qui ne se coupe pas) : sinon « défibrillateur (0) » devenait un seul bloc et se coupait au milieu du mot
      b.append(creer('span', null, ev.libelle), document.createTextNode(' '), creer('span', 'compte', `(${i.compteEvenement(ev.id)})`));
      if (ev.statut === 'A_VALIDER') b.append(creer('span', 'marque', MARQUE_A_VALIDER));   // revue m6 : le contenu non établi se voit partout où il s'affiche
      evenements.append(b);
    }
    cycle.append(evenements);
    cycle.append(creer('div', 'rappels', '', { id: 'rappels' }));
    return cycle;
  }

  /** Décompte du cycle, statut en TEXTE + pictogramme (jamais la couleur seule), rappels échus. */
  majZoneCycle() {
    const i = this.intervention;
    const zone = document.getElementById('zone-cycle');
    if (!zone || !i.gestion) return;
    zone.hidden = this.cycleMasque();
    const c = i.chronoCycle;
    if (c) {
      const l = i.gestion.trouver(c.id) ? i.gestion.lire(c.id) : null;
      document.getElementById('cycle-decompte').textContent = l ? (l.restantMs >= 0 ? formaterDuree(l.restantMs) : `+${formaterDuree(l.depassementMs)}`) : '--:--';
      const libelle = { en_cours: '▶ en cours', proche: '⚠ échéance proche', echeance: '⏰ échéance', arrete: '■ arrêté' };
      document.getElementById('cycle-statut').textContent = l ? `cycle ${l.cycle} — ${libelle[l.statut]}` : 'cycle non démarré';
      const relance = document.getElementById('relance-cycle');
      if (relance) relance.textContent = l ? 'Relancer' : 'Démarrer le cycle';
    }
    const rappels = document.getElementById('rappels');
    if (rappels) {
      rappels.replaceChildren();
      for (const r of i.rappels) {
        const l = i.gestion.trouver(r.id) ? i.gestion.lire(r.id) : null;
        if (l?.statut !== 'echeance') continue;
        rappels.append(creer('p', 'rappel', `⏰ ${[r.libelle, r.note].filter(Boolean).join(' — ')}${suffixeMarques(r)}`));
      }
    }
  }

  // ───────── Menu ─────────

  afficherMenu() {
    const i = this.intervention;
    const page = creer('section', 'menu-intervention');
    page.setAttribute('aria-label', 'Menu');
    const rubrique = (titre, classe = 'phase') => page.append(creer('h2', classe, titre));
    // `sous` : valeur courante en petit sous le libellé (masquée en paysage bas : la place y est comptée)
    const ligne = (libelle, action, id, classe = 'bouton bouton-plein', sous = null) => {
      const b = bouton(libelle, classe, action, { id });
      if (sous) b.append(creer('small', 'menu-sous', sous));
      page.append(b);
    };
    // trois rubriques (relecture design D8) : Pendant l'intervention · Outils · Fin
    // ANNULER LE DÉMARRAGE (revue R1, C1) : proposé EN TÊTE du menu (toujours visible) seulement dans les 60 premières secondes et tant que rien n'a été fait ; un SECOND toucher, qui dit ce qui sera effacé, l'exécute
    if (i.annulable) {
      const annuler = bouton('Annuler le démarrage', 'bouton bouton-plein', () => {
        const confirmer = bouton('Confirmer : effacer cette fiche vide', 'bouton bouton-urgence bouton-plein', () => this.annulerDemarrage(), { id: 'menu-annuler-confirme', title: `Fiche démarrée à ${heureLocale(i.fiche.journal[0].t)}, aucune saisie : elle sera effacée`, disabled: '' });
        annuler.replaceWith(confirmer);
        // N1 : désactivée pendant 1 s (un double toucher sur « Annuler le démarrage » ne l'actionne pas), puis retirée au bout de 6 s
        setTimeout(() => { if (confirmer.isConnected) confirmer.disabled = false; }, 1000);
        setTimeout(() => { if (confirmer.isConnected) confirmer.replaceWith(annuler); }, 6000);
      }, { id: 'menu-annuler' });
      page.append(annuler);
    }
    rubrique('Pendant');
    // A7 : « Changer de situation » est la seule de ces actions utile PENDANT un arrêt (adulte ↔ enfant) : en tête de « Pendant », plus au milieu de « Fin »
    ligne('Changer de situation', () => this.ouvrirPanneau('situation'), 'menu-situation');
    ligne('Mode transmission', () => this.ouvrirPanneau('transmission'), 'menu-transmission');
    ligne('Journal', () => this.ouvrirPanneau('journal'), 'menu-journal');
    ligne('Rôles', () => this.ouvrirPanneau('roles'), 'menu-roles', 'bouton bouton-plein', i.roles.length > 0 ? texteBandeauCourt(i.roles) : 'non attribués');
    ligne('Matériel', () => { this.materielAcr = null; this.materielAcrEchec = false; this.ouvrirPanneau('materiel'); }, 'menu-materiel');
    rubrique('Outils');
    ligne('Glossaire', () => this.ouvrirPanneau('glossaire'), 'menu-glossaire');
    ligne('Préparer ce téléphone', () => this.ouvrirPanneau('telephone'), 'menu-tester');
    ligne('Profession', () => this.ouvrirPanneau('profession'), 'menu-profession', 'bouton bouton-plein', this.nomProfession());
    ligne('À propos', () => this.ouvrirPanneau('apropos'), 'menu-apropos');
    rubrique('Fin', 'phase phase-fin');   // séparée de 16 px des lignes d'outils (feuille de style)
    const terminer = bouton("Terminer l'intervention", 'bouton bouton-plein bouton-terminer', () => {
      terminer.replaceWith(bouton("Confirmer : terminer l'intervention", 'bouton bouton-urgence bouton-plein', () => { i.terminer(); this.actions.terminee(); }, { id: 'menu-terminer-confirme' }));
    }, { id: 'menu-terminer' });
    page.append(terminer);
    ligne('Clôture et export', () => this.ouvrirPanneau('cloture'), 'menu-cloture');   // fonction 25 de 4.0 : exporter, clôturer
    ligne('Nouvelle urgence', () => this.actions.nouvelleUrgence(), 'menu-nouvelle-urgence');
    ligne('Accueil', () => this.actions.accueil(), 'menu-accueil');
    this.zone.contenu.replaceChildren(page);
  }
}
