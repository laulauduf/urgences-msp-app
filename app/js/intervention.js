// Une intervention en cours : fiche active, protocole, chronomètres, métronome, appels (cahier des charges 2.4, 2.7, 2.8, 4.0 à 4.3 bis, 4.7, 4.11).
// Ce module ne touche pas au DOM : les écrans (app/js/ecrans/) le lisent et l'écoutent. Règle de fond : ON AFFICHE D'ABORD, ON ÉCRIT ENSUITE —
// aucune de ces méthodes n'attend le stockage ; la fiche vit en mémoire (stockage.js l'écrit en parallèle, ou la garde en mémoire en mode dégradé).
// Aucune valeur médicale ici : étapes, ordre, durées, fréquence et libellés viennent du protocole ; aucun ordre n'est écrit en dur.
import { Horloge, GestionChronos, lireChronometres, lireMetronome, formaterDuree } from './horloge.js';
import { attribuerRole, appelant, ajouterPersonne } from './roles.js';

export const ACR = 'acr';
export const AUTRE = 'autre';

export class Intervention {
  /**
   * @param {{stockage: object, son: object, ecran: object, chargerProtocole: (id: string) => Promise<object>, protocoleId: string, numeros?: object}} options
   *   `chargerProtocole` renvoie { ok, protocole } ou { ok: false, raisons } (protocole.js).
   */
  constructor({ stockage, son, ecran, chargerProtocole, protocoleId }) {
    Object.assign(this, { stockage, son, ecran, chargerProtocoleFn: chargerProtocole, protocoleId });
    this.fiche = null; this.mode = 'reel';
    this.protocole = null; this.protocoleEtat = null; this.raisons = [];   // protocoleEtat : null | 'chargement' | 'ok' | 'secours'
    this.situation = null;                                                 // null (choix en cours) | ACR | AUTRE
    this.definitions = []; this.metronome = null; this.gestion = null; this.horloge = null;
    this.auditeurs = new Set(); this.debranchements = []; this.prefetch = null; this.dernierGlobal = 0;
    this.repriseDe = null; this.detruite = false; this.tuileTouchee = false;
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
    return this.fiche;
  }

  /** Reprise d'une fiche déjà en base (directe au lancement, ou depuis l'accueil). Le protocole est celui COPIÉ dans la fiche (2.4, parade 2). */
  async reprendre(fiche, { automatique = false } = {}) {
    this.chargerReglages();
    this.fiche = fiche; this.mode = fiche.mode; this.repriseDe = { automatique, debut: fiche.journal[0]?.t ?? fiche.cree_le };
    this.stockage.definirAffichee(fiche.id);
    this.initialiserTemps();
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

  /** « Autre situation » : alerte et chronomètre global, sans checklist (la fiche bilan arrive au lot L7). */
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

  /**
   * Toucher d'une tuile vitale. « Alerter » (cochage_auto: appel) n'est PAS coché à l'ouverture du panneau (ouvrir n'est pas alerter) : elle
   * ouvre le panneau et se coche au premier appel lancé ou au premier « J'ai appelé ». Un second toucher ne décoche jamais (toucher maladroit).
   * @returns {{ouvrirAlerte: boolean}}
   */
  toucherTuile(id) {
    const e = this.etape(id);
    if (!e) return { ouvrirAlerte: false };
    this.tuileTouchee = true; // la zone « cycle » apparaît dès le premier toucher d'une tuile vitale (4.3 bis)
    if (e.cochage_auto === 'appel') { this.emettre('changement'); return { ouvrirAlerte: true }; }
    const neuve = this.cocher(id);
    if (neuve) this.declencher(e);
    return { ouvrirAlerte: false };
  }

  /** Action technique liée au toucher (`declenche`) : métronome, chronomètre. Seulement au premier toucher de l'étape. */
  declencher(etape) {
    const d = etape.declenche;
    if (!d || typeof d !== 'object') return;
    if (d.metronome === 'demarrer') this.demarrerMetronome();
    if (typeof d.chronometre === 'string') this.gestion?.demarrer(d.chronometre);
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
    const alerte = this.etapeAlerte();
    if (alerte) this.cocher(alerte.id, { t }); // « Alerter » se coche au premier appel, avec l'heure de l'appel (aucun doublon)
    this.emettre('changement');
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

  // ───────── Rôles, profession (L5b) ─────────

  /** Profession et personnes connues de l'appareil : lues sans jamais retarder l'écran (valeurs par défaut en attendant). */
  async chargerReglages() {
    const reglages = await this.stockage.lireReglages();
    if (this.detruite) return;
    this.profession = reglages.profession; this.personnes = reglages.personnes;
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
    this.stockage.terminer(this.fiche);
    this.detruire();
  }

  /** Quitte l'intervention SANS la terminer (simulation en pause, ou « Accueil ») : la fiche reste en base, intacte. */
  async mettreEnPause() {
    this.son.arreterMetronome();
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
