// Temps de l'intervention (cahier des charges 2.7, 4.9) : chronomètres calculés sur l'HORLOGE RÉELLE, jamais sur un compteur.
//
// RÈGLES DE FOND
//  - Chaque chronomètre enregistre son départ `t0` (millisecondes, Date.now()) et sa durée cible ; aucun compteur n'est incrémenté.
//  - Calcul HYBRIDE : page visible → le temps avance sur performance.now() (qui ne recule pas) depuis le dernier recalage ; en
//    arrière-plan et à la reprise → recalcul sur Date.now() (le seul qui compte le temps de veille). Recalage à chaque retour.
//  - Un chronomètre AFFICHÉ ne recule jamais (même si l'heure du téléphone recule).
//  - Saut d'horloge (plus de 0,5 s d'écart entre les deux horloges, page visible) ou recul pendant l'arrière-plan : entrée de journal
//    `horloge_modifiee` ; un saut EN AVANT pendant l'arrière-plan ne se distingue pas du temps écoulé (limite connue).
//  - Rattrapage au retour : une échéance franchie pendant l'absence = UNE SEULE alerte (jamais une rafale), en bandeau, avec le
//    dépassement (« échéance dépassée de mm:ss ») et une entrée `rattrapage` au journal.
//  - Aucune alerte n'est possible hors du premier plan (pas de notification programmable sans serveur).
// Aucune valeur médicale ici : durées, fréquences et libellés viennent du protocole (lireChronometres, lireMetronome).

export const SEUIL_SAUT_MS = 500;
/** Seuil d'affichage « échéance proche » : un réglage de PRÉSENTATION (pas de valeur médicale). */
export const SEUIL_PROCHE_MS = 10_000;

// ───────── Formats d'affichage ─────────

const deux = (n) => String(n).padStart(2, '0');

