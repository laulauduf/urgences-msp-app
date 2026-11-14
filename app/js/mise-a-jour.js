// Service worker : enregistrement, vérification d'intégrité du cache, mises à jour (cahier des charges 2.3 et 2.4).
// Règle centrale : JAMAIS de mise à jour pendant une intervention (pas de rechargement automatique, pas de skipWaiting forcé).
import { lireFicheOuverte } from './indicateur.js';

/** États possibles d'une mise à jour. */
export const ETATS_MAJ = {
  aucune: 'aucune',
  disponible: 'disponible',          // une nouvelle version est prête et aucune fiche n'est ouverte : « Nouvelle version disponible — Recharger »
  attenteFiche: 'attente-fiche',     // une version attend, ou n'a pas pu s'installer, parce qu'une fiche est ouverte : « Mise à jour en attente »
};

let enregistrement = null;
let rechargementDemande = false;

/** Vérifie que TOUS les fichiers de la liste sont dans le cache de la version courante (lit le contenu, pas seulement les noms). */
export async function verifierCache() {
  const liste = self.URGENCES_LISTE_CACHE;
  const version = self.URGENCES_VERSION;
  if (!Array.isArray(liste) || !version || typeof caches === 'undefined') return { complet: false, manquants: ['liste ou cache indisponible'] };
  try {
    if (!(await caches.has(`urgences-${version}`))) return { complet: false, manquants: ['cache absent'] };
    const cache = await caches.open(`urgences-${version}`);
    const manquants = [];
    for (const chemin of liste) {
      const reponse = await cache.match(new URL(chemin, document.baseURI).href);
      if (!reponse) manquants.push(chemin);
    }
    return { complet: manquants.length === 0, manquants };
  } catch {
    return { complet: false, manquants: ['lecture du cache impossible'] };
  }
}

/** État de mise à jour d'après le service worker en attente et l'indicateur « fiche ouverte ». */
async function etatMiseAJour({ installeRejetee = false } = {}) {
  const ficheOuverte = await lireFicheOuverte();
  if (enregistrement?.waiting) return ficheOuverte ? ETATS_MAJ.attenteFiche : ETATS_MAJ.disponible;
  if (installeRejetee && ficheOuverte) return ETATS_MAJ.attenteFiche;
  return ETATS_MAJ.aucune;
}

/**
 * Enregistre le service worker.
 * @param {{onEtat?: (etat: string) => void, onPret?: () => void}} rappels
 *   onEtat : appelé à chaque changement d'état de mise à jour ; onPret : appelé quand le service worker est installé et actif.
 * @returns {Promise<{pris: boolean}>} pris = le navigateur gère les service workers
 */
export async function enregistrer({ onEtat = () => {}, onPret = () => {} } = {}) {
  if (!('serviceWorker' in navigator)) return { pris: false };
  try {
    // updateViaCache « none » : le fichier sw.js et ses scripts importés sont toujours redemandés au serveur
    enregistrement = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
  } catch {
    return { pris: false };
  }
  const signaler = async (options) => onEtat(await etatMiseAJour(options));
  const suivre = (travailleur) => {
    travailleur.addEventListener('statechange', () => {
      if (travailleur.state === 'installed') signaler();
      // « redundant » sans être passé par « installed » = installation refusée (fiche ouverte, ou fichier manquant)
      if (travailleur.state === 'redundant' && enregistrement.waiting === null) signaler({ installeRejetee: true });
    });
  };
  if (enregistrement.installing) suivre(enregistrement.installing);
  enregistrement.addEventListener('updatefound', () => { if (enregistrement.installing) suivre(enregistrement.installing); });
  navigator.serviceWorker.ready.then(onPret);
  // quand la page retrouve le premier plan, on laisse le navigateur chercher une nouvelle version (jamais d'activation forcée)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') enregistrement.update().catch(() => {}); });
  await signaler();
  return { pris: true };
}

/** « Vérifier les mises à jour » (écran À propos, lot L9). Sans effet pendant une intervention. */
export async function verifierMisesAJour() {
  if (!enregistrement) return ETATS_MAJ.aucune;
  const ficheOuverte = await lireFicheOuverte();
  try { await enregistrement.update(); } catch { /* hors ligne : rien à signaler */ }
  if (enregistrement.waiting) return ficheOuverte ? ETATS_MAJ.attenteFiche : ETATS_MAJ.disponible;
  return ficheOuverte ? ETATS_MAJ.attenteFiche : ETATS_MAJ.aucune;
}

/**
 * « Recharger » : active la version en attente puis recharge la page. À n'appeler que sur un geste de l'utilisateur et sans fiche
 * ouverte : le service worker refuse lui-même s'il reste une fiche ouverte.
 */
export async function activerNouvelleVersion() {
  if (!enregistrement?.waiting || (await lireFicheOuverte())) return false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (rechargementDemande) return;
    rechargementDemande = true;
    location.reload();
  });
  enregistrement.waiting.postMessage({ type: 'activer' });
  return true;
}
