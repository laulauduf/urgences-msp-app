// Interface d'une intervention : en-tête fixe, barre du bas, bandeaux, et l'écran courant (choix de situation, écran ACR, panneau d'alerte,
// lieu, menu, secours). Cahier des charges 4.0 à 4.3 bis, 4.7, 4.11, 5.1 à 5.3.
// RÈGLES : rien ne recouvre l'en-tête, la barre du bas ni les tuiles vitales ; aucun bouton n'attend le stockage ; la barre n'affiche que les
// écrans DÉJÀ LIVRÉS (aucun lien vers un écran pas encore écrit) ; aucun ordre ni texte médical en dur — tout vient du protocole.
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
import { testerSonEtEcran, phraseDuTest } from '../test-appareil.js';
import { afficherRoles } from './roles.js';
import { afficherProfession } from './profession.js';
import { afficherChecklist, etatChecklistInitial } from './checklist.js';
import { afficherGlossaire } from './glossaire.js';
import { afficherFiche } from './fiche.js';
import { afficherTransmission } from './transmission.js';
import { afficherJournal } from './journal.js';
import { afficherCloture } from './cloture.js';
import { afficherMateriel } from './materiel.js';
import { afficherAPropos } from './a-propos.js';
import { construireMateriel } from '../materiel.js';
import { construireTransmission } from '../bilan.js';
import { texteBandeau, texteBandeauCourt } from '../roles.js';
import { ACR, AUTRE } from '../intervention.js';

/** Boutons de la barre du bas. Chaque lot ajoute les siens : `disponible` passe à vrai quand son écran est livré (L6 : checklist, L7 : fiche). */
export const BARRE = [
  { id: 'acr', libelle: 'ACR', disponible: true },
  { id: 'alerter', libelle: 'ALERTER', disponible: true },
  { id: 'checklist', libelle: 'CHECKLIST', disponible: true },    // lot L6 (visible seulement dans une fiche ACR : voir majBarre)
  { id: 'transmission', libelle: 'TRANSM.', disponible: true, nom: 'Transmission' }, // lot L7 : à la place de CHECKLIST hors d'une fiche ACR (4.0)
  { id: 'fiche', libelle: 'FICHE', disponible: true },             // lot L7
  { id: 'menu', libelle: '⋯', disponible: true, nom: 'Menu' },
];

export class InterfaceIntervention {
  /**
   * @param {{racine?: Document, intervention: object, son: object, ecran: object, numeros: object, structure: () => object|null,
   *          actions: {accueil: () => void, nouvelleUrgence: () => void, urgenceReelle: () => void, terminee: () => void}}} options
   */
  constructor({ intervention, son, ecran, numeros, structure, groupes = () => [], actions }) {
    Object.assign(this, { intervention, son, ecran, numerosFn: numeros, structureFn: structure, groupesFn: groupes, actions });
    this.panneau = null;            // null | 'alerte' | 'lieu' | 'menu' | 'situation' | 'roles' | 'profession' | 'checklist' | 'glossaire'
    this.repriseRepliee = false; this.versionVue = false;   // bandeaux « Fiche reprise » (replié au premier toucher) et « Appli mise à jour » (acquitté)
    this.retourA = null;            // écran d'où l'on vient (null = l'écran principal) : « Fermer » y revient — aujourd'hui seulement la checklist
    this.fb = { ajout: null };                 // fiche bilan : formulaire d'ajout ouvert
    this.tr = { page: 0, edition: false };     // mode transmission : page courante, saisie E / D ouverte
    this.jr = { corrige: null, texte: '', erreur: null };   // journal : entrée en cours de correction
    this.cloture = null;                       // écran « Clôture et export » (L8) : il a son propre état et se redessine lui-même
    this.cl = etatChecklistInitial();   // étapes dépliées, saisie de l'heure : survit au redessin de la checklist
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
    // pendant la saisie du lieu, un changement ne doit PAS reconstruire le formulaire (on perdrait la saisie en cours)
    if (e.type === 'changement' && !['lieu', 'roles', 'profession', 'fiche', 'transmission', 'journal', 'cloture', 'apropos'].includes(this.panneau)) this.rendre();
    // retour d'un appel `tel:` (page revenue au premier plan) : le mode transmission s'ouvre seul (4.7, 2.10)
    // (L7c : seulement si l'appli a été masquée dans les secondes qui ont suivi l'appel — voir Intervention.surveillerDepart)
    if (e.type === 'retour' && this.intervention.appelEnAttente) {
      const parti = this.intervention.appelParti;
      this.intervention.appelEnAttente = false; this.intervention.appelParti = false;
      if (parti) this.ouvrirPanneau('transmission');
    }
    // la checklist dépend de la profession et des habilitations lues : elle se redessine quand l'une ou l'autre arrive ou change
    if ((e.type === 'reglages' || e.type === 'habilitations') && this.panneau === 'checklist') this.rendre();
    if (e.type === 'roles' || e.type === 'reglages') this.majPuceEtRoles();
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
    // puce profession (4.13) : UN toucher ouvre la liste des groupes, UN second choisit ; « Profession non réglée » bien visible
    const place = creer('span', 'place-profession', '', { 'data-place': 'profession' });
    place.append(bouton('', 'bouton puce', () => this.ouvrirPanneau('profession'), { id: 'puce-profession' }));
    entete.append(place);
    // bandeau des rôles (4.4) : une ligne, touchable ; replié en pictogramme court quand la place manque (paysage, texte agrandi)
    const roles = bouton('', 'bouton bandeau-roles', () => this.ouvrirPanneau('roles'), { id: 'bandeau-roles' });
    roles.append(creer('span', 'roles-long', ''), creer('span', 'roles-court', ''));
    entete.append(roles);
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
    this.majPuceEtRoles();
    const av = document.getElementById('avertissement-son');
    if (av) av.textContent = this.son.etat().avertissement;
    this.majZoneCycle();
  }

