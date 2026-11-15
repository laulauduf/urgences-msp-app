// Checklist COMMUNE de l'écran « Autre situation » (décision D-51) : un second protocole, `protocoles/urgence-commune.json`, même format que l'ACR mais SANS cycle, SANS DAE.
// Aucun contenu médical ici : ce module ne fait que (1) savoir si le fichier est publié, (2) le charger sans bruit, (3) préfixer ses identifiants d'étape.
//
// POINT D'EXTENSION TOLÉRANT À L'ABSENCE : tant que le fichier n'est pas dans la liste de cache (`app/js/liste-cache.js`, générée par `outils/preparer-version.mjs` à
// partir des fichiers publiés), AUCUNE requête n'est faite — donc ni 404, ni erreur de console — et l'écran « Autre situation » s'affiche sans checklist.
// Le jour où le fichier est publié, la liste de cache le contient et il se charge tout seul : rien d'autre à changer dans le code.
import { chargerProtocole } from './protocole.js';

export const ID_COMMUN = 'urgence-commune';
/**
 * Préfixe des identifiants d'étape de la checklist commune DANS `fiche.checklist` (même objet que l'ACR). Il rend toute collision avec les identifiants de l'ACR
 * impossible, sans rien demander au rédacteur du protocole. La copie gardée dans `fiche.protocoles_utilises` reste, elle, telle que publiée (sans préfixe).
 */
export const PREFIXE_COMMUN = 'commun:';

/** Le fichier est-il publié ? Oui seulement s'il figure dans la liste de cache (script classique `liste-cache.js`). Sans liste (tests unitaires) : non. */
export function communPublie(liste = globalThis.URGENCES_LISTE_CACHE) {
  return Array.isArray(liste) && liste.includes(`protocoles/${ID_COMMUN}.json`);
}

/** Copie du protocole dont les identifiants d'étape (et de parent) portent le préfixe. Fonction pure ; le protocole d'origine n'est pas modifié. */
export function prefixerProtocole(protocole) {
  const prefixe = (id) => (typeof id === 'string' ? `${PREFIXE_COMMUN}${id}` : id);
  return {
    ...protocole,
    etapes: (Array.isArray(protocole?.etapes) ? protocole.etapes : []).map((e) => ({ ...e, id: prefixe(e.id), parent: typeof e.parent === 'string' ? prefixe(e.parent) : e.parent })),
  };
}

/**
 * Charge la checklist commune. Ne lève jamais d'exception ; ne fait AUCUNE requête si le fichier n'est pas publié.
 * @returns {Promise<{ok: true, protocole: object} | {ok: false, absent: boolean, raisons: string[]}>}
 */
export async function chargerProtocoleCommun({ liste } = {}) {
  if (!communPublie(liste)) return { ok: false, absent: true, raisons: [] };
  const r = await chargerProtocole(ID_COMMUN, { premierEcranRequis: false });
  return r.ok ? r : { ok: false, absent: false, raisons: r.raisons };
}
