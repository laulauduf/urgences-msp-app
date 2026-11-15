// Une intervention en cours : fiche active, protocole, chronomètres, métronome, appels (cahier des charges 2.4, 2.7, 2.8, 4.0 à 4.3 bis, 4.7, 4.11).
// Ce module ne touche pas au DOM : les écrans (app/js/ecrans/) le lisent et l'écoutent. Règle de fond : ON AFFICHE D'ABORD, ON ÉCRIT ENSUITE —
// aucune de ces méthodes n'attend le stockage ; la fiche vit en mémoire (stockage.js l'écrit en parallèle, ou la garde en mémoire en mode dégradé).
// Aucune valeur médicale ici : étapes, ordre, durées, fréquence et libellés viennent du protocole ; aucun ordre n'est écrit en dur.
import { Horloge, GestionChronos, lireChronometres, lireMetronome, formaterDuree } from './horloge.js';
import { attribuerRole, appelant, ajouterPersonne } from './roles.js';
import { construireVue, heureVersTimestamp, estVitale } from './checklist.js';
import { chargerHabilitations } from './habilitations.js';
import { chargerGlossaire, lireGlossaire } from './glossaire.js';
import { TYPES_CONSTANTE } from './bilan.js';

export const ACR = 'acr';
export const AUTRE = 'autre';

/** Entrées que l'appli écrit TOUTE SEULE (case « Alerter » cochée par l'appel, chronomètres, échéances, version, horloge) : elles ne comptent pas comme une action de l'équipe. */
const ENTREES_AUTOMATIQUES = ['case', 'chronometre', 'echeance', 'rattrapage', 'version_differente', 'horloge_modifiee'];

/**
 * Le journal se termine-t-il par un appel lancé il y a moins de 30 minutes ? (retour d'un appel `tel:` avec rechargement de la page, 4.7, 2.10)
 * L7c (revue L7, M1) : la case « Alerter » est écrite APRÈS l'appel au premier appel ; on saute donc les entrées automatiques et on regarde la dernière
 * entrée « humaine ». Une action de l'équipe après l'appel, ou une reprise déjà faite, ferme la porte : on n'ouvre pas la transmission à chaque rechargement.
 */
export function retourDAppelAttendu(journal, maintenant = Date.now()) {
  for (let i = (journal?.length ?? 0) - 1; i >= 0; i--) {
    const e = journal[i];
    if (ENTREES_AUTOMATIQUES.includes(e.type)) continue;
    return e.type === 'appel_lance' && maintenant - e.t < 30 * 60 * 1000;
  }
  return false;
}

export class Intervention {
  /**
   * @param {{stockage: object, son: object, ecran: object, chargerProtocole: (id: string) => Promise<object>, protocoleId: string, numeros?: object,
   *          chargerHabilitations?: () => Promise<object|null>, chargerGlossaire?: () => Promise<object>}} options
   *   `chargerProtocole` renvoie { ok, protocole } ou { ok: false, raisons } (protocole.js).
   */
  constructor({ stockage, son, ecran, chargerProtocole, protocoleId, chargerHabilitations: chargerHab = chargerHabilitations, chargerGlossaire: chargerGlo = chargerGlossaire }) {
    Object.assign(this, { stockage, son, ecran, chargerProtocoleFn: chargerProtocole, protocoleId, chargerHabilitationsFn: chargerHab, chargerGlossaireFn: chargerGlo });
    // checklist (L6) : habilitations par profession (null tant que non lues ou illisibles : tout est alors restrictif), glossaire, mode et étapes passées
    this.habilitations = null; this.habilitationsEtat = 'chargement'; this.glossaire = lireGlossaire(null);
    this.modeChecklist = 'expert'; this.modeChoisi = false; this.passees = new Set();
    this.fiche = null; this.mode = 'reel';
    this.protocole = null; this.protocoleEtat = null; this.raisons = [];   // protocoleEtat : null | 'chargement' | 'ok' | 'secours'
    this.situation = null;                                                 // null (choix en cours) | ACR | AUTRE
    this.definitions = []; this.metronome = null; this.gestion = null; this.horloge = null;
    this.auditeurs = new Set(); this.debranchements = []; this.prefetch = null; this.dernierGlobal = 0;
    this.repriseDe = null; this.versionDifferente = null; this.champsSensibles = {}; this.appelEnAttente = false; this.appelParti = false; this.transmissionAuRetour = false; this.detruite = false; this.tuileTouchee = false;
    this.profession = null; this.personnes = [];   // réglages de l'appareil (L3), chargés au démarrage : profession courante, personnes connues
  }