  /** Puce profession (libellé du groupe, ou « Profession non réglée ») et bandeau des rôles. */
  majPuceEtRoles() {
    const i = this.intervention;
    const puce = document.getElementById('puce-profession');
    if (puce) {
      const groupe = this.groupesFn().find((g) => g.id === i.profession);
      // « non reconnue » : réglée sur un groupe qui n'existe plus dans les données → le groupe le plus restreint s'applique, et la puce le dit (revue L6 m7)
      const regle = i.profession !== null && i.professionReconnue;
      const nom = i.profession === null ? 'Profession non réglée' : i.professionReconnue ? (groupe ? groupe.libelle : i.profession) : 'Profession non reconnue';
      puce.textContent = `${nom} ▾`;
      puce.dataset.regle = regle ? 'oui' : 'non';
      puce.setAttribute('aria-label', regle ? `Profession : ${nom}. Changer` : `${nom}. Choisir`);
    }
    const bandeau = document.getElementById('bandeau-roles');
    if (bandeau) {
      bandeau.querySelector('.roles-long').textContent = texteBandeau(i.roles);
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
    poser('ecran', this.ecran.etat().avertissement);
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
    if (id === 'checklist' || id === 'fiche' || id === 'transmission') { this.ouvrirPanneau(id); return; }
    if (id === 'acr') {
      this.versPrincipal();
      if (i.situation !== ACR) i.choisirAcr(); // « Autre situation » → ACR en UN toucher (journalisé, la fiche est conservée)
      else this.rendre();
    }
  }

  /**
   * Ouvre un écran. `null` = « fermer » : retour à l'écran d'où l'on vient (la checklist si l'on en venait), sinon l'écran principal.
   * Seule la checklist se rouvre ainsi : on ne perd pas sa place pour un appel, un rôle, une profession ou le glossaire.
   */
  ouvrirPanneau(nom) {
    const PRINCIPAUX = ['checklist', 'fiche', 'transmission'];
    if (nom === null) { nom = this.retourA; this.retourA = null; }
    else if (PRINCIPAUX.includes(nom)) { if (!['menu', 'alerte'].includes(this.panneau)) this.retourA = null; }   // depuis le menu ou l'alerte, on garde l'écran d'origine
    else if (PRINCIPAUX.includes(this.panneau)) this.retourA = this.panneau;
    this.panneau = nom; this.messageTest = null; this.rendre();
  }

  /** Retour à l'écran principal (ACR, choix de situation…) sans aucun écran de retour en mémoire. */
  versPrincipal() { this.panneau = null; this.retourA = null; }

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
    const cle = this.panneau ?? 'principal';
    if (cle !== this.cleEcran) { this.zone.contenu.scrollTop = 0; this.cleEcran = cle; }
  }