/** « mm:ss », puis « h:mm:ss » à partir d'une heure. Jamais négatif. */
export function formaterDuree(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${deux(m)}:${deux(s)}` : `${deux(m)}:${deux(s)}`;
}

/** « T+mm:ss » (minutes sans limite à 59 : lisible dans le journal et l'export, indépendant du fuseau). */
export function formaterT(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `T+${deux(Math.floor(total / 60))}:${deux(total % 60)}`;
}

// ───────── Horloge hybride ─────────

/**
 * @param {{date?: () => number, perf?: () => number, visible?: () => boolean, journaliser?: (type: string, donnees: object) => void}} options
 *   Toutes les sources de temps sont injectables : les tests les remplacent par des horloges truquées.
 */
export class Horloge {
  constructor({ date = () => Date.now(), perf = () => performance.now(), visible = () => true, journaliser = () => {} } = {}) {
    this.date = date; this.perf = perf; this.estVisible = visible; this.journaliser = journaliser;
    this.dateAvantMasquage = null;
    this.ancre = { date: date(), perf: perf() };
    this.ecartSaut = date() - perf();
    this.dernierSaut = 0;
    this.decalage = 0;   // somme des sauts d'horloge détectés page visible, retranchée à chaque recalage (revue m2) : un saut n'est jamais du temps écoulé
  }

  /** Temps courant en ms « epoch », stable face à un changement d'heure du téléphone tant que la page est visible. */
  maintenant() {
    if (this.estVisible()) return this.ancre.date + (this.perf() - this.ancre.perf);
    return this.date() - this.decalage; // arrière-plan : seule Date.now() compte le temps de veille (moins les sauts déjà détectés)
  }

  /** Nouveau point de référence : lancement, retour au premier plan. */
  recaler() { this.ancre = { date: this.date() - this.decalage, perf: this.perf() }; this.ecartSaut = this.date() - this.perf(); }

  /**
   * À appeler régulièrement (environ 4 fois par seconde, avec l'affichage) tant que la page est visible : détecte un saut de
   * l'horloge du téléphone. Le temps de l'intervention n'est PAS faussé : on garde le point de référence d'avant le saut.
   * @returns {number} l'ampleur du saut en ms (0 si aucun)
   */
  echantillonner() {
    if (!this.estVisible()) return 0;
    const ecart = this.date() - this.perf();
    const saut = ecart - this.ecartSaut;
    if (Math.abs(saut) > SEUIL_SAUT_MS) {
      // une seule entrée par saut : on déplace la référence DE DÉTECTION (pas le point de référence du temps de l'intervention,
      // qui reste celui d'avant le saut : le saut n'est jamais compté comme du temps écoulé)
      this.ecartSaut = ecart;
      this.dernierSaut = saut;
      this.decalage += saut;
      this.journaliser('horloge_modifiee', { saut_ms: Math.round(saut), moment: 'page_visible' });
      return saut;
    }
    return 0;
  }

  /** La page passe en arrière-plan : on retient l'heure pour détecter un recul pendant l'absence. */
  masquer() { this.dateAvantMasquage = this.date(); }

  /** Retour au premier plan : recalage, et signalement d'un recul de l'horloge pendant l'absence. @returns {number} recul en ms (0 si aucun) */
  reafficher() {
    const maintenant = this.date();
    let recul = 0;
    if (this.dateAvantMasquage !== null && maintenant < this.dateAvantMasquage) {
      recul = this.dateAvantMasquage - maintenant;
      this.journaliser('horloge_modifiee', { recul_ms: Math.round(recul), moment: 'arriere_plan' });
    }
    this.dateAvantMasquage = null;
    this.recaler();
    return recul;
  }

  /** Branche la visibilité de la page : masquer / réafficher / pageshow. Renvoie la fonction qui débranche. */
  brancher(doc = document, fenetre = globalThis, { apresRetour = () => {} } = {}) {
    const auChangement = () => {
      if (doc.visibilityState === 'hidden') { this.masquer(); return; }
      this.reafficher();
      apresRetour();
    };
    const auPageshow = () => { this.reafficher(); apresRetour(); };
    doc.addEventListener('visibilitychange', auChangement);
    fenetre.addEventListener?.('pageshow', auPageshow);
    return () => { doc.removeEventListener('visibilitychange', auChangement); fenetre.removeEventListener?.('pageshow', auPageshow); };
  }
}

// ───────── Lecture du protocole (formes tolérées) ─────────

const valeurDe = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'valeur') ? v.valeur : v);
const marqueDe = (v) => (v !== null && typeof v === 'object' && typeof v.provisoire === 'string' ? v.provisoire : null);
const texteDe = (v) => (typeof v === 'string' ? v : v !== null && typeof v === 'object' && typeof v.texte === 'string' ? v.texte : null);

/** Texte de la marque affichée à côté d'une valeur fixée par un choix provisoire (règle d'affichage, cahier des charges en tête). */
export const MARQUE_PROVISOIRE = 'provisoire — non validé';
/** Marque d'un élément dont le contenu n'est pas établi (statut A_VALIDER du protocole), affichée partout où son texte apparaît (revue m6). */
export const MARQUE_A_VALIDER = '⚠ A_VALIDER';
const estAValider = (v) => v !== null && typeof v === 'object' && v.statut === 'A_VALIDER';

/**
 * Chronomètres du protocole, normalisés. Les valeurs peuvent être écrites seules ou enveloppées { valeur, provisoire, … }.
 * @returns {{id: string, libelle: string|null, demarrage: string, dureeS: number|null, repetition: string, alerte: string, provisoire: string|null, alerteProvisoire: string|null, note: string|null, noteProvisoire: string|null, avec: string|null}[]}
 */
export function lireChronometres(protocole) {
  return (Array.isArray(protocole?.chronometres) ? protocole.chronometres : []).map((c) => {
    const duree = valeurDe(c.duree_s);
    const demarrage = typeof c.demarrage === 'string' ? c.demarrage : 'manuel';
    const m = /^avec:(.+)$/.exec(demarrage);
    return {
      id: c.id,
      libelle: typeof c.libelle === 'string' ? c.libelle : null,
      demarrage,
      avec: m ? m[1] : null,
      dureeS: Number.isFinite(duree) && duree > 0 ? duree : null,
      repetition: valeurDe(c.repetition) ?? 'redemarre_seul',
      alerte: valeurDe(c.alerte) ?? 'aucune',
      provisoire: marqueDe(c.duree_s) ?? (typeof c.provisoire === 'string' ? c.provisoire : null),
      alerteProvisoire: marqueDe(c.alerte),
      note: texteDe(c.note_affichee),
      noteProvisoire: marqueDe(c.note_affichee),
      aValider: c.statut === 'A_VALIDER' || estAValider(c.duree_s) || estAValider(c.note_affichee),
    };
  });
}

/**
 * Métronome du protocole : fréquence, mode (continu ou adapté au 30:2, Q-11) et marques « provisoire ».
 * `marque` vaut MARQUE_PROVISOIRE tant que la FRÉQUENCE est fixée par un choix provisoire : elle disparaît d'elle-même quand le
 * protocole ne porte plus `provisoire` sur la fréquence (la décision a été validée).
 */
export function lireMetronome(protocole) {
  const m = protocole?.parametres?.metronome;
  const frequence = m?.frequence_par_min;
  if (!Number.isFinite(frequence) || frequence <= 0) return null;
  return {
    frequence,
    // D-81 : rapport compressions / insufflations du protocole (30 adulte, 15 enfant) ; null si le protocole ne le dit pas (le contrôle du dépôt l'exige)
    battementsAvantInsufflations: Number.isInteger(m.battements_avant_insufflations) && m.battements_avant_insufflations > 0 ? m.battements_avant_insufflations : null,
    provisoire: typeof m.provisoire === 'string' ? m.provisoire : null,
    marque: typeof m.provisoire === 'string' ? MARQUE_PROVISOIRE : null,
    mode: valeurDe(m.mode) ?? 'continu',
    modeMarque: marqueDe(m.mode) ? MARQUE_PROVISOIRE : null,
  };
}

// ───────── Chronomètres ─────────

/** Reste avant l'échéance (négatif = dépassé), ou null pour un chronomètre sans échéance. */
export function restant(chrono, maintenantMs) {
  if (!Number.isFinite(chrono.cible_s)) return null;
  return chrono.cible_s * 1000 - (maintenantMs - chrono.t0);
}

/** « en_cours », « proche » ou « echeance » (jamais la couleur seule : l'affichage ajoute texte et pictogramme). */
export function statutChrono(chrono, maintenantMs) {
  if (chrono.etat === 'arrete') return 'arrete';
  const r = restant(chrono, maintenantMs);
  if (r === null) return 'en_cours';
  if (r <= 0) return 'echeance';
  return r <= SEUIL_PROCHE_MS ? 'proche' : 'en_cours';
}

/**
 * Gestion des chronomètres d'une intervention. Elle travaille sur le tableau `fiche.chronometres` (format de 3.3 :
 * `{id, t0, cible_s, etat, echeances_signalees, relances}`) : l'état survit donc à une fermeture forcée, et les chronomètres
 * reprennent avec le temps réellement écoulé. Chaque changement appelle `ecrire()` (le stockage s'en charge, sans attente).
 */
export class GestionChronos {
  /**
   * @param {{horloge: Horloge, chronometres: object[], definitions: ReturnType<typeof lireChronometres>, journaliser?: Function, ecrire?: Function, onEcheance?: Function, onRattrapage?: Function}} options
   *   onEcheance({id, alerte, depassementMs}) : une échéance vient d'être franchie, page visible.
   *   onRattrapage({franchies: [{id, alerte, depassementMs}]}) : UNE alerte pour toutes les échéances franchies pendant l'absence.
   */
  constructor({ horloge, chronometres, definitions, journaliser = () => {}, ecrire = () => {}, onEcheance = () => {}, onRattrapage = () => {} }) {
    this.horloge = horloge; this.chronometres = chronometres; this.definitions = definitions;
    this.journaliser = journaliser; this.ecrire = ecrire; this.onEcheance = onEcheance; this.onRattrapage = onRattrapage;
    this.affiche = new Map(); // id → dernière valeur affichée (l'affichage ne recule jamais)
  }

  definition(id) { return this.definitions.find((d) => d.id === id); }
  trouver(id) { return this.chronometres.find((c) => c.id === id); }

  /** Démarre (ou redémarre) un chronomètre, et ceux qui démarrent « avec » lui. */
  demarrer(id) {
    const def = this.definition(id);
    if (!def) throw new Error(`chronomètre inconnu : ${id}`);
    const maintenant = this.horloge.maintenant();
    let c = this.trouver(id);
    const relance = Boolean(c);
    if (!c) { c = { id, t0: maintenant, cible_s: def.dureeS, etat: 'en_cours', echeances_signalees: 0, relances: 0 }; this.chronometres.push(c); }
    else { c.t0 = maintenant; c.etat = 'en_cours'; c.echeances_signalees = 0; c.relances += 1; }
    this.affiche.delete(id);
    this.journaliser('chronometre', { id, action: relance ? 'relance' : 'demarrage', cycle: c.relances + 1 });
    for (const autre of this.definitions.filter((d) => d.avec === id)) this.demarrer(autre.id);
    this.ecrire();
    return c;
  }

  /** « Terminer l'intervention » : tout s'arrête (journalisé). */
  arreterTous() {
    for (const c of this.chronometres) if (c.etat !== 'arrete') { c.etat = 'arrete'; this.journaliser('chronometre', { id: c.id, action: 'arret' }); }
    this.ecrire();
  }

  /** Valeur AFFICHABLE : temps écoulé ou reste, qui ne recule jamais. */
  lire(id) {
    const c = this.trouver(id);
    if (!c) return null;
    const maintenant = this.horloge.maintenant();
    // « ne recule jamais » : le temps écoulé affiché est le plus grand déjà affiché pour ce cycle ; le reste en découle
    const ecoule = Math.max(this.affiche.get(id) ?? 0, maintenant - c.t0, 0);
    this.affiche.set(id, ecoule);
    const reste = Number.isFinite(c.cible_s) ? c.cible_s * 1000 - ecoule : null;
    return { id, ecouleMs: ecoule, restantMs: reste, statut: statutChrono(c, maintenant), cycle: c.relances + 1, depassementMs: reste !== null && reste < 0 ? -reste : 0 };
  }

  /** Une échéance par cycle : celles qui viennent d'être franchies (page visible). À appeler avec l'affichage (≈ 4 fois par seconde). */
  tick() {
    this.horloge.echantillonner();
    const maintenant = this.horloge.maintenant();
    for (const c of this.chronometres) {
      if (c.etat !== 'en_cours' || !Number.isFinite(c.cible_s)) continue;
      const r = restant(c, maintenant);
      if (r <= 0 && c.echeances_signalees === 0) { // une seule échéance par cycle ; la relance remet le compteur à zéro
        c.echeances_signalees = 1;
        const alerte = this.definition(c.id)?.alerte ?? 'aucune';
        this.journaliser('echeance', { id: c.id, cycle: c.relances + 1 });
        this.ecrire();
        this.onEcheance({ id: c.id, alerte, depassementMs: -r });
      }
    }
  }

  /**
   * Retour au premier plan, ou reprise d'une fiche : toutes les échéances franchies PENDANT L'ABSENCE donnent UNE SEULE alerte.
   * Appeler après `horloge.reafficher()` (ou juste après la construction, pour une fiche reprise).
   * @returns {{id: string, alerte: string, depassementMs: number}[]} les échéances rattrapées
   */
  rattraper() {
    const maintenant = this.horloge.maintenant();
    const franchies = [];
    for (const c of this.chronometres) {
      if (c.etat !== 'en_cours' || !Number.isFinite(c.cible_s) || c.echeances_signalees > 0) continue;
      const r = restant(c, maintenant);
      if (r <= 0) {
        c.echeances_signalees = 1;
        franchies.push({ id: c.id, alerte: this.definition(c.id)?.alerte ?? 'aucune', depassementMs: -r });
      }
    }
    if (franchies.length > 0) {
      this.journaliser('rattrapage', { echeances: franchies.map((f) => ({ id: f.id, depassement_s: Math.floor(f.depassementMs / 1000) })) });
      this.ecrire();
      this.onRattrapage({ franchies });
    }
    return franchies;
  }
}

/** « échéance dépassée de mm:ss » (bandeau de rattrapage, jamais un voile). */
export function texteDepassement(ms) { return `échéance dépassée de ${formaterDuree(ms)}`; }