  // ───────── Événements ─────────
  ecouter(f) { this.auditeurs.add(f); return () => this.auditeurs.delete(f); }
  emettre(type, detail = {}) { for (const f of this.auditeurs) { try { f({ type, ...detail }); } catch { /* un écran fautif ne casse pas l'intervention */ } } }

  // ───────── Démarrage ─────────

  get simulation() { return this.mode === 'simulation'; }

  journaliser(type, donnees = {}, options = {}) { return this.stockage.journaliser(this.fiche, type, donnees, options); }
  ecrire() { this.stockage.modifier(this.fiche, () => {}, { immediat: true }); }

  initialiserTemps() {
    this.horloge = new Horloge({ visible: () => document.visibilityState !== 'hidden', journaliser: (t, d) => this.journaliser(t, d) });
    this.debranchements.push(this.horloge.brancher(document, window, { apresRetour: () => { this.gestion?.rattraper(); this.emettre('retour'); } }));
  }

  /**
   * Toucher URGENCE. SYNCHRONE : la fiche est créée en mémoire, le son et le verrou d'écran sont demandés dans le geste (sans attendre
   * leur réponse), le protocole est préchargé en parallèle ; l'écran de choix peut s'afficher à l'instant. L'écriture suit, en parallèle.
   */
  demarrer(mode) {
    this.mode = mode;
    this.fiche = this.stockage.nouvelleFiche(mode);
    this.stockage.definirAffichee(this.fiche.id);
    this.initialiserTemps();
    this.son.debloquer();
    this.ecran.demander(); // jamais attendu
    this.prefetch = this.chargerProtocoleFn(this.protocoleId);
    this.chargerReglages();
    this.chargerReferences();
    return this.fiche;
  }

  /** Reprise d'une fiche déjà en base (directe au lancement, ou depuis l'accueil). Le protocole est celui COPIÉ dans la fiche (2.4, parade 2). */
  async reprendre(fiche, { automatique = false } = {}) {
    // retour d'un appel `tel:` avec rechargement (iPhone) : calculé AVANT toute écriture de la reprise (L7c, revue L7 M1 : la version et la reprise s'écrivent au journal)
    const retourAppel = retourDAppelAttendu(fiche.journal, Date.now());
    this.chargerReglages();
    this.chargerReferences();
    this.fiche = fiche; this.mode = fiche.mode; this.repriseDe = { automatique, debut: fiche.journal[0]?.t ?? fiche.cree_le };
    this.stockage.definirAffichee(fiche.id);
    this.initialiserTemps();
    this.son.preparer?.();   // M1 : contexte audio créé (suspendu) pour que le bandeau « Son arrêté » s'affiche ; le premier toucher le reprend
    this.ecran.demander().catch?.(() => {});
    const derniere = fiche.situations.at(-1);
    this.situation = derniere ? (derniere.protocole === this.protocoleId ? ACR : AUTRE) : null;
    if (this.situation === ACR) {
      const copie = fiche.protocoles_utilises?.[this.protocoleId];
      const { verifierProtocole } = await import('./protocole.js');
      if (copie && verifierProtocole(copie).length === 0) this.adopterProtocole(copie, { journaliserSituation: false });
      else { // pas de copie exploitable : on retombe sur le fichier courant, ou sur l'écran de secours
        this.protocoleEtat = 'chargement'; this.emettre('changement');
        const r = await this.chargerProtocoleFn(this.protocoleId);
        if (r.ok) this.adopterProtocole(r.protocole, { journaliserSituation: false });
        else this.basculerSecours(r.raisons);
      }
    }
    this.tuileTouchee = this.etapesPremierEcran().some((e) => this.estCochee(e.id)) || fiche.chronometres.length > 0;
    // Parade 3 (2.4, revue M2) : une version du code peut s'être activée entre-temps (un service worker en attente s'active seul quand plus aucune page
    // n'est ouverte : le navigateur l'impose). On le DIT (bandeau + journal), une seule fois : la fiche prend alors la version courante.
    const courante = globalThis.URGENCES_VERSION;
    const de = fiche.version_appli;
    if (typeof de === 'string' && typeof courante === 'string' && de !== courante && de !== '?' && courante !== '?') {
      this.versionDifferente = { de, vers: courante };
      this.stockage.modifier(fiche, (f) => { f.version_appli = courante; }, { immediat: true });
      this.journaliser('version_differente', { de, vers: courante });
    }
    if (retourAppel) this.transmissionAuRetour = true;   // le mode transmission s'ouvre (4.7, 2.10)
    this.journaliser('reprise', { automatique });
    this.gestion?.rattraper();
    this.emettre('changement');
  }

