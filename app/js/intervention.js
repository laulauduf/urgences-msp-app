// Une intervention en cours : fiche active, protocole, chronomètres, métronome, appels (cahier des charges 2.4, 2.7, 2.8, 4.0 à 4.3 bis, 4.7, 4.11).
// Ce module ne touche pas au DOM : les écrans (app/js/ecrans/) le lisent et l'écoutent. Règle de fond : ON AFFICHE D'ABORD, ON ÉCRIT ENSUITE —
// aucune de ces méthodes n'attend le stockage ; la fiche vit en mémoire (stockage.js l'écrit en parallèle, ou la garde en mémoire en mode dégradé).
// Aucune valeur médicale ici : étapes, ordre, durées, fréquence et libellés viennent du protocole ; aucun ordre n'est écrit en dur.
import { Horloge, GestionChronos, lireChronometres, lireMetronome, formaterDuree } from './horloge.js';
import { attribuerRole, appelant, ajouterPersonne } from './roles.js';
import { construireVue, heureVersTimestamp, estVitale, MENTION_SUR_DEMANDE } from './checklist.js';
import { chargerHabilitations } from './habilitations.js';
import { chargerGlossaire, lireGlossaire } from './glossaire.js';
import { chargerUnites, lireUnites } from './unites.js';
import { TYPES_CONSTANTE } from './bilan.js';
import { victimeActive, victimePriseEnCharge, ajouterVictime, retirerVictime, numeroVictime } from './victimes.js';
import { lireEdition, ecrireEdition } from './edition.js';
import { champDe, valeurEtape, saisiePermise } from './saisie-etape.js';

/** Champs de premier niveau de la fiche qui ne sont PAS ceux d'une victime : le message au 15 (évaluation, demande), commun à toutes les victimes (D-64). */
const CHAMPS_GLOBAUX = ['evaluation', 'demande'];
import { verifierProtocole } from './protocole.js';
import { ID_COMMUN, chargerProtocoleCommun, prefixerProtocole, prefixeDe } from './protocole-commun.js';
import { titreDe } from './catalogue.js';

