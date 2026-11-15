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
import { afficherFiche } from './fiche.js';
import { afficherTransmission } from './transmission.js';
import { afficherJournal } from './journal.js';
import { afficherCloture } from './cloture.js';
import { afficherMateriel } from './materiel.js';
import { afficherAPropos } from './a-propos.js';
import { construireMateriel } from '../materiel.js';
import { construireTransmission } from '../bilan.js';
import { texteBandeau, texteBandeauCourt, texteBandeauRempli } from '../roles.js';
import { ACR, AUTRE } from '../intervention.js';
/** Après la bascule « Autre situation » → ACR, les touchers sur le contenu sont ignorés ce temps (R1f, M2). */
const DELAI_REBOND_BASCULE_MS = 600;

/**
 * ÉCRANS DE SAISIE : liste UNIQUE des panneaux où l'on tape. Ils ne sont JAMAIS reconstruits sur l'événement « changement » : sinon la
 * frappe en cours serait effacée à chaque événement (bug silencieux, sans erreur). Tout nouvel écran avec un champ de saisie doit être
 * ajouté ici ; un test (tests/unitaires/protections-surete.test.mjs) échoue s'il manque. Exception voulue : l'écran ACR (écran principal, pas un panneau) se redessine
 * mais garde sa saisie de l'heure dans `this.cl`.
 */