  adopterProtocole(protocole, { journaliserSituation = true } = {}) {
    this.protocole = protocole; this.protocoleEtat = 'ok'; this.raisons = [];
    this.definitions = lireChronometres(protocole);
    this.metronome = lireMetronome(protocole);
    this.gestion = new GestionChronos({
      horloge: this.horloge, chronometres: this.fiche.chronometres, definitions: this.definitions,
      journaliser: (t, d) => this.journaliser(t, d), ecrire: () => this.ecrire(),
      onEcheance: (e) => this.surEcheance(e), onRattrapage: (e) => this.surRattrapage(e),
    });
    if (journaliserSituation) {
      this.stockage.modifier(this.fiche, (f) => {
        f.protocoles_utilises[protocole.id] = structuredClone(protocole);   // copie : un protocole mis à jour ne change jamais une intervention en cours
        f.versions_protocoles[protocole.id] = protocole.version;
        f.situations.push({ protocole: protocole.id, depuis: Date.now() });
      }, { immediat: true });
      this.journaliser('situation', { protocole: protocole.id, version: protocole.version });
    }
  }

  basculerSecours(raisons) {
    this.protocoleEtat = 'secours'; this.raisons = raisons;
    this.journaliser('secours_protocole', { raisons });
  }

  // ───────── Choix et changement de situation ─────────

  /** ACR adulte (ou passage en ACR depuis « autre situation », un toucher). Affiche tout de suite ; le protocole arrive en parallèle. */
  async choisirAcr() {
    if (this.situation === ACR && this.protocoleEtat !== 'secours') return;
    this.situation = ACR; this.protocoleEtat = 'chargement'; this.emettre('changement');
    this.prefetch ??= this.chargerProtocoleFn(this.protocoleId);
    const r = await this.prefetch;
    if (this.detruite) return;
    if (r.ok) this.adopterProtocole(r.protocole);
    else {
      this.prefetch = null; // on réessaiera au prochain essai
      if (!this.fiche.situations.some((s) => s.protocole === this.protocoleId)) {
        this.stockage.modifier(this.fiche, (f) => { f.situations.push({ protocole: this.protocoleId, depuis: Date.now(), secours: true }); });
        this.journaliser('situation', { protocole: this.protocoleId, secours: true });
      }
      this.basculerSecours(r.raisons);
    }
    this.emettre('changement');
  }

  /** « Autre situation » : alerte et chronomètre global, sans checklist. */
  choisirAutre() {
    this.situation = AUTRE;
    this.stockage.modifier(this.fiche, (f) => { f.situations.push({ protocole: null, depuis: Date.now() }); }, { immediat: true });
    this.journaliser('situation', { protocole: null, libelle: 'autre situation' });
    this.emettre('changement');
  }

  /** Le bouton « Annuler (démarrage par erreur) » n'existe que tant que la fiche ne contient rien d'autre que l'entrée `urgence` (4.1). */
  get annulable() {
    const f = this.fiche;
    return Boolean(f) && this.situation === null && f.journal.length === 1 && f.roles.length === 0 && Object.keys(f.checklist).length === 0 && f.situations.length === 0;
  }

  async annulerDemarrage() {
    if (!this.annulable) return false;
    const id = this.fiche.id; const mode = this.mode;
    this.detruire();
    return (await this.stockage.effacerFiche(mode, id)).ok;
  }

  // ───────── Premier écran ACR ─────────

