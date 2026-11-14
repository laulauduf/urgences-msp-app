// Interface d'une intervention : en-tête fixe, barre du bas, bandeaux, et l'écran courant (choix de situation, écran ACR, panneau d'alerte,
// lieu, menu, secours). Cahier des charges 4.0 à 4.3 bis, 4.7, 4.11, 5.1 à 5.3.
// RÈGLES : rien ne recouvre l'en-tête, la barre du bas ni les tuiles vitales ; aucun bouton n'attend le stockage ; la barre n'affiche que les
// écrans DÉJÀ LIVRÉS (aucun lien vers un écran pas encore écrit) ; aucun ordre ni texte médical en dur — tout vient du protocole.
import { creer, bouton, heureLocale } from '../dom.js';
import { formaterDuree, texteDepassement, MARQUE_PROVISOIRE } from '../horloge.js';
import { afficherSecours } from './secours.js';
import { afficherAlerte } from './alerte.js';
import { afficherLieu } from './lieu.js';
import { testerSonEtEcran } from '../test-appareil.js';
import { ACR, AUTRE } from '../intervention.js';

/** Boutons de la barre du bas. Chaque lot ajoute les siens : `disponible` passe à vrai quand son écran est livré (L6 : checklist, L7 : fiche). */
export const BARRE = [
  { id: 'acr', libelle: 'ACR', disponible: true },
  { id: 'alerter', libelle: 'ALERTER', disponible: true },
  { id: 'checklist', libelle: 'CHECKLIST', disponible: false },   // lot L6
  { id: 'fiche', libelle: 'FICHE', disponible: false },            // lot L7
  { id: 'menu', libelle: '⋯', disponible: true, nom: 'Menu' },
];

export class InterfaceIntervention {
  /**
   * @param {{racine?: Document, intervention: object, son: object, ecran: object, numeros: object, structure: () => object|null,
   *          actions: {accueil: () => void, nouvelleUrgence: () => void, urgenceReelle: () => void, terminee: () => void}}} options
   */
  constructor({ intervention, son, ecran, numeros, structure, actions }) {
    Object.assign(this, { intervention, son, ecran, numerosFn: numeros, structureFn: structure, actions });
    this.panneau = null;            // null | 'alerte' | 'lieu' | 'menu' | 'situation'
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
    this.debranchements.push(this.intervention.ecouter((e) => this.surEvenement(e)));
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
    for (const d of this.debranchements) { try { d(); } catch { /* déjà débranché */ } }
    this.debranchements = [];
    this.son.onBattement = () => {}; this.son.onEtat = () => {}; this.ecran.onEtat = () => {};
    const { appli, entete, barre, bandeaux } = this.zone;
    appli.classList.remove('gabarit');
    entete.hidden = true; barre.hidden = true; entete.replaceChildren(); barre.replaceChildren();
    for (const b of bandeaux.querySelectorAll('[data-bandeau="simulation"],[data-bandeau="reprise"],[data-bandeau="son"],[data-bandeau="ecran"],[data-bandeau="echeance"],[data-bandeau="rattrapage"]')) b.remove();
    delete document.body.dataset.mode; delete document.body.dataset.texte;
  }

  surEvenement(e) {
    // pendant la saisie du lieu, un changement ne doit PAS reconstruire le formulaire (on perdrait la saisie en cours)
    if (e.type === 'changement' && this.panneau !== 'lieu') this.rendre();
    if (e.type === 'echeance') this.afficherEcheance(e);
    if (e.type === 'rattrapage') this.afficherRattrapage(e);
  }

  // ───────── En-tête ─────────