  dessiner() {
    const i = this.intervention;
    const { contenu } = this.zone;
    this.secours?.arreter(); this.secours = null;
    document.body.dataset.panneau = this.panneau ?? '';   // l'en-tête se compacte pendant l'appel (app.css, L9c étape 2, M4)
    this.majBandeauxFixes();
    this.majBandeauxSon();
    if (this.panneau === 'checklist' && i.situation !== ACR) this.versPrincipal();   // pas de checklist hors d'une fiche ACR
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
    } else if (this.panneau === 'checklist') {
      if (i.protocoleEtat === 'ok') afficherChecklist(contenu, { intervention: i, etat: this.cl, auAlerte: () => this.ouvrirPanneau('alerte'), auRendre: () => this.rendre() });
      else contenu.replaceChildren(creer('p', 'page', i.protocoleEtat === 'secours' ? 'Checklist indisponible : le protocole est illisible. Masser, alerter, DAE : voir l\'écran ACR.' : 'Chargement du protocole…', { role: 'status' }));
    } else if (this.panneau === 'glossaire') {
      afficherGlossaire(contenu, { glossaire: i.glossaire, auFermer: () => this.ouvrirPanneau(null) });
    } else if (this.panneau === 'alerte') {
      afficherAlerte(contenu, { intervention: i, numeros: this.numerosFn(), structure: this.structure, auFermer: () => this.ouvrirPanneau(null), auLieu: () => this.ouvrirPanneau('lieu'), auTransmission: () => this.ouvrirPanneau('transmission') });
    } else if (this.panneau === 'lieu') {
      afficherLieu(contenu, { intervention: i, structure: this.structure, auRetour: () => this.ouvrirPanneau('alerte') });
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
    const i = this.intervention;
    const acr = document.getElementById('barre-acr');
    if (acr) acr.setAttribute('aria-current', this.panneau === null && i.situation === ACR ? 'page' : 'false');
    // CHECKLIST : seulement dans une fiche ACR (ailleurs, cet emplacement deviendra TRANSMISSION au lot L7, 4.0)
    const transmission = document.getElementById('barre-transmission');
    if (transmission) {
      transmission.hidden = i.situation === ACR;   // dans une fiche ACR, la transmission est dans le panneau d'alerte et le menu (4.0)
      transmission.setAttribute('aria-current', this.panneau === 'transmission' ? 'page' : 'false');
    }
    const fiche = document.getElementById('barre-fiche');
    if (fiche) fiche.setAttribute('aria-current', this.panneau === 'fiche' ? 'page' : 'false');
    const checklist = document.getElementById('barre-checklist');
    if (checklist) {
      checklist.hidden = i.situation !== ACR;
      checklist.setAttribute('aria-current', this.panneau === 'checklist' ? 'page' : 'false');
    }
  }

  afficherChoix() {
    const i = this.intervention;
    const page = creer('section', 'choix-situation');
    page.setAttribute('aria-label', 'Situation');
    // (rendre() explicite : si la situation est déjà celle-là — menu « Changer de situation » — aucun événement ne la réaffiche)
    page.append(bouton('ACR adulte', 'bouton bouton-accent bouton-tres-grand bouton-plein', async () => { this.versPrincipal(); const p = i.choisirAcr(); this.rendre(); await p; this.rendre(); }, { id: 'choix-acr' }));
    page.append(bouton('Autre situation', 'bouton bouton-plein', () => { this.versPrincipal(); i.choisirAutre(); this.rendre(); }, { id: 'choix-autre' }));
    // « Annuler (démarrage par erreur) » : seulement sur CET écran, tant que la fiche ne contient rien d'autre que l'entrée « urgence »
    if (i.annulable) page.append(bouton('Annuler (démarrage par erreur)', 'bouton', async () => { await i.annulerDemarrage(); this.actions.accueil({ dejaDetruite: true }); }, { id: 'annuler-demarrage' }));
    this.zone.contenu.replaceChildren(page);
  }

  afficherAutre() {
    const page = creer('section', 'page');
    page.append(creer('h1', null, 'Autre situation'));
    page.append(creer('p', null, "L'alerte, le chronomètre global, la fiche bilan et le mode transmission restent disponibles."));
    page.append(bouton('Passer en ACR', 'bouton bouton-accent bouton-plein', () => { this.versPrincipal(); this.intervention.choisirAcr(); }, { id: 'passer-acr' }));
    this.zone.contenu.replaceChildren(page);
  }