  /** Étapes du premier écran, dans l'ORDRE DU PROTOCOLE (jamais d'ordre écrit en dur ici : D-6 attend une précision de Laurent). */
  etapesPremierEcran() {
    return (this.protocole?.etapes ?? []).filter((e) => e.premier_ecran === true).sort((a, b) => a.ordre - b.ordre);
  }
  etape(id) { return this.protocole?.etapes.find((e) => e.id === id) ?? null; }
  /** L'étape dont la case se coche au premier appel (cochage_auto: « appel ») : celle du bouton « Alerter ». */
  etapeAlerte() { return this.etapesPremierEcran().find((e) => e.cochage_auto === 'appel') ?? null; }
  estCochee(id) { return Boolean(this.fiche.checklist[id]); }

  cocher(id, { t = Date.now() } = {}) {
    if (this.estCochee(id)) return false;
    this.stockage.modifier(this.fiche, (f) => { f.checklist[id] = { coche_le: t }; }, { immediat: true });
    const e = this.etape(id);
    this.journaliser('case', { id, libelle: e?.texte_court ?? id }, { maintenant: t });
    this.emettre('changement');
    return true;
  }

  // ───────── Checklist (L6, cahier 4.5) ─────────

  /** Habilitations par profession et glossaire : lus sans jamais retarder un écran ; tant que les habilitations manquent, tout est restrictif. */
  async chargerReferences() {
    const [habilitations, glossaire] = await Promise.all([this.chargerHabilitationsFn(), this.chargerGlossaireFn()]);
    if (this.detruite) return;
    this.habilitations = habilitations ?? null; this.habilitationsEtat = habilitations ? 'ok' : 'absent'; this.glossaire = glossaire ?? lireGlossaire(null);
    this.emettre('habilitations');
  }

  /** Vue de la checklist : le protocole, la fiche (mêmes cases que les tuiles) et la profession courante, filtrés par les habilitations. */
  get vueChecklist() {
    return construireVue({ etapes: this.protocole?.etapes ?? [], checklist: this.fiche.checklist, journal: this.fiche.journal, habilitations: this.habilitations, profession: this.profession });
  }

  /** Bascule expert / guidé pour CETTE intervention ; le réglage par défaut (Réglages) ne change pas. */
  definirModeChecklist(mode) {
    if (!['expert', 'guide'].includes(mode) || mode === this.modeChecklist) return false;
    this.modeChecklist = mode; this.modeChoisi = true;
    return true;
  }

  /**
   * Toucher de la case d'une étape dans la checklist. Même objet que les tuiles : `fiche.checklist[id]`.
   * - étape cochée : décochée (journalisée) ; - étape non cochable pour cette profession : refusée (jamais cochée) ;
   * - étape vitale : même chemin que sa tuile (déclencheur du protocole, alerte au premier appel) ; - « Alerter » : ouvre l'alerte, ne coche pas.
   * @returns {{ouvrirAlerte: boolean, refuse?: boolean}}
   */
  cocherDepuisChecklist(id) {
    const item = this.vueChecklist.parId.get(id);
    if (!item) return { ouvrirAlerte: false, refuse: true };
    // décocher est toujours permis, même si un changement de profession a rendu l'étape non cochable : décocher n'est pas autoriser (revue L6 m5)
    if (item.cochee) { this.decocher(id); return { ouvrirAlerte: false }; }
    if (!item.cochable) return { ouvrirAlerte: false, refuse: true };
    const e = item.etape;
    this.passees.delete(id);
    if (estVitale(e)) return this.toucherTuile(id, { prudent: true });   // une seule définition d'« étape vitale » (revue L6 m10)
    if (e.cochage_auto === 'appel') { this.emettre('changement'); return { ouvrirAlerte: true }; }
    if (this.cocher(id)) this.declencher(e, { prudent: true });
    return { ouvrirAlerte: false };
  }

  /** Décoche une étape : la case sort de la fiche ; le journal garde les deux entrées (la seconde marquée `decochee`). */
  decocher(id) {
    if (!this.estCochee(id)) return false;
    this.stockage.modifier(this.fiche, (f) => { delete f.checklist[id]; }, { immediat: true });
    this.journaliser('case', { id, libelle: this.etape(id)?.texte_court ?? id, decochee: true });
    this.emettre('changement');
    return true;
  }