export const ECRANS_DE_SAISIE = ['lieu', 'roles', 'profession', 'fiche', 'transmission', 'journal', 'cloture', 'apropos'];

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
    this.panneau = null;            // null (écran principal : conduite à tenir) | 'alerte' | 'lieu' | 'menu' | 'situation' | 'roles' | 'profession' | 'glossaire' | 'fiche' | 'transmission' | 'journal' | 'cloture' | 'materiel' | 'apropos'
    this.repriseRepliee = false; this.versionVue = false;   // bandeaux « Fiche reprise » (replié au premier toucher) et « Appli mise à jour » (acquitté)
    this.fb = { ajout: null };                 // fiche bilan : formulaire d'ajout ouvert
    this.tr = { page: 0, edition: false };     // mode transmission : page courante, saisie E / D ouverte
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
    if (this.intervention.transmissionAuRetour) { this.intervention.transmissionAuRetour = false; this.panneau = 'transmission'; }   // reprise après un appel : transmission d'abord
    this.debranchements.push(this.intervention.ecouter((e) => this.surEvenement(e)));
    // premier toucher dans la fiche reprise : le bandeau « Fiche reprise » se replie APRÈS l'action touchée (jamais entre le toucher et le clic :
    // le contenu ne bouge pas sous le doigt)
    // R1f (M2) : après un changement de situation (tuile rouge, bouton « Passer en ACR »), les touchers sur le contenu sont ignorés ~600 ms : un double toucher ne doit rien cocher sur l'écran qui s'ouvre
    const ignorerRebond = (ev) => { if (this.panneau === null && performance.now() < this.touchesIgnoreesJusqua) { ev.stopPropagation(); ev.preventDefault(); } };
    this.zone.contenu.addEventListener('click', ignorerRebond, true);
    this.debranchements.push(() => this.zone.contenu.removeEventListener('click', ignorerRebond, true));
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
    clearInterval(this.minuteur);
    this.arreterBoucle?.();
    this.secours?.arreter(); this.secours = null;
    this.cloture?.demonter(); this.cloture = null;
    for (const d of this.debranchements) { try { d(); } catch { /* déjà débranché */ } }
    this.debranchements = [];
    this.son.onBattement = () => {}; this.son.onEtat = () => {}; this.ecran.onEtat = () => {};
    const { appli, entete, barre, bandeaux } = this.zone;
    appli.classList.remove('gabarit');
    entete.hidden = true; barre.hidden = true; entete.replaceChildren(); barre.replaceChildren();
    for (const b of bandeaux.querySelectorAll('[data-bandeau="simulation"],[data-bandeau="reprise"],[data-bandeau="version"],[data-bandeau="son"],[data-bandeau="ecran"],[data-bandeau="echeance"],[data-bandeau="rattrapage"]')) b.remove();
    delete document.body.dataset.mode; delete document.body.dataset.texte; delete document.body.dataset.panneau;
  }

  surEvenement(e) {
    // pendant une saisie, un changement ne doit PAS reconstruire le formulaire (on perdrait la frappe en cours) : voir ECRANS_DE_SAISIE
    if (e.type === 'changement' && !ECRANS_DE_SAISIE.includes(this.panneau)) this.rendre();
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
    el.textContent = i.situation === ACR ? (i.protocole?.titre_court ?? i.protocole?.titre ?? 'Urgence') : i.situation === AUTRE ? 'Autre situation' : 'Urgence';
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

  pulser() {
    const r = document.getElementById('repere');
    if (!r) return;
    r.classList.add('repere-actif');
    setTimeout(() => r.classList.remove('repere-actif'), 120);
  }

  /** Texte très agrandi (≥ 200 % : racine ≥ 22 px) : l'en-tête et les bandeaux se resserrent (voir app.css, data-texte="grand"). */
  majTaille() {
    const grand = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 22;
    document.body.dataset.texte = grand ? 'grand' : 'normal';
  }

  rafraichir() {
    const i = this.intervention;
    if (i.detruite) return;
    this.majTaille();
    i.tick();
    const global = document.getElementById('chrono-global');
    if (global) global.textContent = i.texteGlobal();
    this.majBarreVitale();
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
      puce.textContent = `⚠ Profession ${this.nomProfession()} — régler`;
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
    this.poserBandeauTemporaire('echeance', `Échéance : ${texte}${def ? suffixeMarques(def) : ''}`, 15000);   // les mêmes marques que la zone du cycle (revue m6)
  }

  afficherRattrapage({ franchies }) {
    const texte = franchies.map((f) => `${this.intervention.definitions.find((d) => d.id === f.id)?.libelle ?? f.id} : ${texteDepassement(f.depassementMs)}`).join(' ; ');
    this.poserBandeauTemporaire('rattrapage', texte, 20000); // toujours en bandeau, jamais en voile
  }

  poserBandeauTemporaire(cle, texte, dureeMs) {
    const zone = this.zone.bandeaux;
    zone.querySelector(`[data-bandeau="${cle}"]`)?.remove();
    const b = creer('div', 'bandeau bandeau-avertissement', texte, { 'data-bandeau': cle, role: 'status', title: texte });
    b.append(' ', bouton('OK', 'bouton', () => b.remove()));
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
    if (id === 'fiche') { this.ouvrirPanneau(this.panneau === 'fiche' ? null : 'fiche'); return; }   // un second toucher revient à la conduite à tenir
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
    this.panneau = nom; this.messageTest = null; this.rendre();
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
      b.append(creer('span', 'simulation-mot', 'SIMULATION'));
      b.append(bouton('URGENCE RÉELLE', 'bouton bouton-urgence', () => this.actions.urgenceReelle(), { id: 'urgence-reelle' }));
      b.append(bouton('Quitter', 'bouton', () => this.demanderQuitterSimulation(b), { id: 'quitter-simulation' }));
      zone.prepend(b);
    }
    if (i.repriseDe) {
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
    if (i.versionDifferente && !this.versionVue) {
      // parade 3 (2.4, revue M2) : l'appli a changé de version pendant l'intervention ; dit une fois, acquittable en un toucher
      const texte = `Appli mise à jour pendant l'intervention (version ${i.versionDifferente.de} → ${i.versionDifferente.vers})`;
      const b = creer('div', 'bandeau bandeau-avertissement', texte, { 'data-bandeau': 'version', title: texte, role: 'status' });
      b.append(' ', bouton('OK', 'bouton', () => { this.versionVue = true; b.remove(); }, { id: 'version-ok' }));
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
    const cle = `${this.panneau ?? 'principal'}|${this.intervention.situation ?? ''}`;
    if (cle !== this.cleEcran) {
      if (this.situationAffichee === AUTRE && this.intervention.situation === ACR) this.touchesIgnoreesJusqua = performance.now() + DELAI_REBOND_BASCULE_MS;
      this.zone.contenu.scrollTop = 0; this.cleEcran = cle; this.situationAffichee = this.intervention.situation;
    }
  }

  dessiner() {
    const i = this.intervention;
    const { contenu } = this.zone;
    this.secours?.arreter(); this.secours = null;
    document.body.dataset.panneau = this.panneau ?? '';   // l'en-tête se compacte pendant l'appel (app.css, L9c étape 2, M4)
    this.majBandeauxFixes();
    this.majBandeauxSon();
    this.majBarre();
    if (this.panneau !== 'cloture' && this.cloture) { this.cloture.demonter(); this.cloture = null; }   // quitter l'écran retire aussi le document d'impression de la page
    if (this.panneau === 'cloture') {
      this.cloture?.demonter();
      this.cloture = afficherCloture(contenu, {
        fiche: i.fiche, stockage: i.stockage,
        structure: () => this.structure, champsSensibles: () => i.champsSensibles, appelant: () => i.appelant, protocoleId: i.protocoleId,
        effacer: () => i.cloturerEtEffacer(),
        apresEffacement: (res) => this.actions.effacee?.(res),
        auFermer: () => (i.detruite ? this.actions.terminee() : this.ouvrirPanneau(null)),   // L8c (revue L8 m2) : l'intervention est déjà terminée (effacement échoué) : retour à l'accueil, où la fiche attend (Exporter, Effacer)
      });
    } else if (this.panneau === 'materiel') {
      // le protocole de la fiche (copie), sinon celui en mémoire : « Autre situation » n'en a pas, la liste est alors dite vide
      const protocole = i.protocole ?? i.fiche.protocoles_utilises?.[i.protocoleId] ?? null;
      afficherMateriel(contenu, { modele: construireMateriel({ protocole, structure: this.structure }), avecArticles: true, auFermer: () => this.ouvrirPanneau(null) });
    } else if (this.panneau === 'apropos') {
      afficherAPropos(contenu, { chargerProtocole: () => (i.protocole ? Promise.resolve({ ok: true, protocole: i.protocole }) : i.chargerProtocoleFn(i.protocoleId)), stockage: i.stockage, auFermer: () => this.ouvrirPanneau(null) });
    } else if (this.panneau === 'fiche') {
      afficherFiche(contenu, { intervention: i, etat: this.fb });
    } else if (this.panneau === 'transmission') {
      const pages = construireTransmission({ fiche: i.fiche, structure: this.structure, champsSensibles: i.champsSensibles, appelant: i.appelant, protocoleId: i.protocoleId, maintenant: Date.now() });
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
    if (fiche) fiche.setAttribute('aria-current', this.panneau === 'fiche' ? 'page' : 'false');
    const menu = document.getElementById('barre-menu');
    if (menu) { const ouvert = this.panneau === 'menu'; menu.setAttribute('aria-expanded', String(ouvert)); menu.textContent = ouvert ? '✕' : '⋯'; menu.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Menu'); }
    this.majTitre();
  }

  afficherChoix() {
    const i = this.intervention;
    const page = creer('section', 'choix-situation');
    page.setAttribute('aria-label', 'Situation');
    // (rendre() explicite : si la situation est déjà celle-là — menu « Changer de situation » — aucun événement ne la réaffiche)
    page.append(bouton('ACR adulte', 'bouton bouton-accent bouton-tres-grand bouton-plein', async () => { this.versPrincipal(); const p = i.choisirAcr(); this.rendre(); await p; this.rendre(); }, { id: 'choix-acr' }));
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
    const page = creer('section', 'accueil autre-situation', '', { 'aria-label': 'Autre situation' });
    /** Grosse tuile : titre + sous-titre discret (comme l'accueil). */
    const gros = (titre, sous, classe, action, id) => { const b = bouton(titre, classe, action, { id }); b.append(creer('small', null, sous)); return b; };
    const urgence = creer('div', 'accueil-grille');
    urgence.append(gros('Arrêt cardiaque', 'passer en ACR', 'bouton bouton-urgence gros gros-urgence', () => { this.versPrincipal(); i.choisirAcr().catch(() => {}); }, 'passer-acr'));
    page.append(urgence);
    page.append(this.construireChecklistCommune());
    const outils = creer('div', 'accueil-grille autre-outils');
    outils.append(
      gros('Fiche bilan', 'noter les informations', 'bouton gros', () => this.ouvrirPanneau('fiche'), 'autre-fiche'),
      gros('Transmission au 15', 'message structuré', 'bouton gros', () => this.ouvrirPanneau('transmission'), 'autre-transmission'),
      gros('Lieu / adresse', 'où envoyer les secours', 'bouton gros', () => this.ouvrirLieu(null), 'autre-lieu'),
    );
    page.append(outils);
    page.append(creer('p', 'autre-bientot', 'Bientôt : autres protocoles', { id: 'autre-bientot' }));
    page.append(creer('p', 'presentation', "L'alerte, le chronomètre global, la fiche bilan et le mode transmission restent disponibles."));
    this.zone.contenu.replaceChildren(page);
    this.majPuceEtRoles();
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
      auAlerte: () => this.ouvrirPanneau('alerte'), auRendre: () => this.rendre(), auRenvoi: (id) => this.renvoyerVers(id), renvoiPossible: (id) => id === i.protocoleId,
      vue: i.vueChecklistCommune, protocole: i.protocoleCommun, classe: 'checklist-commune', sansMateriel: true,
    });
    hote.append(...zone.childNodes);
    return hote;
  }

  /**
   * RENVOI d'une étape de la checklist commune (`renvoi_protocole`) : bascule vers le protocole ACR par le MÊME chemin que la tuile rouge (un toucher, journalisé, fiche et coches conservées).
   * L'identifiant de l'ACR est celui de l'intervention (`protocoleId`, qui vient de main.js), jamais une chaîne écrite ici ; toute autre valeur est ignorée, sans erreur.
   */
  renvoyerVers(idProtocole) {
    const i = this.intervention;
    if (idProtocole !== i.protocoleId || i.situation !== AUTRE) return;
    this.versPrincipal(); i.choisirAcr().catch(() => {});
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
    const cycle = creer('div', 'zone-cycle', '', { id: 'zone-cycle' });
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
      b.append(creer('span', null, ev.libelle), creer('span', 'compte', ` (${i.compteEvenement(ev.id)})`));
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
    const rubrique = (titre) => page.append(creer('h2', 'phase', titre));
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
    ligne('Mode transmission', () => this.ouvrirPanneau('transmission'), 'menu-transmission');
    ligne('Journal', () => this.ouvrirPanneau('journal'), 'menu-journal');
    ligne('Rôles', () => this.ouvrirPanneau('roles'), 'menu-roles', 'bouton bouton-plein', i.roles.length > 0 ? texteBandeauCourt(i.roles) : 'non attribués');
    ligne('Matériel', () => this.ouvrirPanneau('materiel'), 'menu-materiel');
    rubrique('Outils');
    ligne('Glossaire', () => this.ouvrirPanneau('glossaire'), 'menu-glossaire');
    ligne('Préparer ce téléphone', () => this.ouvrirPanneau('telephone'), 'menu-tester');
    ligne('Profession', () => this.ouvrirPanneau('profession'), 'menu-profession', 'bouton bouton-plein', this.nomProfession());
    ligne('À propos', () => this.ouvrirPanneau('apropos'), 'menu-apropos');
    rubrique('Fin');
    const terminer = bouton("Terminer l'intervention", 'bouton bouton-plein bouton-terminer', () => {
      terminer.replaceWith(bouton("Confirmer : terminer l'intervention", 'bouton bouton-urgence bouton-plein', () => { i.terminer(); this.actions.terminee(); }, { id: 'menu-terminer-confirme' }));
    }, { id: 'menu-terminer' });
    page.append(terminer);
    ligne('Clôture et export', () => this.ouvrirPanneau('cloture'), 'menu-cloture');   // fonction 25 de 4.0 : exporter, clôturer
    ligne('Changer de situation', () => this.ouvrirPanneau('situation'), 'menu-situation');
    ligne('Nouvelle urgence', () => this.actions.nouvelleUrgence(), 'menu-nouvelle-urgence');
    ligne('Accueil', () => this.actions.accueil(), 'menu-accueil');
    this.zone.contenu.replaceChildren(page);
  }
}
