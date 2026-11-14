// Détection du mode « installé » (cahier des charges 2.8, 4.1). Fonctions pures : testables sans navigateur.

/** Vrai sur iPhone, iPad et iPod (y compris un iPad qui se présente comme un Mac : écran tactile). */
export function estAppareilApple({ userAgent = '', plateforme = '', pointsTactiles = 0 } = {}) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return plateforme === 'MacIntel' && pointsTactiles > 1;
}

/** Vrai si l'appli tourne comme une appli installée (ouverte depuis son icône), pas dans un onglet. */
export function estInstallee({ navigatorStandalone = false, affichageStandalone = false } = {}) {
  return navigatorStandalone === true || affichageStandalone === true;
}

/**
 * Faut-il le bandeau rouge « Installez l'appli » ? Seulement sur un appareil Apple, hors appli installée :
 * le stockage de Safari peut y être purgé après 7 jours sans interaction (cahier des charges 2.8, DOC étude § 6).
 */
export function bandeauInstallationNecessaire(entree) {
  return estAppareilApple(entree) && !estInstallee(entree);
}

export const TEXTE_BANDEAU_INSTALLATION = "Installez l'appli et ouvrez-la depuis son icône";

/** Lit l'environnement réel du navigateur. */
export function lireEnvironnement() {
  return {
    userAgent: navigator.userAgent,
    plateforme: navigator.platform,
    pointsTactiles: navigator.maxTouchPoints,
    navigatorStandalone: navigator.standalone === true,
    affichageStandalone: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  };
}