  /**
   * « Noter : fait à hh:mm » (Q-31, PROVISOIRE) : pour une action que ce profil ne peut pas cocher. Crée une entrée `geste` au journal, à l'heure
   * saisie (l'occurrence la plus récente, jamais dans le futur), SANS cocher la case : noter un geste fait n'est pas l'autoriser.
   * @returns {{ok: boolean, raison?: string}}
   */
  noterGeste(id, heure) {
    const item = this.vueChecklist.parId.get(id);
    if (!item || !item.restreint) return { ok: false, raison: "cette étape ne se note pas" };
    const t = heureVersTimestamp(heure);
    if (t === null) return { ok: false, raison: 'heure invalide : écrire hh:mm, par exemple 14:32' };
    this.journaliser('geste', { id, libelle: item.etape.texte_court }, { maintenant: t });
    this.passees.delete(id);
    this.ecrire();
    this.emettre('changement');
    return { ok: true };
  }

  /** Mode guidé : « Passer » laisse l'étape non faite (une critique passée est signalée « non faite » dès qu'une suivante est cochée). */
  passerEtape(id) { this.passees.add(id); this.emettre('changement'); }

  /**
   * Toucher d'une tuile vitale. « Alerter » (cochage_auto: appel) n'est PAS coché à l'ouverture du panneau (ouvrir n'est pas alerter) : elle
   * ouvre le panneau et se coche au premier appel lancé ou au premier « J'ai appelé ». Un second toucher ne décoche jamais (toucher maladroit).
   * @returns {{ouvrirAlerte: boolean}}
   */
  toucherTuile(id, { prudent = false } = {}) {
    const e = this.etape(id);
    if (!e) return { ouvrirAlerte: false };
    this.tuileTouchee = true; // la zone « cycle » apparaît dès le premier toucher d'une tuile vitale (4.3 bis)
    if (e.cochage_auto === 'appel') { this.emettre('changement'); return { ouvrirAlerte: true }; }
    // le déclencheur du protocole (métronome, chronomètre) ne part qu'au PREMIER cochage de l'étape dans la fiche : décocher puis recocher ne relance
    // pas un métronome mis en pause (revue L6 M1, second cas)
    const premiere = !this.fiche.journal.some((x) => x.type === 'case' && x.donnees?.id === id);
    const neuve = this.cocher(id);
    if (neuve && premiere) this.declencher(e, { prudent });
    return { ouvrirAlerte: false };
  }

  /**
   * Action technique liée au toucher (`declenche`) : métronome, chronomètre. Seulement au premier toucher de l'étape.
   * `prudent` (cochage depuis la CHECKLIST, revue L6 M1) : cocher une case pour noter n'est pas relancer. Un chronomètre déjà démarré n'est jamais
   * remis à zéro et un métronome déjà démarré (même en pause) n'est jamais redémarré ; la relance du cycle se fait par son bouton, journalisée.
   */
  declencher(etape, { prudent = false } = {}) {
    const d = etape.declenche;
    if (!d || typeof d !== 'object') return;
    if (d.metronome === 'demarrer' && !(prudent && this.son.etat().metronome.frequence !== null)) this.demarrerMetronome();
    if (typeof d.chronometre === 'string') {
      const existant = this.gestion?.trouver(d.chronometre);
      if (!(prudent && existant && existant.etat !== 'arrete')) this.gestion?.demarrer(d.chronometre);
    }
  }

  /** Vrai si la profession réglée est un groupe connu des habilitations (faux : non réglée, ou groupe disparu — le groupe le plus restreint s'applique). */
  get professionReconnue() {
    if (this.profession === null) return false;
    return !(this.habilitationsEtat === 'ok' && !this.habilitations.groupes.includes(this.profession));
  }

  demarrerMetronome() {
    if (!this.metronome) return false;
    if (!this.son.etat().metronome.actif) this.son.demarrerMetronome(this.metronome.frequence);
    this.journaliser('chronometre', { id: 'metronome', action: 'demarrage', frequence: this.metronome.frequence });
    this.emettre('changement');
    return true;
  }

  basculerMetronome() {
    const m = this.son.etat().metronome;
    if (m.actif) this.son.pauseMetronome();
    else if (m.frequence !== null) this.son.reprendreMetronome();
    else this.demarrerMetronome();
    this.emettre('changement');
  }

