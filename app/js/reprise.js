// Règles de reprise au lancement (cahier des charges 2.8). Fonction PURE : elle reçoit des RÉSUMÉS de fiches (jamais leur contenu).

/**
 * Quelle fiche reprendre d'elle-même au lancement ? Aucune, ou UNE seule.
 * Reprise directe seulement si TOUTES les conditions sont réunies :
 *  - fiche réelle (une simulation n'est jamais reprise d'elle-même) ;
 *  - non terminée (`en_cours`) ;
 *  - dernière activité il y a moins de `repriseMaxH` heures — PROVISOIRE (Q-26) ;
 *  - l'utilisateur n'a encore rien touché sur l'accueil (un toucher sur URGENCE gagne toujours).
 * @param {{resumes: object[], maintenant: number, repriseMaxH?: number, accueilTouche?: boolean}} entree
 * @returns {object|null} le résumé de la fiche à reprendre
 */
export function choisirReprise({ resumes, maintenant, repriseMaxH = 2, accueilTouche = false }) {
  if (accueilTouche) return null;
  const limite = repriseMaxH * 3600 * 1000;
  const eligibles = resumes.filter((r) => r.mode === 'reel' && r.etat === 'en_cours' && maintenant - r.derniere_activite >= 0 && maintenant - r.derniere_activite < limite);
  if (eligibles.length === 0) return null;
  return eligibles.reduce((a, b) => (b.derniere_activite > a.derniere_activite ? b : a));
}

/**
 * Lignes « fiches en attente » de l'accueil : tout ce qui n'est pas repris directement.
 * Les fiches réelles d'abord (la plus récente en haut), puis les simulations en pause.
 */
export function fichesEnAttente({ resumes, reprise }) {
  const autres = resumes.filter((r) => !reprise || r.id !== reprise.id);
  const tri = (a, b) => b.derniere_activite - a.derniere_activite;
  return [...autres.filter((r) => r.mode === 'reel').sort(tri), ...autres.filter((r) => r.mode === 'simulation').sort(tri)];
}
