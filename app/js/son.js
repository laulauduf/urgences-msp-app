// Son : déblocage, métronome, alertes (cahier des charges 2.6, 4.9, 5.4, 5.5).
//
// CONTRAINTES (étude technique § 3) : sur iPhone le mode silencieux coupe par défaut le son Web Audio ; plusieurs bugs ouverts rendent le
// son muet après un retour d'arrière-plan ; AUCUNE API ne dit si le son sort vraiment. L'appli l'avoue (avertissement permanent) et ne
// compte jamais sur le son seul : le repère VISUEL du métronome est indépendant et continue sur son horloge propre quand le son s'arrête.
//
// MÉTRONOME : boucle exacte (AudioBuffer de N battements, `loop = true`) cadencée par le matériel audio, insensible au ralentissement des
// minuteurs. N = f / pgcd(f, 60) : la boucle dure 60 / pgcd(f, 60) secondes, un nombre ENTIER de secondes donc d'échantillons. Jamais
// `setInterval` pour le rythme. Q-11 (continu ou adapté au 30:2) n'est pas tranchée : continu avec pause manuelle, PROVISOIRE ; le
// passage à une planification « lookahead » (qui sait faire des pauses programmées) ne changerait que ce fichier.
//
// Aucune valeur médicale ici : la fréquence vient du protocole (horloge.js, lireMetronome).

export const AVERTISSEMENT_SON = 'Son non vérifiable : vérifiez le mode silencieux et le volume média';
export const BANDEAU_SON_ARRETE = "Son arrêté : touchez l'écran pour le reprendre";
export const MENTION_VISUEL_SEUL = 'Son arrêté — métronome visuel seul';

const pgcd = (a, b) => (b === 0 ? a : pgcd(b, a % b));

/**
 * Paramètres de la boucle exacte pour une fréquence (battements par minute).
 * Entière : N = f / pgcd(f, 60) battements en 60 / pgcd(f, 60) secondes. Décimale : même calcul sur f × 10.
 * @returns {{battements: number, dureeS: number}}
 */
export function parametresBoucle(frequence) {
  if (!Number.isFinite(frequence) || frequence <= 0) throw new Error(`fréquence invalide : ${frequence}`);
  const k = Number.isInteger(frequence) ? 1 : 10;
  const F = Math.round(frequence * k);
  const g = pgcd(F, 60 * k);
  return { battements: F / g, dureeS: (60 * k) / g };
}

/**
 * Fabrique les échantillons de la boucle : un clic bref (sinus décroissant) à chaque battement, positions arrondies à l'échantillon.
 * Fonction PURE, testable sous Node.
 * @returns {{donnees: Float32Array, battements: number, dureeS: number, echantillons: number, indices: number[], memoireMo: number}}
 */