  // ───────── Cycle et événements ─────────

  /** Chronomètre de cycle : celui qu'une étape du protocole `declenche`, sinon le premier chronomètre manuel avec échéance. */
  get chronoCycle() {
    const declenches = (this.protocole?.etapes ?? []).map((e) => e.declenche?.chronometre).filter(Boolean);
    return this.definitions.find((d) => declenches.includes(d.id) && d.dureeS) ?? this.definitions.find((d) => d.demarrage === 'manuel' && d.dureeS) ?? null;
  }
  /** Libellé du bouton de relance : celui de l'étape du protocole qui déclenche le cycle. */
  get libelleRelance() {
    const c = this.chronoCycle;
    const e = c ? (this.protocole?.etapes ?? []).find((x) => x.declenche?.chronometre === c.id) : null;
    return e?.texte_court ?? c?.libelle ?? 'Relancer le cycle';
  }
  /** Autres chronomètres affichés en rappel (ceux qui démarrent « avec » le cycle : rappel de relève…). */
  get rappels() { return this.definitions.filter((d) => d.avec !== null && d.dureeS); }

  relancerCycle() {
    const c = this.chronoCycle;
    if (!c || !this.gestion) return false;
    this.gestion.demarrer(c.id);
    this.emettre('changement');
    return true;
  }

  get evenements() { return Array.isArray(this.protocole?.evenements) ? this.protocole.evenements : []; }
  compteEvenement(id) { return this.fiche.journal.filter((e) => e.type === 'evenement' && e.donnees?.id === id).length; }
  noterEvenement(id) {
    const ev = this.evenements.find((e) => e.id === id);
    if (!ev) return false;
    this.journaliser('evenement', { id, libelle: ev.libelle });
    this.emettre('changement');
    return true;
  }

  surEcheance({ id, alerte, depassementMs }) {
    if (alerte && alerte !== 'aucune') this.son.jouerAlerte(alerte === 'forte' ? 'forte' : 'discrete');
    this.emettre('echeance', { id, alerte, depassementMs });
  }
  surRattrapage({ franchies }) {
    if (franchies.some((f) => f.alerte && f.alerte !== 'aucune')) this.son.jouerAlerte('discrete'); // UNE seule alerte
    this.emettre('rattrapage', { franchies });
  }

  /** À appeler environ 4 fois par seconde avec l'affichage. */
  tick() { this.gestion?.tick(); }
  tempsGlobalMs() {
    if (!this.fiche || !this.horloge) return 0;
    this.dernierGlobal = Math.max(this.dernierGlobal, this.horloge.maintenant() - (this.fiche.journal[0]?.t ?? this.fiche.cree_le));
    return this.dernierGlobal;
  }
  texteGlobal() { return formaterDuree(this.tempsGlobalMs()); }

  // ───────── Appels (4.7) ─────────

  /** Toucher d'un lien d'appel : horodaté dans le même geste que le lien (l'écriture part avant que la page soit gelée). En simulation : « Appel simulé ». */
  appelLance(numero, moyen = 'tel') {
    const t = Date.now();
    this.journaliser(this.simulation ? 'appel_simule' : 'appel_lance', { numero, moyen }, { maintenant: t });
    if (!this.simulation) { this.appelEnAttente = true; this.appelParti = false; this.surveillerDepart(t); }   // au retour au premier plan, le mode transmission s'ouvre seul (4.7)
    const alerte = this.etapeAlerte();
    if (alerte) this.cocher(alerte.id, { t }); // « Alerter » se coche au premier appel, avec l'heure de l'appel (aucun doublon)
    this.emettre('changement');
  }

  /**
   * L7c (revue L7, mineur 2) : la transmission ne s'ouvre au retour que si l'appli a été MASQUÉE dans les 10 secondes qui suivent l'appel (c'est ce que fait
   * un lien `tel:`). Sans cela, une confirmation d'appel annulée sur iPhone, puis un verrouillage d'écran bien plus tard, ouvriraient la transmission par surprise.
   */
  surveillerDepart(t) {
    let chrono = null;
    const fin = () => { document.removeEventListener('visibilitychange', surCache); clearTimeout(chrono); };
    const surCache = () => { if (document.visibilityState === 'hidden') { this.appelParti = Date.now() - t < 10000; fin(); } };
    document.addEventListener('visibilitychange', surCache);
    chrono = setTimeout(fin, 10000);
    this.debranchements.push(fin);
  }