  construireEntete() {
    const { entete } = this.zone;
    entete.replaceChildren();
    const global = creer('span', 'chrono-global', '00:00', { id: 'chrono-global', 'aria-label': "Temps depuis URGENCE" });
    entete.append(global);
    entete.append(creer('span', 'chrono-cycle', '', { id: 'chrono-cycle', hidden: '' }));
    const metronome = creer('span', 'metronome');
    metronome.append(creer('span', 'repere', '', { id: 'repere', 'aria-hidden': 'true' }));
    metronome.append(creer('span', 'frequence', '', { id: 'frequence' }));
    metronome.append(bouton('Démarrer', 'bouton', () => this.intervention.basculerMetronome(), { id: 'pause-metronome' }));
    metronome.hidden = true; metronome.id = 'bloc-metronome';
    entete.append(metronome);
    // places RÉSERVÉES : la puce profession et le bandeau des rôles apparaissent au lot L5b
    entete.append(creer('span', 'place-profession', '', { 'data-place': 'profession', hidden: '' }));
    entete.append(creer('span', 'avertissement-son', '', { id: 'avertissement-son' }));
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
    const cycle = i.chronoCycle;
    const elCycle = document.getElementById('chrono-cycle');
    if (elCycle) {
      const l = cycle && i.gestion?.trouver(cycle.id) ? i.gestion.lire(cycle.id) : null;
      elCycle.hidden = !cycle;
      if (cycle) elCycle.textContent = l ? `cycle ${l.cycle} — ${l.restantMs >= 0 ? formaterDuree(l.restantMs) : texteDepassement(l.depassementMs)}` : 'cycle — non démarré';
    }
    // métronome : fréquence, marque « provisoire », bouton Démarrer / Pause / Reprise
    const m = i.metronome;
    const blocM = document.getElementById('bloc-metronome');
    if (blocM) {
      blocM.hidden = !m;
      if (m) {
        const e = this.son.etat().metronome;
        document.getElementById('frequence').textContent = `${m.frequence}/min${m.marque ? ` — ${m.marque}` : ''}${m.modeMarque ? ` · mode ${m.mode} — ${m.modeMarque}` : ''}${e.mention ? ` · ${e.mention}` : ''}`;
        document.getElementById('pause-metronome').textContent = e.actif ? 'Pause' : (e.frequence === null ? 'Démarrer' : 'Reprise');
      }
    }
    const av = document.getElementById('avertissement-son');
    if (av) av.textContent = this.son.etat().avertissement;
    this.majZoneCycle();
  }

  majBandeauxSon() {
    const poser = (cle, texte) => {
      const zone = this.zone.bandeaux;
      zone.querySelector(`[data-bandeau="${cle}"]`)?.remove();
      if (texte) { const b = creer('div', 'bandeau bandeau-avertissement', texte, { 'data-bandeau': cle }); zone.append(b); }
    };
    poser('son', this.son.etat().bandeau);
    poser('ecran', this.ecran.etat().avertissement);
  }

  afficherEcheance({ id, alerte, depassementMs }) {
    if (alerte === 'aucune') return;
    const def = this.intervention.definitions.find((d) => d.id === id);
    const texte = [def?.libelle ?? id, def?.note].filter(Boolean).join(' — ');
    this.poserBandeauTemporaire('echeance', `Échéance : ${texte}`, 15000);
  }

  afficherRattrapage({ franchies }) {
    const texte = franchies.map((f) => `${this.intervention.definitions.find((d) => d.id === f.id)?.libelle ?? f.id} : ${texteDepassement(f.depassementMs)}`).join(' ; ');
    this.poserBandeauTemporaire('rattrapage', texte, 20000); // toujours en bandeau, jamais en voile
  }

  poserBandeauTemporaire(cle, texte, dureeMs) {
    const zone = this.zone.bandeaux;
    zone.querySelector(`[data-bandeau="${cle}"]`)?.remove();
    const b = creer('div', 'bandeau bandeau-avertissement', texte, { 'data-bandeau': cle, role: 'status' });
    b.append(' ', bouton('OK', 'bouton', () => b.remove()));
    zone.append(b);
    setTimeout(() => b.remove(), dureeMs);
  }

  // ───────── Barre du bas ─────────

  construireBarre() {
    const { barre } = this.zone;
    barre.replaceChildren();
    barre.setAttribute('aria-label', "Barre d'intervention");
    for (const b of BARRE.filter((x) => x.disponible)) {
      const el = bouton(b.libelle, b.id === 'alerter' ? 'bouton bouton-urgence' : 'bouton', () => this.surBarre(b.id), { id: `barre-${b.id}`, 'aria-label': b.nom ?? b.libelle });
      barre.append(el);
    }
  }

  surBarre(id) {
    const i = this.intervention;
    if (id === 'alerter') { this.ouvrirPanneau('alerte'); return; }
    if (id === 'menu') { this.ouvrirPanneau(this.panneau === 'menu' ? null : 'menu'); return; }
    if (id === 'acr') {
      this.panneau = null;
      if (i.situation !== ACR) i.choisirAcr(); // « Autre situation » → ACR en UN toucher (journalisé, la fiche est conservée)
      else this.rendre();
    }
  }

  ouvrirPanneau(nom) { this.panneau = nom; this.messageTest = null; this.rendre(); }

  // ───────── Bandeaux d'état : simulation, reprise ─────────

