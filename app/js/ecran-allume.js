// Écran allumé (cahier des charges 2.5) : pendant le massage personne ne touche le téléphone ; si l'écran s'éteint, l'appli est gelée
// (métronome et alertes compris). Verrou d'écran (Wake Lock) demandé SANS attendre sa réponse, redemandé au retour au premier plan et
// au toucher suivant, et avertissement VISIBLE (pas discret) quand il manque, est refusé ou est relâché.
// La technique de la vidéo muette en boucle n'est pas retenue (bugs vidéo ouverts sur iOS 26, SUPPOSÉ).

export const TEXTE_ECRAN = "Écran : il peut s'éteindre — réglez le verrouillage automatique sur Jamais";

export class EcranAllume {
  /** @param {{navigateur?: object, onEtat?: (etat: object) => void}} options */
  constructor({ navigateur = globalThis.navigator, onEtat = () => {} } = {}) {
    this.navigateur = navigateur; this.onEtat = onEtat;
    this.sentinelle = null; this.actif = false; this.enCours = false; this.demande = false; this.raison = null;
  }

  get priseEnCharge() { return Boolean(this.navigateur?.wakeLock && typeof this.navigateur.wakeLock.request === 'function'); }

  /** `avertissement` est non nul quand une demande a ABOUTI sans verrou (absent, refusé, relâché) : pas pendant la demande en cours. */
  etat() {
    const manque = this.demande && !this.actif && !this.enCours;
    return { priseEnCharge: this.priseEnCharge, actif: this.actif, raison: this.raison, avertissement: manque ? TEXTE_ECRAN : null };
  }

  signaler() { try { this.onEtat(this.etat()); } catch { /* l'interface ne doit jamais casser le verrou */ } }

  /**
   * Demande le verrou. L'appelant NE l'attend PAS pour afficher l'écran suivant. Ne lève jamais d'exception.
   * @returns {Promise<boolean>} vrai si le verrou est tenu
   */
  async demander() {
    this.demande = true;
    if (this.actif) return true;
    if (!this.priseEnCharge) { this.raison = 'non_pris_en_charge'; this.signaler(); return false; }
    if (this.enCours) return false;
    this.enCours = true;
    try {
      const sentinelle = await this.navigateur.wakeLock.request('screen');
      if (!this.demande) { try { await sentinelle.release?.(); } catch { /* rien */ } return false; }   // liberer() est passé pendant la demande : on rend aussitôt le verrou obtenu
      this.sentinelle = sentinelle; this.actif = true; this.raison = null;
      // le verrou est relâché quand l'appli passe en arrière-plan, en économie de batterie, etc. : on l'écoute
      sentinelle.addEventListener?.('release', () => { if (this.sentinelle === sentinelle) { this.actif = false; this.sentinelle = null; this.raison = 'relache'; this.signaler(); } });
    } catch (erreur) {
      this.actif = false; this.sentinelle = null; this.raison = erreur?.name === 'NotAllowedError' ? 'refuse' : 'erreur';
    } finally {
      this.enCours = false;
    }
    this.signaler();
    return this.actif;
  }

  /** Nouvelle demande au retour au premier plan et au TOUCHER SUIVANT, quel qu'il soit, tant que le verrou n'est pas tenu. */
  brancher(doc = document) {
    const auRetour = () => { if (doc.visibilityState === 'visible' && this.demande && !this.actif) this.demander(); };
    const auToucher = () => { if (this.demande && !this.actif) this.demander(); };
    doc.addEventListener('visibilitychange', auRetour);
    doc.addEventListener('pointerdown', auToucher, { capture: true, passive: true });
    return () => { doc.removeEventListener('visibilitychange', auRetour); doc.removeEventListener('pointerdown', auToucher, { capture: true }); };
  }

  async liberer() {
    const s = this.sentinelle;
    this.demande = false; this.actif = false; this.sentinelle = null;
    try { await s?.release?.(); } catch { /* déjà relâché */ }
    this.signaler();
  }

  /**
   * Contrôle préalable (premier lancement, « Tester le son et l'écran ») : demande un verrou d'essai puis le rend.
   * @returns {Promise<{priseEnCharge: boolean, accorde: boolean, raison: string|null, avertissement: string|null}>}
   */
  async controler() {
    if (!this.priseEnCharge) return { priseEnCharge: false, accorde: false, raison: 'non_pris_en_charge', avertissement: TEXTE_ECRAN };
    try {
      const s = await this.navigateur.wakeLock.request('screen');
      try { await s.release?.(); } catch { /* rien */ }
      return { priseEnCharge: true, accorde: true, raison: null, avertissement: null };
    } catch (erreur) {
      return { priseEnCharge: true, accorde: false, raison: erreur?.name === 'NotAllowedError' ? 'refuse' : 'erreur', avertissement: TEXTE_ECRAN };
    }
  }
}