  /** « J'ai appelé » : appel passé par un équipier, ou confirmé. */
  appelFait() {
    const t = Date.now();
    this.journaliser('appel_fait', {}, { maintenant: t });
    const alerte = this.etapeAlerte();
    if (alerte) this.cocher(alerte.id, { t });
    this.emettre('changement');
  }

  get appelsFaits() { return this.fiche.journal.filter((e) => ['appel_lance', 'appel_simule', 'appel_fait'].includes(e.type)).length; }

  // ───────── Fiche bilan (L7, 4.6) : saisie sans validation bloquante, enregistrée à chaque frappe ─────────

  /** Écrit un champ de la fiche (`bloc` : « identite », « circonstances », « bilan_vital » ou null pour un champ de premier niveau). N'émet RIEN : l'écran de saisie ne se redessine pas. */
  definirChamp(bloc, cle, valeur) {
    this.stockage.modifier(this.fiche, (f) => {
      if (bloc) f[bloc] = { ...(f[bloc] ?? {}), [cle]: valeur }; else f[cle] = valeur;
    });
  }

  /** Date de naissance en trois champs : `partie` = jour, mois ou annee. */
  definirNaissance(partie, valeur) {
    this.stockage.modifier(this.fiche, (f) => {
      const n = { ...(f.identite?.date_naissance ?? {}), [partie]: valeur };
      f.identite = { ...(f.identite ?? {}), date_naissance: n };
    });
  }

  /** Constante : valeur BRUTE, horodatée (heure préremplie « maintenant », modifiable) ; aucune interprétation (D-19). @returns {{ok: boolean, raison?: string}} */
  ajouterConstante(type, valeur, heure) {
    if (!TYPES_CONSTANTE.some((t) => t.id === type)) return { ok: false, raison: 'type de mesure inconnu' };
    if (typeof valeur !== 'string' || valeur.trim() === '') return { ok: false, raison: 'écrire la valeur mesurée' };
    const t = heureVersTimestamp(heure);
    if (t === null) return { ok: false, raison: 'heure invalide : écrire hh:mm' };
    const v = valeur.trim();
    // journal d'abord : la constante garde l'identifiant de son entrée, pour que sa correction soit retrouvée (L7c, revue L7 C1)
    const entree = this.journaliser('constante', { type, valeur: v }, { maintenant: t });
    this.stockage.modifier(this.fiche, (f) => { f.constantes = [...(f.constantes ?? []), { t, type, valeur: v, unite: '', journal_id: entree.id }]; }, { immediat: true });
    this.emettre('fiche');
    return { ok: true };
  }

  /** Geste ou produit saisi (texte libre, jamais calculé) à l'heure indiquée. */
  ajouterGeste(texte, heure) {
    if (typeof texte !== 'string' || texte.trim() === '') return { ok: false, raison: 'écrire le geste ou le produit' };
    const t = heureVersTimestamp(heure);
    if (t === null) return { ok: false, raison: 'heure invalide : écrire hh:mm' };
    const x = texte.trim();
    const entree = this.journaliser('geste', { texte: x }, { maintenant: t });
    this.stockage.modifier(this.fiche, (f) => { f.gestes_produits = [...(f.gestes_produits ?? []), { t, texte: x, journal_id: entree.id }]; }, { immediat: true });
    this.emettre('fiche');
    return { ok: true };
  }

  // ───────── Journal (L7, 4.10) ─────────

  /** Correction d'une entrée : une NOUVELLE entrée qui renvoie à l'originale (qui reste lisible et barrée) ; l'heure de la correction est conservée. */
  corrigerEntree(id, texte) {
    const cible = this.fiche.journal.find((e) => e.id === id);
    if (!cible || cible.type === 'correction') return { ok: false, raison: 'cette entrée ne se corrige pas' };
    if (typeof texte !== 'string' || texte.trim() === '') return { ok: false, raison: 'écrire la correction' };
    this.journaliser('correction', { texte: texte.trim() }, { correction_de: id });
    this.ecrire();
    this.emettre('journal');
    return { ok: true };
  }