  majBandeauxFixes() {
    const zone = this.zone.bandeaux;
    const i = this.intervention;
    zone.querySelector('[data-bandeau="simulation"]')?.remove();
    zone.querySelector('[data-bandeau="reprise"]')?.remove();
    if (i.simulation) {
      // texte + couleur + motif rayé, différent de tout autre bandeau ; présent sur CHAQUE écran de simulation
      const b = creer('div', 'bandeau-simulation', '', { 'data-bandeau': 'simulation' });
      b.append(creer('span', 'simulation-mot', 'SIMULATION'));
      b.append(bouton('URGENCE RÉELLE', 'bouton bouton-urgence', () => this.actions.urgenceReelle(), { id: 'urgence-reelle' }));
      b.append(bouton('Quitter', 'bouton', () => this.demanderQuitterSimulation(b), { id: 'quitter-simulation' }));
      zone.prepend(b);
    }
    if (i.repriseDe) {
      const b = creer('div', 'bandeau', `Fiche reprise — intervention commencée à ${heureLocale(i.repriseDe.debut)}`, { 'data-bandeau': 'reprise' });
      b.append(' ', bouton('NOUVELLE URGENCE', 'bouton bouton-urgence', () => this.actions.nouvelleUrgence(), { id: 'nouvelle-urgence-reprise' }),
        bouton('Accueil', 'bouton', () => this.actions.accueil(), { id: 'accueil-reprise' }));
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

  rendre() {
    const i = this.intervention;
    const { contenu } = this.zone;
    this.secours?.arreter(); this.secours = null;
    this.majBandeauxFixes();
    this.majBandeauxSon();
    this.majBarre();
    if (this.panneau === 'alerte') {
      afficherAlerte(contenu, { intervention: i, numeros: this.numerosFn(), structure: this.structure, auFermer: () => this.ouvrirPanneau(null), auLieu: () => this.ouvrirPanneau('lieu') });
    } else if (this.panneau === 'lieu') {
      afficherLieu(contenu, { intervention: i, structure: this.structure, auRetour: () => this.ouvrirPanneau('alerte') });
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
    const i = this.intervention;
    const acr = document.getElementById('barre-acr');
    if (acr) acr.setAttribute('aria-current', this.panneau === null && i.situation === ACR ? 'page' : 'false');
  }

  afficherChoix() {
    const i = this.intervention;
    const page = creer('section', 'choix-situation');
    page.setAttribute('aria-label', 'Situation');
    // (rendre() explicite : si la situation est déjà celle-là — menu « Changer de situation » — aucun événement ne la réaffiche)
    page.append(bouton('ACR adulte', 'bouton bouton-accent bouton-tres-grand bouton-plein', async () => { this.panneau = null; const p = i.choisirAcr(); this.rendre(); await p; this.rendre(); }, { id: 'choix-acr' }));
    page.append(bouton('Autre situation', 'bouton bouton-plein', () => { this.panneau = null; i.choisirAutre(); this.rendre(); }, { id: 'choix-autre' }));
    // « Annuler (démarrage par erreur) » : seulement sur CET écran, tant que la fiche ne contient rien d'autre que l'entrée « urgence »
    if (i.annulable) page.append(bouton('Annuler (démarrage par erreur)', 'bouton', async () => { await i.annulerDemarrage(); this.actions.accueil({ dejaDetruite: true }); }, { id: 'annuler-demarrage' }));
    this.zone.contenu.replaceChildren(page);
  }

  afficherAutre() {
    const page = creer('section', 'page');
    page.append(creer('h1', null, 'Autre situation'));
    page.append(creer('p', null, "L'alerte et le chronomètre global restent disponibles. La fiche bilan arrive au lot L7."));
    page.append(bouton('Passer en ACR', 'bouton bouton-accent bouton-plein', () => { this.panneau = null; this.intervention.choisirAcr(); }, { id: 'passer-acr' }));
    this.zone.contenu.replaceChildren(page);
  }

  afficherAcr() {
    const i = this.intervention;
    const ecran = creer('section', 'ecran-acr');
    ecran.setAttribute('aria-label', i.protocole.titre_court ?? 'ACR');

    // zone « cycle » : apparaît au premier toucher d'une tuile vitale ; les tuiles restent en place
    const cycle = creer('div', 'zone-cycle', '', { id: 'zone-cycle' });
    cycle.hidden = !i.tuileTouchee;
    cycle.append(creer('p', 'cycle-decompte', '--:--', { id: 'cycle-decompte' }));
    cycle.append(creer('p', 'cycle-statut', '', { id: 'cycle-statut' }));
    if (i.chronoCycle) {
      const note = i.chronoCycle.note;
      if (note) cycle.append(creer('p', 'cycle-note', `${note}${i.chronoCycle.noteProvisoire ? ` — ${MARQUE_PROVISOIRE}` : ''}`, { id: 'cycle-note' }));
      cycle.append(bouton(i.libelleRelance, 'bouton bouton-accent bouton-plein bouton-relance', () => i.relancerCycle(), { id: 'relance-cycle' }));
    }
    const evenements = creer('div', 'evenements', '', { id: 'evenements' });
    for (const ev of i.evenements) {
      const b = bouton('', 'bouton', () => { i.noterEvenement(ev.id); }, { 'data-evenement': ev.id });
      b.append(creer('span', null, ev.libelle), creer('span', 'compte', ` (${i.compteEvenement(ev.id)})`));
      evenements.append(b);
    }
    cycle.append(evenements);
    cycle.append(creer('div', 'rappels', '', { id: 'rappels' }));
    ecran.append(cycle);

    // tuiles vitales : les étapes `premier_ecran` DANS L'ORDRE DU PROTOCOLE
    const tuiles = creer('div', 'tuiles');
    for (const e of i.etapesPremierEcran()) {
      const cochee = i.estCochee(e.id);
      const t = bouton('', 'bouton tuile', () => this.toucherTuile(e.id), { 'data-etape': e.id, 'aria-pressed': String(cochee) });
      t.append(creer('span', 'tuile-etat', cochee ? '✓' : '○', { 'aria-hidden': 'true' }), creer('span', 'tuile-texte', e.texte_court));
      if (cochee) t.append(creer('span', 'tuile-fait', ` fait à T+${formaterDuree((i.fiche.checklist[e.id].coche_le - i.fiche.journal[0].t))}`));
      tuiles.append(t);
    }
    ecran.append(tuiles);
    this.zone.contenu.replaceChildren(ecran);
    this.majZoneCycle();
  }

  toucherTuile(id) {
    const r = this.intervention.toucherTuile(id);
    if (r.ouvrirAlerte) this.ouvrirPanneau('alerte');
    else this.rendre();
  }

  /** Décompte du cycle, statut en TEXTE + pictogramme (jamais la couleur seule), rappels échus. */
  majZoneCycle() {
    const i = this.intervention;
    const zone = document.getElementById('zone-cycle');
    if (!zone || !i.gestion) return;
    zone.hidden = !i.tuileTouchee && !i.gestion.trouver(i.chronoCycle?.id);
    const c = i.chronoCycle;
    if (c) {
      const l = i.gestion.trouver(c.id) ? i.gestion.lire(c.id) : null;
      document.getElementById('cycle-decompte').textContent = l ? (l.restantMs >= 0 ? formaterDuree(l.restantMs) : `+${formaterDuree(l.depassementMs)}`) : '--:--';
      const libelle = { en_cours: '▶ en cours', proche: '⚠ échéance proche', echeance: '⏰ échéance', arrete: '■ arrêté' };
      document.getElementById('cycle-statut').textContent = l ? `cycle ${l.cycle} — ${libelle[l.statut]}` : 'cycle non démarré';
    }
    const rappels = document.getElementById('rappels');
    if (rappels) {
      rappels.replaceChildren();
      for (const r of i.rappels) {
        const l = i.gestion.trouver(r.id) ? i.gestion.lire(r.id) : null;
        if (l?.statut !== 'echeance') continue;
        const marque = (r.provisoire || r.noteProvisoire) && !/provisoire/i.test(r.note ?? '') ? ` — ${MARQUE_PROVISOIRE}` : '';
        rappels.append(creer('p', 'rappel', `⏰ ${[r.libelle, r.note].filter(Boolean).join(' — ')}${marque}`));
      }
    }
  }

  // ───────── Menu ─────────

  afficherMenu() {
    const i = this.intervention;
    const page = creer('section', 'menu-intervention');
    page.setAttribute('aria-label', 'Menu');
    const ligne = (libelle, action, id) => page.append(bouton(libelle, 'bouton bouton-plein', action, { id }));
    // « le plus utile d'abord » ; chaque lot n'ajoute que les écrans qu'il livre
    ligne('Nouvelle urgence', () => this.actions.nouvelleUrgence(), 'menu-nouvelle-urgence');
    ligne('Accueil', () => this.actions.accueil(), 'menu-accueil');
    ligne('Changer de situation', () => this.ouvrirPanneau('situation'), 'menu-situation');
    ligne('Tester le son et l\'écran', async () => {
      this.messageTest = 'Test en cours…'; this.rendre();
      const r = await testerSonEtEcran({ son: this.son, ecran: this.ecran });
      this.messageTest = `Son : ${r.son.contexte} (canal ${r.son.canal}) · Écran : ${r.ecran.accorde ? 'verrou accordé' : 'verrou non accordé'} · Stockage persistant : ${r.persistance.persistant === null ? 'inconnu' : r.persistance.persistant ? 'oui' : 'non'}. Sur iPhone, l'alerte ne vibre pas : gardez l'écran en vue.`;
      this.rendre();
    }, 'menu-tester');
    if (this.messageTest) page.append(creer('p', 'plan-aide', this.messageTest, { role: 'status' }));
    const terminer = bouton("Terminer l'intervention", 'bouton bouton-plein', () => {
      terminer.replaceWith(bouton("Confirmer : terminer l'intervention", 'bouton bouton-urgence bouton-plein', () => { i.terminer(); this.actions.terminee(); }, { id: 'menu-terminer-confirme' }));
    }, { id: 'menu-terminer' });
    page.append(terminer);
    this.zone.contenu.replaceChildren(page);
  }
}