export function genererBoucle({ frequence, sampleRate }) {
  const { battements, dureeS } = parametresBoucle(frequence);
  const echantillons = Math.round(dureeS * sampleRate);
  const donnees = new Float32Array(echantillons);
  const indices = [];
  const longueurClic = Math.min(Math.round(0.04 * sampleRate), Math.floor(echantillons / battements) - 1);
  for (let k = 0; k < battements; k++) {
    const debut = Math.round((k * echantillons) / battements);
    indices.push(debut);
    for (let i = 0; i < longueurClic && debut + i < echantillons; i++) {
      donnees[debut + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * Math.exp((-6 * i) / longueurClic);
    }
  }
  return { donnees, battements, dureeS, echantillons, indices, memoireMo: (echantillons * 4) / 1e6 };
}

/** Branche la boucle sur un contexte audio (en ligne ou hors ligne, pour les tests). Renvoie la source ; l'appelant la démarre. */
export function construireMetronome(contexte, frequence, destination = contexte.destination) {
  const { donnees, ...meta } = genererBoucle({ frequence, sampleRate: contexte.sampleRate });
  const tampon = contexte.createBuffer(1, donnees.length, contexte.sampleRate);
  tampon.copyToChannel(donnees, 0);
  const source = contexte.createBufferSource();
  source.buffer = tampon;
  source.loop = true;
  source.connect(destination);
  return { source, meta };
}

/** Fichier WAV (mono, 16 bits) d'un bip : sert au canal de secours <audio>, qui ne prend jamais le métronome. Fonction PURE. */
export function genererWav({ frequence = 880, dureeS = 0.15, sampleRate = 22050, repetitions = 1, silenceS = 0.12 } = {}) {
  const unite = Math.round(dureeS * sampleRate);
  const pause = Math.round(silenceS * sampleRate);
  const total = repetitions * unite + (repetitions - 1) * pause;
  const octets = new Uint8Array(44 + total * 2);
  const vue = new DataView(octets.buffer);
  const ecrire = (offset, texte) => { for (let i = 0; i < texte.length; i++) vue.setUint8(offset + i, texte.charCodeAt(i)); };
  ecrire(0, 'RIFF'); vue.setUint32(4, 36 + total * 2, true); ecrire(8, 'WAVE'); ecrire(12, 'fmt ');
  vue.setUint32(16, 16, true); vue.setUint16(20, 1, true); vue.setUint16(22, 1, true);
  vue.setUint32(24, sampleRate, true); vue.setUint32(28, sampleRate * 2, true); vue.setUint16(32, 2, true); vue.setUint16(34, 16, true);
  ecrire(36, 'data'); vue.setUint32(40, total * 2, true);
  for (let r = 0; r < repetitions; r++) {
    for (let i = 0; i < unite; i++) {
      const enveloppe = Math.min(1, i / 200) * Math.min(1, (unite - i) / 400);
      vue.setInt16(44 + (r * (unite + pause) + i) * 2, Math.round(0.6 * enveloppe * Math.sin((2 * Math.PI * frequence * i) / sampleRate) * 32767), true);
    }
  }
  return octets;
}

const MOTIFS = {
  discrete: { bips: 1, vibration: [120] },
  forte: { bips: 3, vibration: [200, 100, 200, 100, 200] },
};

export class Son {
  /**
   * @param {{fabrique?: () => AudioContext, perf?: () => number, navigateur?: object, creerAudio?: (octets: Uint8Array) => HTMLAudioElement|null, onEtat?: (etat: object) => void, onBattement?: (b: object) => void}} options
   *   Tout est injectable : les tests fournissent un faux contexte audio et une horloge truquée.
   */
  constructor({ fabrique = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(), perf = () => performance.now(), navigateur = globalThis.navigator, creerAudio, onEtat = () => {}, onBattement = () => {} } = {}) {
    this.fabrique = fabrique; this.perf = perf; this.navigateur = navigateur;
    this.creerAudio = creerAudio ?? ((octets) => {
      if (typeof Audio === 'undefined' || typeof URL === 'undefined') return null;
      const a = new Audio(URL.createObjectURL(new Blob([octets], { type: 'audio/wav' })));
      a.preload = 'auto';
      return a;
    });
    this.onEtat = onEtat; this.onBattement = onBattement;
    this.ctx = null;
    this.metronome = { actif: false, frequence: null, source: null, tAudio0: null, indiceAudio: -1, total: -1, dernierBattementPerf: null, prochainPerf: null, modeAvant: null };
    this.secours = new Map();
  }

  // ───────── État ─────────

  /** « running », « suspended », « interrupted » (iOS), « closed » ou « absent » (pas encore débloqué). */
  etatContexte() { return this.ctx ? this.ctx.state : 'absent'; }

  /**
   * État du son pour l'interface : l'avertissement est PERMANENT (running ne prouve pas que le son sort, bug WebKit 291892) ;
   * le bandeau n'apparaît que si le contexte n'est pas « running » une fois débloqué.
   */
  etat() {
    const contexte = this.etatContexte();
    const arrete = contexte !== 'running' && contexte !== 'absent';
    const mode = this.metronome.actif ? (contexte === 'running' ? 'audio' : 'visuel') : null;
    return {
      contexte,
      avertissement: AVERTISSEMENT_SON,
      bandeau: arrete ? BANDEAU_SON_ARRETE : null,
      metronome: { actif: this.metronome.actif, frequence: this.metronome.frequence, mode, mention: mode === 'visuel' ? MENTION_VISUEL_SEUL : null },
    };
  }

  signaler() { try { this.onEtat(this.etat()); } catch { /* l'interface ne doit jamais casser le son */ } }

  // ───────── Déblocage ─────────

  /**
   * À appeler dans le GESTE de l'utilisateur (toucher URGENCE) : crée le contexte, le reprend, joue un son très court, et demande la
   * session audio « playback » (garde le son en mode silencieux depuis iOS 17, jamais « transient »). Ne lève jamais d'exception.
   */
  debloquer() {
    try { if (this.navigateur?.audioSession) this.navigateur.audioSession.type = 'playback'; } catch { /* non pris en charge */ }
    try {
      if (!this.ctx) {
        this.ctx = this.fabrique();
        this.ctx.addEventListener?.('statechange', () => this.surChangementEtat());
      }
      const reprise = this.ctx.resume?.();
      reprise?.catch?.(() => {});
      // un bruit très court (silencieux à l'oreille) : certains navigateurs ne débloquent l'audio qu'après un son joué
      const tampon = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const source = this.ctx.createBufferSource();
      source.buffer = tampon; source.connect(this.ctx.destination); source.start(0);
    } catch { /* pas de Web Audio : le repère visuel et les alertes visuelles restent */ }
    this.signaler();
    return this.etatContexte();
  }

  /**
   * Reprise d'une fiche après un rechargement (retour d'un appel `tel:` sur iPhone, fermeture forcée) : aucun geste n'a encore eu lieu, donc le
   * contexte audio ne peut pas être repris — mais on le CRÉE (suspendu, sans aucun bruit) pour que le bandeau « Son arrêté : touchez l'écran »
   * s'affiche tout de suite (2.6, 2.10, revue du 15/11/2026 M1). Le premier toucher le reprend (brancherReprise).
   */
  preparer() {
    try {
      if (!this.ctx) {
        this.ctx = this.fabrique();
        this.ctx.addEventListener?.('statechange', () => this.surChangementEtat());
      }
    } catch { /* pas de Web Audio : le repère visuel et les alertes visuelles restent */ }
    this.signaler();
  }

  /**
   * N'importe quel toucher relance l'audio s'il n'est pas « running » (retour d'arrière-plan) ; le toucher fait aussi son action normale.
   * Sans contexte (reprise après rechargement, aucun URGENCE touché dans cette page) : le premier toucher le DÉBLOQUE (M1).
   */
  brancherReprise(doc = document) {
    const surToucher = () => {
      if (!this.ctx) { this.debloquer(); return; }
      if (this.ctx.state !== 'running') this.ctx.resume?.()?.catch?.(() => {});
    };
    // capture, sans stopPropagation ni preventDefault : jamais un toucher « perdu »
    doc.addEventListener('pointerdown', surToucher, { capture: true, passive: true });
    doc.addEventListener('keydown', surToucher, { capture: true, passive: true });
    return () => { doc.removeEventListener('pointerdown', surToucher, { capture: true }); doc.removeEventListener('keydown', surToucher, { capture: true }); };
  }

  surChangementEtat() {
    // le contexte revient à « running » alors que le métronome devait sonner : on reconstruit la source (elle a pu être perdue)
    if (this.ctx?.state === 'running' && this.metronome.actif && !this.metronome.source) this.demarrerSource();
    this.signaler();
  }

  // ───────── Métronome ─────────

  demarrerSource() {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    try {
      const { source } = construireMetronome(this.ctx, this.metronome.frequence);
      const depart = this.ctx.currentTime + 0.05;
      source.start(depart);
      this.metronome.source = source;
      this.metronome.tAudio0 = depart; this.metronome.indiceAudio = -1;
      return true;
    } catch { this.metronome.source = null; return false; }
  }

  arreterSource() {
    try { this.metronome.source?.stop(); this.metronome.source?.disconnect(); } catch { /* déjà arrêtée */ }
    this.metronome.source = null; this.metronome.tAudio0 = null;
  }

  /** Démarre le métronome continu (Q-11 provisoire) : son si possible, repère visuel TOUJOURS. */
  demarrerMetronome(frequence) {
    this.arreterSource();
    const m = this.metronome;
    m.actif = true; m.frequence = frequence; m.indiceAudio = -1; m.total = -1; m.dernierBattementPerf = null; m.modeAvant = null;
    m.prochainPerf = this.perf(); // premier battement visuel tout de suite
    this.demarrerSource();
    this.signaler();
  }

  /** Pause manuelle (un toucher). Le métronome ne repart que par `reprendreMetronome`. */
  pauseMetronome() { this.arreterSource(); this.metronome.actif = false; this.signaler(); }

  reprendreMetronome() {
    if (this.metronome.frequence === null || this.metronome.actif) return;
    this.demarrerMetronome(this.metronome.frequence);
  }

  arreterMetronome() { this.pauseMetronome(); this.metronome.frequence = null; }

  /**
   * Cadence VISUELLE : à appeler à chaque image (requestAnimationFrame) avec `performance.now()`.
   * - contexte « running » : le repère est calé sur `AudioContext.currentTime` (synchronisé avec le son) ;
   * - sinon : le repère bat sur l'horloge propre (performance.now) à la fréquence du protocole — `currentTime` cesse d'avancer quand
   *   le contexte est suspendu ou interrompu, donc calé sur lui seul le repère s'arrêterait avec le son, quand il doit le remplacer.
   * Le passage d'un mode à l'autre ne double ni ne saute aucun battement : la phase est reprise du dernier battement émis.
   * @param {number} [maintenantPerf] performance.now() de l'image
   * @returns {number} nombre de battements émis à cette image
   */
  avancer(maintenantPerf = this.perf()) {
    const m = this.metronome;
    if (!m.actif || m.frequence === null) return 0;
    const periode = 60000 / m.frequence;
    const mode = this.ctx?.state === 'running' && m.source && m.tAudio0 !== null ? 'audio' : 'visuel';
    let emis = 0;
    if (mode === 'audio') {
      // l'indice audio suit l'horloge audio (compteur propre : il ne compte pas les battements visuels émis pendant une suspension)
      const indice = Math.floor(((this.ctx.currentTime - m.tAudio0) * m.frequence) / 60);
      if (indice > m.indiceAudio && indice >= 0) {
        m.indiceAudio = indice;
        // au retour du son, le premier battement audio peut tomber juste après un battement visuel : on ne le double pas
        if (m.dernierBattementPerf === null || maintenantPerf - m.dernierBattementPerf >= periode * 0.45) {
          m.total += 1; emis = 1; m.dernierBattementPerf = maintenantPerf;
          this.onBattement({ indice: m.total, source: 'audio', perf: maintenantPerf });
        }
        m.prochainPerf = m.dernierBattementPerf + periode; // la phase visuelle repart du dernier battement émis
      }
    } else {
      while (maintenantPerf >= m.prochainPerf) {
        m.total += 1; emis += 1; m.dernierBattementPerf = m.prochainPerf;
        this.onBattement({ indice: m.total, source: 'visuel', perf: m.prochainPerf });
        m.prochainPerf += periode;
      }
    }
    m.modeAvant = mode;
    return emis;
  }

  /** Boucle d'images réelle ; renvoie la fonction qui l'arrête. Les tests, eux, appellent `avancer` directement. */
  lancerBoucleVisuelle(demander = globalThis.requestAnimationFrame?.bind(globalThis), annuler = globalThis.cancelAnimationFrame?.bind(globalThis)) {
    let id = null; let arrete = false;
    const image = (t) => { if (arrete) return; this.avancer(t); id = demander(image); };
    id = demander(image);
    return () => { arrete = true; if (id !== null) annuler?.(id); };
  }

  // ───────── Alertes (UN SEUL canal à la fois) ─────────

  /**
   * Bip d'alerte. Contexte « running » → Web Audio ; sinon → élément <audio> de secours ; jamais les deux ensemble (superposition).
   * La vibration s'ajoute là où elle existe (Android après un premier toucher ; jamais sur iPhone).
   * @param {'discrete'|'forte'} intensite
   * @returns {{canal: 'webaudio'|'audio'|'aucun', vibration: boolean}}
   */
  jouerAlerte(intensite = 'discrete') {
    const motif = MOTIFS[intensite] ?? MOTIFS.discrete;
    let canal = 'aucun';
    if (this.ctx?.state === 'running') {
      try {
        const maintenant = this.ctx.currentTime;
        for (let i = 0; i < motif.bips; i++) {
          const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
          o.type = 'sine'; o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, maintenant + i * 0.27);
          g.gain.exponentialRampToValueAtTime(0.5, maintenant + i * 0.27 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, maintenant + i * 0.27 + 0.15);
          o.connect(g); g.connect(this.ctx.destination);
          o.start(maintenant + i * 0.27); o.stop(maintenant + i * 0.27 + 0.2);
        }
        canal = 'webaudio';
      } catch { canal = 'aucun'; }
    }
    if (canal === 'aucun') {
      try {
        let a = this.secours.get(intensite);
        if (!a) { a = this.creerAudio(genererWav({ repetitions: motif.bips })); if (a) this.secours.set(intensite, a); }
        if (a) { a.currentTime = 0; const lecture = a.play?.(); lecture?.catch?.(() => {}); canal = 'audio'; }
      } catch { canal = 'aucun'; }
    }
    let vibration = false;
    try { vibration = typeof this.navigateur?.vibrate === 'function' ? this.navigateur.vibrate(motif.vibration) === true : false; } catch { vibration = false; }
    return { canal, vibration };
  }

  /** « Tester le son » : un bip d'alerte, et ce que le téléphone dit de lui-même. Jamais bloquant. */
  tester() {
    this.debloquer();
    const alerte = this.jouerAlerte('discrete');
    return { contexte: this.etatContexte(), canal: alerte.canal, vibration: alerte.vibration, audioSession: Boolean(this.navigateur?.audioSession), avertissement: AVERTISSEMENT_SON };
  }
}