export const ACR = 'acr';
/** Délai maximal d'annulation du démarrage (CHOIX PROVISOIRE, revue R1 : 60 s, à faire trancher par Laurent). */
export const ANNULATION_MAX_MS = 60000;
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
   *          chargerHabilitations?: () => Promise<object|null>, chargerGlossaire?: () => Promise<object>, chargerUnites?: () => Promise<object>}} options
   *   `chargerProtocole` renvoie { ok, protocole } ou { ok: false, raisons } (protocole.js).
   */
  constructor({ stockage, son, ecran, chargerProtocole, protocoleId, protocolesAcr = [protocoleId], conduites = [], chargerHabilitations: chargerHab = chargerHabilitations, chargerGlossaire: chargerGlo = chargerGlossaire, chargerUnites: chargerUni = chargerUnites, chargerCommun = chargerProtocoleCommun }) {
    Object.assign(this, { stockage, son, ecran, chargerProtocoleFn: chargerProtocole, protocoleId, chargerHabilitationsFn: chargerHab, chargerGlossaireFn: chargerGlo, chargerUnitesFn: chargerUni, chargerCommunFn: chargerCommun });
    // P4a : plusieurs protocoles de type ACR (adulte = `protocoleId`, par défaut ; enfant…) et plusieurs conduites propres à une urgence (douleur thoracique…). Leurs identifiants viennent de main.js.
    // `protocoleActifId` : l'ACR en cours (celui dont la copie est dans la fiche). Les ACR PARTAGENT les identifiants d'étape (coches, chronomètres) : passer de l'adulte à l'enfant ne perd rien
    // (CHOIX PROVISOIRE, D-15 : « Alerter » fait reste fait, le cycle en cours continue).
    this.protocolesAcr = Array.isArray(protocolesAcr) && protocolesAcr.length > 0 ? [...new Set([protocoleId, ...protocolesAcr])] : [protocoleId];
    this.conduites = Array.isArray(conduites) ? [...conduites] : [];
    this.protocoleActifId = protocoleId;
    // conduite de « Autre situation » : la COMMUNE (D-51) ou une conduite propre à une urgence ; identifiants préfixés (protocole-commun.js), coches dans le MÊME objet `fiche.checklist`.
    // `protocoleCommun` désigne la conduite COURANTE (le nom est resté, il est lu par l'interface et par les tests).
    // communEtat : 'absent' (fichier non publié : aucune requête) | 'chargement' | 'ok' | 'illisible' (publié mais inutilisable : l'écran le dit)
    this.conduiteId = ID_COMMUN;
    this.acrDemande = null; this.echecAcr = null; this.chargementAcr = null;   // P4d : dernier ACR demandé (le dernier choix l'emporte) ; { id, raisons } quand un CHANGEMENT d'ACR a échoué et que l'ACR en cours est gardé
    this.protocoleCommun = null; this.communEtat = 'absent';
    // checklist (L6) : habilitations par profession (null tant que non lues ou illisibles : tout est alors restrictif), glossaire, mode et étapes passées
    this.habilitations = null; this.habilitationsEtat = 'chargement'; this.glossaire = lireGlossaire(null);
    this.unites = lireUnites(null);   // unités des constantes (D-26), lues de protocoles/_commun/unites.json ; aucune tant que non lues
    this.fiche = null; this.mode = 'reel';
    this.protocole = null; this.protocoleEtat = null; this.raisons = [];   // protocoleEtat : null | 'chargement' | 'ok' | 'secours'
    this.situation = null;                                                 // null (choix en cours) | ACR | AUTRE
    this.questionMetronome = null;                                         // D-80 : null | 'question' (sortie de l'ACR métronome en marche, pas de réponse) | 'continue' (« Continuer » touché)
    // D-82 : le signal sonore « 2 insufflations » n'a de sens qu'en arrêt cardiaque (hors ACR le métronome peut battre encore, sans signal)
    if (this.son) this.son.signalInsufflationsPermis = () => this.situation === ACR;
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
    this.debutPerf = performance.now();   // horloge monotone : l'annulation du démarrage se borne dans le temps sans dépendre de Date.now() (revue R1, C1)
    this.commencee = false;               // vrai dès qu'une saisie de la fiche bilan ou du lieu a eu lieu : la fiche n'est plus « vide »
    this.fiche = this.stockage.nouvelleFiche(mode);
    this.stockage.definirAffichee(this.fiche.id);
    this.initialiserTemps();
    // N1 (revue des correctifs R1c) : l'horloge monotone peut s'arrêter pendant la veille de l'appareil ; passer en arrière-plan = l'intervention a commencé (plus d'annulation)
    const surVisibilite = () => { if (document.visibilityState === 'hidden') this.commencee = true; };
    document.addEventListener('visibilitychange', surVisibilite);
    this.debranchements.push(() => document.removeEventListener('visibilitychange', surVisibilite));
    this.son.debloquer();
    this.ecran.demander(); // jamais attendu
    this.prefetch = this.chargerProtocoleFn(this.protocoleId); this.prefetchId = this.protocoleId;   // l'ACR adulte, le plus probable ; un autre ACR se charge à son choix (choisirAcr)
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
    // la DERNIÈRE situation dit où l'on était : un ACR connu (adulte, enfant…), une conduite connue, sinon (null, identifiant inconnu) « Autre situation » commune
    const idDerniere = derniere?.protocole ?? null;
    this.situation = derniere ? (this.protocolesAcr.includes(idDerniere) ? ACR : AUTRE) : null;
    if (this.situation === ACR) this.protocoleActifId = idDerniere;
    if (this.situation === AUTRE) this.conduiteId = this.conduites.includes(idDerniere) ? idDerniere : ID_COMMUN;
    if (this.situation === ACR) {
      const copie = fiche.protocoles_utilises?.[this.protocoleActifId];
      const { verifierProtocole } = await import('./protocole.js');
      if (copie && verifierProtocole(copie).length === 0) {
        this.adopterProtocole(copie, { journaliserSituation: false });
        await this.completerRapportInsufflations();
      } else { // pas de copie exploitable : on retombe sur le fichier courant, ou sur l'écran de secours
        this.protocoleEtat = 'chargement'; this.emettre('changement');
        const r = await this.chargerProtocoleFn(this.protocoleActifId);
        if (r.ok) this.adopterProtocole(r.protocole, { journaliserSituation: false });
        else this.basculerSecours(r.raisons);
      }
    }
    if (this.situation === AUTRE) this.chargerCommun({ copie: fiche.protocoles_utilises?.[this.conduiteId] });   // la copie de la fiche d'abord (même parade que l'ACR) ; synchrone si elle est exploitable
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

  /**
   * m-1 (revue du lot I) : une intervention ouverte AVANT la 0.2.14 porte une copie de protocole sans `battements_avant_insufflations` ; on prend alors le rapport du protocole PUBLIÉ du même
   * identifiant (30 adulte, 15 enfant : jamais écrits dans le code). Fichier illisible ou muet : on garde la valeur par défaut, la reprise n'échoue jamais pour cela.
   */
  async completerRapportInsufflations() {
    if (!this.metronome || this.metronome.battementsAvantInsufflations !== null) return;
    try {
      const r = await this.chargerProtocoleFn(this.protocoleActifId);
      const n = r?.ok ? lireMetronome(r.protocole)?.battementsAvantInsufflations : null;
      if (Number.isInteger(n) && n > 0) { this.metronome = { ...this.metronome, battementsAvantInsufflations: n }; this.son.reglerInsufflations?.(n); }
    } catch { /* hors ligne ou illisible : valeur par défaut */ }
  }

  adopterProtocole(protocole, { journaliserSituation = true } = {}) {
    // m-2 : passer d'un ACR à un autre (adulte → enfant) remet le comptage de « 2 insufflations » à zéro ; le métronome continue
    if (journaliserSituation && this.protocole && this.protocole.id !== protocole.id) this.son.remettreAZeroInsufflations?.();
    this.protocole = protocole; this.protocoleEtat = 'ok'; this.raisons = [];
    this.definitions = lireChronometres(protocole);
    this.metronome = lireMetronome(protocole);
    if (this.metronome) this.son.reglerInsufflations?.(this.metronome.battementsAvantInsufflations);   // D-81 : « 2 insufflations » suit le rapport du protocole (même si le métronome tourne déjà : changement d'ACR)
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
      this.journaliser('situation', { protocole: protocole.id, version: protocole.version, libelle: protocole.titre_court ?? protocole.titre });   // (libellé lisible : le journal et le document ne montrent pas l'identifiant du fichier, P4d m7)
      this.reprendreAppelDansAcr();
    }
  }

  /**
   * P4d (revue P4, « Alerter ») : le 15 a déjà été appelé dans une autre situation (une conduite, « Autre situation », l'ACR précédent) : l'étape « Alerter » de l'ACR qui s'ouvre est cochée avec l'heure du PREMIER appel
   * (journalisée `repris: true`), au lieu de s'afficher « ⚠ non faite » à tort. L'équipe peut la décocher (rappeler pour signaler l'arrêt reste son choix). Seulement à l'adoption d'un ACR, jamais à la reprise d'une fiche.
   */
  reprendreAppelDansAcr() {
    const alerte = this.etapesPremierEcran().find((e) => e.cochage_auto === 'appel');
    if (!alerte || this.estCochee(alerte.id)) return;
    // V1, N3 : une étape « Alerter » déjà cochée PUIS décochée (volontairement) n'est pas recochée au changement d'ACR suivant — les deux ACR partagent cet identifiant, la reprise ne sert qu'à l'arrivée d'une conduite
    if (this.fiche.journal.some((e) => e.type === 'case' && e.donnees?.id === alerte.id)) return;
    const appel = this.fiche.journal.find((e) => ['appel_lance', 'appel_fait', 'appel_simule'].includes(e.type));
    if (appel) this.cocher(alerte.id, { t: appel.t, repris: true });
  }

  basculerSecours(raisons) {
    this.protocoleEtat = 'secours'; this.raisons = raisons;
    this.journaliser('secours_protocole', { raisons });
  }

  // ───────── Choix et changement de situation ─────────

  /**
   * Un ACR (adulte par défaut ; enfant…) : choix à l'accueil, passage depuis une autre situation (un toucher), ou changement d'ACR par le menu. Affiche tout de suite ; le protocole arrive en
   * parallèle. Identifiant inconnu : ignoré, sans erreur. Même ACR déjà en cours : rien.
   */
  async choisirAcr(id = this.protocoleId) {
    if (!this.protocolesAcr.includes(id)) return;
    this.acrDemande = id;   // le DERNIER choix l'emporte, même s'il revient à l'ACR en cours (annule alors le changement en attente)
    if (this.situation === ACR && this.protocoleActifId === id && this.protocoleEtat !== 'secours') { this.echecAcr = null; return; }
    if (this.chargementAcr === id) return;   // V1, N1 : cet ACR est déjà en cours de chargement (double toucher) : le premier appel l'adopte, une seule fois
    // P4d (m3) : CHANGEMENT d'ACR (un ACR est déjà adopté et affiché) : il reste affiché, avec sa barre « Masser · DAE », jusqu'à l'arrivée du nouveau ; jamais d'écran « Chargement » qui masquerait un massage en cours
    const garde = this.situation === ACR && this.protocoleEtat === 'ok';
    this.situation = ACR; this.echecAcr = null;
    this.questionMetronome = null;   // D-80 : de retour en ACR, rien à demander
    if (!garde) { this.protocoleActifId = id; this.protocoleEtat = 'chargement'; }
    this.emettre('changement');
    if (!this.prefetch || this.prefetchId !== id) { this.prefetch = this.chargerProtocoleFn(id); this.prefetchId = id; }
    this.chargementAcr = id;
    let r;
    try { r = await this.prefetch; } finally { if (this.chargementAcr === id) this.chargementAcr = null; }
    // (P4d, m1) un autre choix ou un départ de l'ACR pendant le chargement : il l'emporte, l'ACR n'est ni adopté ni enregistré
    if (this.detruite || this.situation !== ACR || this.acrDemande !== id) return;
    if (r.ok) { this.protocoleActifId = id; this.adopterProtocole(r.protocole); }
    else if (garde && this.protocoleEtat === 'ok') {
      // P4d (m4) : l'autre ACR est illisible alors qu'un ACR est déjà adopté : on RESTE sur lui (Masser, DAE, métronome, cycle), l'échec est dit (bandeau) et journalisé ; pas d'écran de secours
      this.prefetch = null;
      this.echecAcr = { id, raisons: r.raisons };
      this.journaliser('acr_illisible', { protocole: id, raisons: r.raisons });
    } else {
      this.prefetch = null; // on réessaiera au prochain essai
      if (!this.fiche.situations.some((s) => s.protocole === id)) {
        this.stockage.modifier(this.fiche, (f) => { f.situations.push({ protocole: id, depuis: Date.now(), secours: true }); });
        this.journaliser('situation', { protocole: id, secours: true, libelle: titreDe(id) ?? id });   // (libellé lisible, pas l'identifiant du fichier : V1, N2)
      }
      this.basculerSecours(r.raisons);
    }
    this.emettre('changement');
  }

  /**
   * « Autre situation » : alerte, chronomètre global, fiche, transmission, lieu — et la conduite commune (par défaut) ou la conduite propre à une urgence (`id`) quand son fichier est publié
   * (sinon aucune checklist). Identifiant de conduite inconnu : la conduite commune.
   */
  choisirAutre(id = ID_COMMUN) {
    const conduite = this.conduites.includes(id) ? id : ID_COMMUN;
    if (conduite !== this.conduiteId) { this.protocoleCommun = null; this.communEtat = 'absent'; }   // une autre conduite : l'ancienne est lâchée (ses coches restent dans la fiche, sous son préfixe)
    // D-80 : on QUITTE l'arrêt cardiaque alors que le métronome bat → une question non bloquante (« Arrêter / Continuer ») ; sans réponse il continue. Pas de question en passant d'une conduite à l'autre (on n'était pas en ACR).
    if (this.situation === ACR && this.son.etat?.().metronome.actif) this.questionMetronome = 'question';
    this.conduiteId = conduite; this.situation = AUTRE;
    this.stockage.modifier(this.fiche, (f) => { f.situations.push({ protocole: conduite === ID_COMMUN ? null : conduite, depuis: Date.now() }); }, { immediat: true });
    this.journaliser('situation', { protocole: conduite === ID_COMMUN ? null : conduite, libelle: conduite === ID_COMMUN ? 'autre situation' : (titreDe(conduite) ?? 'autre situation') });   // (le nom de navigation, pas l'identifiant du fichier : P4d m7)
    this.chargerCommun({ copie: this.fiche.protocoles_utilises?.[conduite] });
    this.emettre('changement');
  }

  /**
   * Charge la checklist commune (jamais attendue : l'écran « Autre situation » s'affiche d'abord). Ordre : déjà en mémoire → copie de la fiche (si exploitable) → fichier publié.
   * Fichier non publié : aucune requête, `communEtat` reste 'absent'. Publié mais illisible : 'illisible' (l'écran le dit ; les outils restent disponibles).
   * L'adoption n'ajoute PAS d'entrée « situation » : la checklist commune fait partie de « Autre situation ».
   */
  async chargerCommun({ copie = null } = {}) {
    if (this.protocoleCommun) return;
    const id = this.conduiteId;
    if (copie && verifierProtocole(copie, { premierEcranRequis: false }).length === 0) { this.adopterCommun(copie, { copier: false }); return; }
    this.communEtat = 'chargement';
    let r;
    try { r = await this.chargerCommunFn({ id }); } catch { r = { ok: false, absent: false, raisons: ['chargement impossible'] }; }
    if (this.detruite || this.conduiteId !== id) return;   // une autre conduite a été choisie pendant le chargement
    if (r.ok) this.adopterCommun(r.protocole, { copier: true });
    else { this.communEtat = r.absent ? 'absent' : 'illisible'; if (!r.absent) this.emettre('changement'); }
  }

  adopterCommun(protocole, { copier }) {
    this.protocoleCommun = prefixerProtocole(protocole, prefixeDe(this.conduiteId)); this.communEtat = 'ok';
    if (copier) {
      this.stockage.modifier(this.fiche, (f) => {
        f.protocoles_utilises[protocole.id] = structuredClone(protocole);   // copie : un protocole mis à jour ne change jamais une intervention en cours
        f.versions_protocoles[protocole.id] = protocole.version;
      }, { immediat: true });
    }
    this.emettre('changement');
  }

  /**
   * ANNULER LE DÉMARRAGE (revue R1, C1 CRITIQUE) : jamais une intervention en cours ne doit pouvoir s'effacer d'un toucher. Offerte SEULEMENT dans les ANNULATION_MAX_MS premières
   * millisecondes (horloge monotone) ET tant que RIEN n'a été fait ni saisi : le journal ne contient que « urgence » et le choix de situation, ni case, ni rôle, ni chronomètre,
   * ni événement, ni saisie de la fiche bilan ou du lieu (drapeau `commencee`). Une fiche reprise après un rechargement ne l'est jamais (pas de `debutPerf`).
   */
  get annulable() {
    const f = this.fiche;
    if (!f || this.debutPerf === undefined || this.commencee) return false;
    if (performance.now() - this.debutPerf > ANNULATION_MAX_MS) return false;
    const ecoule = Date.now() - f.journal[0].t;   // l'heure du téléphone borne aussi : une veille ne fait pas avancer l'horloge monotone
    if (!(ecoule >= 0 && ecoule <= ANNULATION_MAX_MS)) return false;
    if (document.visibilityState === 'hidden') return false;
    return f.journal.every((e) => e.type === 'urgence' || e.type === 'situation') && f.roles.length === 0 && Object.keys(f.checklist).length === 0
      && f.chronometres.length === 0 && f.situations.length <= 1 && !this.tuileTouchee;
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
  /** Une étape de l'ACR, ou de la checklist commune (identifiants préfixés : jamais de confusion possible entre les deux). */
  etape(id) { return this.protocole?.etapes.find((e) => e.id === id) ?? this.protocoleCommun?.etapes.find((e) => e.id === id) ?? null; }
  /**
   * L'étape dont la case se coche au premier appel (cochage_auto: « appel ») : celle du bouton « Alerter ». En « Autre situation », celle de la checklist commune si elle en a une
   * (sinon, comme avant, celle de l'ACR si elle est en mémoire).
   */
  etapeAlerte() {
    if (this.situation === AUTRE) {
      const commune = (this.protocoleCommun?.etapes ?? []).find((e) => e.cochage_auto === 'appel');
      if (commune) return commune;
    }
    return this.etapesPremierEcran().find((e) => e.cochage_auto === 'appel') ?? null;
  }
  estCochee(id) { return Boolean(this.fiche.checklist[id]); }

  /** `surDemande` (D-58) : coche d'une étape réservée aux habilités, confirmée « fait sur demande du 15 » ; le journal le dit (donnée `sur_demande`, mention dans le libellé : la transmission la reprend). */
  cocher(id, { t = Date.now(), surDemande = false, repris = false, saisie = false, silencieux = false } = {}) {
    if (this.estCochee(id)) return false;
    // `saisie` (D-66) : l'étape de recueil a été cochée PAR une saisie (elle se décoche si la saisie est vidée) ; `silencieux` : pas de redessin (l'écran de saisie ne se reconstruit pas, on perdrait la frappe)
    this.stockage.modifier(this.fiche, (f) => { f.checklist[id] = { coche_le: t, ...(saisie ? { saisie: true } : {}) }; }, { immediat: true });
    const e = this.etape(id);
    const libelle = e?.texte_court ?? id;
    this.journaliser('case', { id, libelle: surDemande ? `${libelle} — ${MENTION_SUR_DEMANDE}` : libelle, ...(surDemande ? { sur_demande: true } : {}), ...(repris ? { repris: true } : {}), ...(saisie ? { saisie: true } : {}) }, { maintenant: t });
    if (!silencieux) this.emettre('changement');
    return true;
  }

  // ───────── Checklist (L6, cahier 4.5) ─────────

  /** Habilitations par profession et glossaire : lus sans jamais retarder un écran ; tant que les habilitations manquent, tout est restrictif. */
  async chargerReferences() {
    const [habilitations, glossaire, unites] = await Promise.all([this.chargerHabilitationsFn(), this.chargerGlossaireFn(), this.chargerUnitesFn()]);
    if (this.detruite) return;
    this.habilitations = habilitations ?? null; this.habilitationsEtat = habilitations ? 'ok' : 'absent'; this.glossaire = glossaire ?? lireGlossaire(null); this.unites = unites ?? lireUnites(null);
    this.emettre('habilitations');
  }

  /** Vue de la checklist : le protocole, la fiche (mêmes cases que les tuiles) et la profession courante, filtrés par les habilitations. */
  get vueChecklist() {
    return construireVue({ etapes: this.protocole?.etapes ?? [], checklist: this.fiche.checklist, journal: this.fiche.journal, habilitations: this.habilitations, profession: this.profession });
  }

  /** Vue de la checklist COMMUNE (« Autre situation », D-51) : mêmes règles que l'ACR (filtre par profession, étape vitale exempte, D-25), mêmes coches (`fiche.checklist`, ids préfixés). */
  get vueChecklistCommune() {
    return construireVue({ etapes: this.protocoleCommun?.etapes ?? [], checklist: this.fiche.checklist, journal: this.fiche.journal, habilitations: this.habilitations, profession: this.profession });
  }

  /** L'item d'une étape, dans la vue de l'ACR ou dans celle de la checklist commune. */
  itemChecklist(id) { return this.vueChecklist.parId.get(id) ?? this.vueChecklistCommune.parId.get(id) ?? null; }

  /**
   * Toucher de la case d'une étape dans la checklist. Même objet que les tuiles : `fiche.checklist[id]`.
   * - étape cochée : décochée (journalisée) ; - étape non cochable pour cette profession : refusée (jamais cochée) ;
   * - étape vitale : même chemin que sa tuile (déclencheur du protocole, alerte au premier appel) ; - « Alerter » : ouvre l'alerte, ne coche pas.
   * - étape RÉSERVÉE aux habilités (D-58) pour une profession réglée non habilitée : rien n'est coché tant que `confirme` n'est pas vrai ({confirmationRequise}) ; confirmée, elle se coche « sur demande du 15 ».
   * @returns {{ouvrirAlerte: boolean, refuse?: boolean, confirmationRequise?: boolean}}
   */
  cocherDepuisChecklist(id, { confirme = false } = {}) {
    const item = this.itemChecklist(id);
    if (!item) return { ouvrirAlerte: false, refuse: true };
    // décocher est toujours permis, même si un changement de profession a rendu l'étape non cochable : décocher n'est pas autoriser (revue L6 m5)
    if (item.cochee) { this.decocher(id); return { ouvrirAlerte: false }; }
    if (!item.cochable) return { ouvrirAlerte: false, refuse: true };
    if (item.surDemande && !confirme) return { ouvrirAlerte: false, confirmationRequise: true };   // la confirmation ne se contourne pas : elle est exigée ICI, pas seulement par l'écran
    const e = item.etape;
    const surDemande = item.surDemande === true;
    if (estVitale(e)) return this.toucherTuile(id, { prudent: true, surDemande });   // une seule définition d'« étape vitale » (revue L6 m10)
    if (e.cochage_auto === 'appel') { this.emettre('changement'); return { ouvrirAlerte: true }; }
    if (this.cocher(id, { surDemande })) this.declencher(e, { prudent: true });
    return { ouvrirAlerte: false };
  }

  /** Décoche une étape : la case sort de la fiche ; le journal garde les deux entrées (la seconde marquée `decochee`). */
  decocher(id, { silencieux = false } = {}) {
    if (!this.estCochee(id)) return false;
    this.stockage.modifier(this.fiche, (f) => { delete f.checklist[id]; }, { immediat: true });
    this.journaliser('case', { id, libelle: this.etape(id)?.texte_court ?? id, decochee: true });
    if (!silencieux) this.emettre('changement');
    return true;
  }

  /**
   * D-66 (lot G) : après une saisie dans une étape de recueil (le renseignement est DÉJÀ dans la fiche : `definirChamp`, `ajouterConstante` — mêmes champs que le volet « Fiche », jamais une
   * seconde copie), l'étape se coche (heure de la saisie) si quelque chose est saisi ; si tout est vidé et que c'est la saisie qui l'avait cochée, elle se décoche. Une étape qu'une profession
   * ne peut pas cocher (`restreint`) n'est jamais cochée par ce biais : la donnée est gardée, la case reste celle du filtre par profession. Jamais pour une étape sans `saisie` ni pour une étape
   * vitale (le contrôle R20 le garantit pour les protocoles ; ici on le vérifie aussi). N'émet que `saisie` (jamais `changement` : l'écran ne se redessine pas, on perdrait la frappe).
   * @returns {{valeur: string, coche: boolean}} la valeur montrée sous le libellé, et l'état de la case
   */
  /** M4 : cette étape de la checklist peut-elle porter une saisie ? (étape saisissable, non vitale, après toute étape vitale du protocole, jamais dans un arrêt cardiaque : `saisiePermise`). */
  saisiePermise(item) {
    if (!item) return false;
    const p = this.protocole?.etapes?.includes(item.etape) ? this.protocole : this.protocoleCommun?.etapes?.includes(item.etape) ? this.protocoleCommun : this.protocole;
    return saisiePermise(p, item.etape);
  }

  /** `decocherSeulement` (m-2) : au retour du volet « Fiche », ne fait QUE décocher une étape cochée par la saisie dont la valeur a été vidée ; ne coche jamais. */
  etapeSaisie(id, { decocherSeulement = false } = {}) {
    const item = this.itemChecklist(id);
    const saisie = item?.etape?.saisie;
    if (!item || !this.saisiePermise(item)) return { valeur: '', coche: false };
    const valeur = valeurEtape(this.fiche, saisie);
    // m1 : jamais pour une étape que le protocole déclare non cochable (cochable: false), ni pour une étape que la profession ne peut pas cocher, ni « sur demande du 15 » (D-58) : la valeur est gardée, la case reste ce qu'elle est
    if (valeur !== '') { if (!decocherSeulement && !item.cochee && item.cochable && !item.surDemande) this.cocher(id, { saisie: true, silencieux: true }); }
    else if (item.cochee && this.fiche.checklist[id]?.saisie === true) this.decocher(id, { silencieux: true });
    this.emettre('saisie', { id });
    return { valeur, coche: this.estCochee(id) };
  }

  /**
   * « Noter : fait à hh:mm » (Q-31, PROVISOIRE) : pour une action que ce profil ne peut pas cocher. Crée une entrée `geste` au journal, à l'heure
   * saisie (l'occurrence la plus récente, jamais dans le futur), SANS cocher la case : noter un geste fait n'est pas l'autoriser.
   * @returns {{ok: boolean, raison?: string}}
   */
  noterGeste(id, heure) {
    const item = this.itemChecklist(id);
    if (!item || !item.restreint) return { ok: false, raison: "cette étape ne se note pas" };
    const t = heureVersTimestamp(heure);
    if (t === null) return { ok: false, raison: 'heure invalide : écrire hh:mm, par exemple 14:32' };
    this.journaliser('geste', { id, libelle: item.etape.texte_court }, { maintenant: t });
    this.ecrire();
    this.emettre('changement');
    return { ok: true };
  }

  /**
   * Toucher d'une tuile vitale. « Alerter » (cochage_auto: appel) n'est PAS coché à l'ouverture du panneau (ouvrir n'est pas alerter) : elle
   * ouvre le panneau et se coche au premier appel lancé ou au premier « J'ai appelé ». Un second toucher ne décoche jamais (toucher maladroit).
   * @returns {{ouvrirAlerte: boolean}}
   */
  toucherTuile(id, { prudent = false, surDemande = false } = {}) {
    const e = this.etape(id);
    if (!e) return { ouvrirAlerte: false };
    if (!this.protocoleCommun?.etapes.includes(e)) this.tuileTouchee = true; // la zone « cycle » apparaît dès le premier toucher d'une tuile vitale de l'ACR (4.3 bis) ; une étape vitale de la checklist commune n'est pas une action de l'ACR
    if (e.cochage_auto === 'appel') { this.emettre('changement'); return { ouvrirAlerte: true }; }
    // le déclencheur du protocole (métronome, chronomètre) ne part qu'au PREMIER cochage de l'étape dans la fiche : décocher puis recocher ne relance
    // pas un métronome mis en pause (revue L6 M1, second cas)
    const premiere = !this.fiche.journal.some((x) => x.type === 'case' && x.donnees?.id === id);
    const neuve = this.cocher(id, { surDemande });
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

  /**
   * D-80 (METRO-1 = C), corrigé par le lot J-b (M-1, M-2) : la ligne « Métronome en marche — Arrêter · Continuer » de l'écran « Autre situation » (et des conduites) est présente TANT QUE le métronome
   * bat hors ACR, sans aucun délai (la carte qui disparaissait après 15 s ne laissait plus aucun moyen d'arrêter le métronome). Renvoie :
   *   'question' : « Arrêter · Continuer » ; 'continue' : « Continuer » touché, il ne reste que « Arrêter » ; null : pas de ligne (en ACR, métronome arrêté ou en pause, pas de sortie d'ACR métronome en marche).
   * Cette fonction ne touche JAMAIS au son : sans réponse le métronome continue.
   */
  etatLigneMetronome() {
    if (this.questionMetronome === null || this.situation === ACR) return null;
    if (!this.son.etat?.().metronome.actif) return null;
    return this.questionMetronome;
  }

  /** La question est-elle encore entière (« Arrêter · Continuer ») ? */
  questionMetronomeOuverte() { return this.etatLigneMetronome() === 'question'; }

  /** Réponse : « arreter » = pause du métronome (même effet que « Masser » ; journalisé), à tout moment tant que la ligne est là (m-a : aucun délai qui l'ignorerait) ; « continuer » = la ligne se réduit à « Arrêter ». Sans ligne : sans effet. */
  repondreQuestionMetronome(choix) {
    if (this.etatLigneMetronome() === null) { this.questionMetronome = null; this.emettre('changement'); return; }
    if (choix === 'arreter') {
      this.questionMetronome = null;
      this.son.pauseMetronome();
      this.journaliser('chronometre', { id: 'metronome', action: 'pause', apres: 'sortie_acr' });
    } else if (choix === 'continuer') this.questionMetronome = 'continue';
    this.emettre('changement');
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

  /** La victime dont l'onglet est ouvert (D-64) : c'est elle que la saisie de la fiche modifie. */
  get victimeActive() { return victimeActive(this.fiche); }

  /**
   * Écrit un champ de la fiche. D-64 : les champs du patient (`bloc` « identite », « circonstances », « bilan_vital », ou `null` pour antécédents, traitements, allergies, notes…)
   * s'écrivent dans la victime OUVERTE ; « évaluation » et « demande » (le message au 15, toutes victimes) restent au premier niveau. N'émet RIEN : l'écran de saisie ne se redessine pas.
   */
  definirChamp(bloc, cle, valeur, { priseEnCharge = false } = {}) {
    this.commencee = true;
    this.stockage.modifier(this.fiche, (f) => {
      if (!bloc && CHAMPS_GLOBAUX.includes(cle)) { f[cle] = valeur; return; }
      const v = priseEnCharge ? victimePriseEnCharge(f) : victimeActive(f);   // M2 : la saisie dans une étape va à la victime prise en charge (VICTIME-SAISIE ouverte, registre)
      if (bloc) v[bloc] = { ...(v[bloc] ?? {}), [cle]: valeur }; else v[cle] = valeur;
    });
  }

  /** Date de naissance en trois champs : `partie` = jour, mois ou annee (de la victime ouverte). */
  definirNaissance(partie, valeur) {
    this.commencee = true;
    this.stockage.modifier(this.fiche, (f) => {
      const v = victimeActive(f);
      v.identite = { ...(v.identite ?? {}), date_naissance: { ...(v.identite?.date_naissance ?? {}), [partie]: valeur } };
    });
  }

  // ───────── Modification sur place dans le mode transmission (D-65, d) : voir edition.js ─────────

  /** Valeur à proposer dans le champ d'une ligne modifiable. */
  lireEdition(edit) { return lireEdition(this.fiche, edit); }

  /** Écrit la valeur d'une ligne modifiable (la victime de la LIGNE, le lieu de l'intervention) ; enregistré à chaque frappe, sur l'appareil seulement. N'émet RIEN : l'écran ne se redessine pas. */
  ecrireEdition(edit, valeur) {
    this.commencee = true;
    let r = { ok: false };
    this.stockage.modifier(this.fiche, (f) => { r = ecrireEdition(f, edit, valeur); });
    return r;
  }

  // ───────── Victimes (D-64) : un onglet par victime, sans limite ─────────

  /** Ajoute une fiche de victime et l'ouvre. Écrit tout de suite (un onglet de plus ne doit jamais se perdre). */
  ajouterVictime() {
    this.commencee = true;
    let r;
    this.stockage.modifier(this.fiche, (f) => { r = ajouterVictime(f); }, { immediat: true });
    this.journaliser('victime_ajoutee', { numero: r.numero });
    this.ecrire();
    this.emettre('victimes');
    return r;
  }

  /** Ouvre l'onglet d'une victime. Aucune autre donnée ne change (la checklist, les chronomètres et le métronome ne dépendent pas de l'onglet). */
  choisirVictime(id) {
    if (!this.fiche.victimes.some((v) => v.id === id) || this.fiche.victime_active === id) return { ok: this.fiche.victime_active === id };
    this.stockage.modifier(this.fiche, (f) => { f.victime_active = id; }, { immediat: true });
    this.emettre('victimes');
    return { ok: true };
  }

  /** Retire une victime ajoutée par erreur (la confirmation est demandée par l'écran, qui annonce `contenuVictime` avant). La dernière ne se retire pas. */
  retirerVictime(id) {
    let r;
    this.stockage.modifier(this.fiche, (f) => { r = retirerVictime(f, id); }, { immediat: true });
    if (!r.ok) return r;
    this.journaliser('victime_retiree', { numero: r.numero, constantes: r.retirees.constantes, gestes: r.retirees.gestes });
    this.ecrire();
    this.emettre('victimes');
    return r;
  }

  /** Numéro de la victime ouverte quand il y en a plusieurs (écrit dans le journal à côté des constantes et gestes) ; sinon rien. */
  victimeDuJournal(id = this.victimeActive.id) { return this.fiche.victimes.length > 1 ? numeroVictime(this.fiche, id) : undefined; }

  /** Unité usuelle d'un type de constante (D-26), '' si le fichier n'en donne pas. Jamais de conversion ni de seuil (D-19). */
  uniteDe(type) { return this.unites?.parType?.get(type) ?? ''; }

  /** Constante : valeur BRUTE, horodatée (heure préremplie « maintenant », modifiable) ; aucune interprétation (D-19). @returns {{ok: boolean, raison?: string}} */
  ajouterConstante(type, valeur, heure, { priseEnCharge = false } = {}) {
    if (!TYPES_CONSTANTE.some((t) => t.id === type)) return { ok: false, raison: 'type de mesure inconnu' };
    if (typeof valeur !== 'string' || valeur.trim() === '') return { ok: false, raison: 'écrire la valeur mesurée' };
    const t = heureVersTimestamp(heure);
    if (t === null) return { ok: false, raison: 'heure invalide : écrire hh:mm' };
    const v = valeur.trim();
    // journal d'abord : la constante garde l'identifiant de son entrée, pour que sa correction soit retrouvée (L7c, revue L7 C1)
    const unite = this.uniteDe(type);   // gardée AVEC la valeur : la fiche, le journal et le document disent la même unité, même sans l'intervention (clôture depuis l'accueil)
    const cible = priseEnCharge ? victimePriseEnCharge(this.fiche) : this.victimeActive;   // D-64 : la victime dont l'onglet est ouvert ; M2 : celle de la checklist quand la saisie vient d'une étape
    const victime = cible.id; const numero = this.victimeDuJournal(cible.id);
    const entree = this.journaliser('constante', { type, valeur: v, unite, ...(numero ? { victime: numero } : {}) }, { maintenant: t });
    this.stockage.modifier(this.fiche, (f) => { f.constantes = [...(f.constantes ?? []), { t, type, valeur: v, unite, victime, journal_id: entree.id }]; }, { immediat: true });
    this.emettre('fiche');
    return { ok: true };
  }

  /** Geste ou produit saisi (texte libre, jamais calculé) à l'heure indiquée. */
  ajouterGeste(texte, heure) {
    if (typeof texte !== 'string' || texte.trim() === '') return { ok: false, raison: 'écrire le geste ou le produit' };
    const t = heureVersTimestamp(heure);
    if (t === null) return { ok: false, raison: 'heure invalide : écrire hh:mm' };
    const x = texte.trim();
    const victime = this.victimeActive.id; const numero = this.victimeDuJournal();
    const entree = this.journaliser('geste', { texte: x, ...(numero ? { victime: numero } : {}) }, { maintenant: t });
    this.stockage.modifier(this.fiche, (f) => { f.gestes_produits = [...(f.gestes_produits ?? []), { t, texte: x, victime, journal_id: entree.id }]; }, { immediat: true });
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
    this.commencee = true;
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
