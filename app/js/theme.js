// Thème clair / sombre / automatique (cahier des charges 5.2). Le choix est un petit réglage d'affichage NON sensible : il est aussi
// gardé dans localStorage (lecture synchrone) pour s'appliquer dès le premier affichage, sans clignotement. La valeur de référence
// reste celle de la base « urgences-reglages » (stockage.js).
const CLE = 'urgences-theme';
const VERS_ATTRIBUT = { clair: 'light', sombre: 'dark' };

/** Applique le thème : « auto » suit le réglage du téléphone (aucun attribut) ; « clair » et « sombre » forcent. */
export function appliquerTheme(valeur) {
  const racine = document.documentElement;
  if (VERS_ATTRIBUT[valeur]) racine.dataset.theme = VERS_ATTRIBUT[valeur];
  else delete racine.dataset.theme;
  try { if (valeur === 'auto' || !VERS_ATTRIBUT[valeur]) localStorage.removeItem(CLE); else localStorage.setItem(CLE, valeur); } catch { /* localStorage indisponible : sans importance */ }
}

/** Thème mémorisé localement (lecture synchrone), « auto » à défaut. */
export function themeLocal() {
  try { const v = localStorage.getItem(CLE); return VERS_ATTRIBUT[v] ? v : 'auto'; } catch { return 'auto'; }
}