  afficherAcr() {
    const i = this.intervention;
    const ecran = creer('section', 'ecran-acr');
    ecran.setAttribute('aria-label', i.protocole.titre_court ?? 'ACR');

    // zone « cycle » : apparaît au premier toucher d'une tuile vitale ; les tuiles restent en place
    const cycle = creer('div', 'zone-cycle', '', { id: 'zone-cycle' });
    cycle.hidden = !i.tuileTouchee;
    // « haut » = décompte, statut, note et bouton de relance : en portrait il est transparent (display: contents) ; en paysage il reste collé en haut de la zone
    // centrale quand on fait défiler les tuiles (app.css, L9c étape 2, M1 paysage) ; les événements et les rappels, eux, défilent.
    const haut = creer('div', 'cycle-haut');
    haut.append(creer('p', 'cycle-decompte', '--:--', { id: 'cycle-decompte' }));
    haut.append(creer('p', 'cycle-statut', '', { id: 'cycle-statut' }));
    if (i.chronoCycle) {
      const note = i.chronoCycle.note;
      if (note) haut.append(creer('p', 'cycle-note', `${note}${suffixeMarques(i.chronoCycle, { note })}`, { id: 'cycle-note' }));
      haut.append(bouton(i.libelleRelance, 'bouton bouton-accent bouton-plein bouton-relance', () => i.relancerCycle(), { id: 'relance-cycle' }));
    }
    cycle.append(haut);
    const evenements = creer('div', 'evenements', '', { id: 'evenements' });
    for (const ev of i.evenements) {
      const b = bouton('', 'bouton', () => { i.noterEvenement(ev.id); }, { 'data-evenement': ev.id });
      b.append(creer('span', null, ev.libelle), creer('span', 'compte', ` (${i.compteEvenement(ev.id)})`));
      if (ev.statut === 'A_VALIDER') b.append(creer('span', 'marque', MARQUE_A_VALIDER));   // revue m6 : le contenu non établi se voit partout où il s'affiche
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
      if (typeof e.provisoire === 'string') t.append(creer('span', 'marque', MARQUE_PROVISOIRE)); // choix provisoire : marque visible, jamais attribué au médecin référent (R15)
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
        rappels.append(creer('p', 'rappel', `⏰ ${[r.libelle, r.note].filter(Boolean).join(' — ')}${suffixeMarques(r)}`));
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
    ligne('Mode transmission', () => this.ouvrirPanneau('transmission'), 'menu-transmission');
    ligne('Nouvelle urgence', () => this.actions.nouvelleUrgence(), 'menu-nouvelle-urgence');
    ligne('Accueil', () => this.actions.accueil(), 'menu-accueil');
    ligne('Changer de situation', () => this.ouvrirPanneau('situation'), 'menu-situation');
    ligne('Journal', () => this.ouvrirPanneau('journal'), 'menu-journal');
    ligne('Matériel du protocole', () => this.ouvrirPanneau('materiel'), 'menu-materiel');
    ligne('Glossaire', () => this.ouvrirPanneau('glossaire'), 'menu-glossaire');
    ligne('Tester le son et l\'écran', async () => {
      this.messageTest = 'Test en cours…'; this.rendre();
      const r = await testerSonEtEcran({ son: this.son, ecran: this.ecran });
      this.messageTest = phraseDuTest(r);
      this.actions.testeFait?.(r);   // M5 : le résultat alimente aussi la ligne d'état de l'accueil
      this.rendre();
    }, 'menu-tester');
    if (this.messageTest) page.append(creer('p', 'plan-aide', this.messageTest, { role: 'status' }));
    const terminer = bouton("Terminer l'intervention", 'bouton bouton-plein', () => {
      terminer.replaceWith(bouton("Confirmer : terminer l'intervention", 'bouton bouton-urgence bouton-plein', () => { i.terminer(); this.actions.terminee(); }, { id: 'menu-terminer-confirme' }));
    }, { id: 'menu-terminer' });
    page.append(terminer);
    ligne('Clôture et export', () => this.ouvrirPanneau('cloture'), 'menu-cloture');   // fonction 25 de 4.0 : exporter, clôturer
    // hors du tableau des deux touchers (le bandeau des rôles les ouvre en un toucher ; « À propos » est une exception assumée) : en dernier, ils peuvent défiler
    ligne('Rôles', () => this.ouvrirPanneau('roles'), 'menu-roles');
    ligne('À propos', () => this.ouvrirPanneau('apropos'), 'menu-apropos');
    this.zone.contenu.replaceChildren(page);
  }
}