  // ───────── Rôles, profession (L5b) ─────────

  /** Profession et personnes connues de l'appareil : lues sans jamais retarder l'écran (valeurs par défaut en attendant). */
  async chargerReglages() {
    const reglages = await this.stockage.lireReglages();
    if (this.detruite) return;
    this.profession = reglages.profession; this.personnes = reglages.personnes; this.champsSensibles = reglages.champs_sensibles ?? {};
    if (!this.modeChoisi) this.modeChecklist = reglages.mode_affichage;   // réglage par défaut, sauf si l'équipe a déjà basculé
    this.emettre('reglages');
  }

  get roles() { return this.fiche.roles; }
  /** Identité et fonction de l'APPELANT de la transmission : tirée du rôle « appel » (4.8), aucun champ de plus. */
  get appelant() { return appelant(this.fiche.roles); }

  /** Attribue (ou libère, si la personne est vide) un rôle ; cumul permis ; journalisé avec l'ancienne valeur. Jamais bloquant. */
  attribuerRole(role, personne) {
    const { roles, changement } = attribuerRole(this.fiche.roles, role, personne, Date.now());
    if (!changement) return false;
    this.stockage.modifier(this.fiche, (f) => { f.roles = roles; });
    this.journaliser('role', changement);
    this.emettre('roles');
    return true;
  }

  /** Une personne saisie une fois devient un choix en un toucher pour les autres rôles ; la liste reste sur l'appareil. */
  ajouterPersonne(nom) {
    this.personnes = ajouterPersonne(this.personnes, nom);
    this.stockage.ecrireReglage('personnes', this.personnes);
  }

  /**
   * Changement de profession (puce de l'en-tête) : vaut pour l'appareil, s'applique aussitôt, journalisé « profession » { de, vers }.
   * L'écran se met à jour AVANT l'écriture (on affiche d'abord, on écrit ensuite).
   */
  changerProfession(vers) {
    const de = this.profession;
    if (de === (vers ?? null)) return false;
    this.profession = vers ?? null;
    this.journaliser('profession', { de, vers: this.profession });
    this.stockage.ecrireReglage('profession', this.profession);
    this.emettre('reglages');
    return true;
  }

  // ───────── Lieu ─────────

  definirLieu(partiel) {
    this.stockage.modifier(this.fiche, (f) => { f.lieu = { ...f.lieu, ...partiel }; });
    this.emettre('changement');
  }

  // ───────── Fin ─────────

  /** « Terminer l'intervention » : chronomètres et métronome arrêtés (journalisé), la fiche ne sera plus reprise d'elle-même (4.10). */
  terminer() {
    this.gestion?.arreterTous();
    this.son.arreterMetronome();
    this.ecran.liberer?.().catch?.(() => {});   // revue m9 : le verrou d'écran est rendu (batterie, écran allumé dans une poche)
    this.stockage.terminer(this.fiche);
    this.detruire();
  }

  /**
   * « Clôturer et effacer » depuis l'intervention (4.10) : la fiche est d'abord TERMINÉE (chronomètres et métronome arrêtés, verrou d'écran rendu),
   * puis effacée — cette fiche seulement. Rappelable après un échec : la seconde fois, seul l'effacement est refait.
   * @returns {Promise<object>} le résultat de `stockage.effacerFiche`
   */
  async cloturerEtEffacer() {
    const { id } = this.fiche;
    if (!this.detruite) this.terminer();
    return this.stockage.effacerFiche(this.mode, id);
  }

  /** Quitte l'intervention SANS la terminer (simulation en pause, ou « Accueil ») : la fiche reste en base, intacte. */
  async mettreEnPause() {
    this.son.arreterMetronome();
    this.ecran.liberer?.().catch?.(() => {});   // revue m9 (sans attendre : la nouvelle intervention peut redemander le verrou aussitôt)
    this.detruire(); // d'abord : la fiche cesse d'être « affichée » avant qu'une autre ne le devienne
    await this.stockage.vider();
  }

  detruire() {
    this.detruite = true;
    for (const d of this.debranchements) { try { d(); } catch { /* déjà débranché */ } }
    this.debranchements = [];
    this.stockage.definirAffichee(null);
    this.emettre('detruite');
    this.auditeurs.clear();
  }
}
