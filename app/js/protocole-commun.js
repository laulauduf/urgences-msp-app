// Checklists de l'écran « Autre situation » : la conduite COMMUNE (décision D-51, `protocoles/urgence-commune.json`) et les conduites propres à une urgence (phase 4 : douleur thoracique,
// AVC, anaphylaxie, hypoglycémie). Même format que l'ACR mais SANS cycle ni métronome. Aucun contenu médical ici : ce module ne fait que (1) savoir si un fichier est publié, (2) le charger
// sans bruit, (3) préfixer ses identifiants d'étape.
//
// POINT D'EXTENSION TOLÉRANT À L'ABSENCE : tant qu'un fichier n'est pas dans la liste de cache (`app/js/liste-cache.js`, générée par `outils/preparer-version.mjs` à partir des fichiers
// publiés), AUCUNE requête n'est faite — donc ni 404, ni erreur de console — et l'écran s'affiche sans checklist. Le jour où le fichier est publié, la liste de cache le contient et il se
// charge tout seul : rien d'autre à changer dans le code.
import { chargerProtocole } from './protocole.js';

export const ID_COMMUN = 'urgence-commune';
/**
 * Préfixe des identifiants d'étape de la conduite COMMUNE dans `fiche.checklist` (même objet que l'ACR). Il rend toute collision avec les identifiants de l'ACR impossible, sans rien demander
 * au rédacteur du protocole. La copie gardée dans `fiche.protocoles_utilises` reste, elle, telle que publiée (sans préfixe).
 */
export const PREFIXE_COMMUN = 'commun:';

/** Préfixe des identifiants d'une conduite : « commun: » pour la conduite commune (inchangé), « <id du protocole>: » pour les autres — deux conduites ne se confondent jamais dans `fiche.checklist`. */
export function prefixeDe(idProtocole = ID_COMMUN) { return idProtocole === ID_COMMUN ? PREFIXE_COMMUN : `${idProtocole}:`; }

/** Le fichier d'un protocole est-il publié ? Oui seulement s'il figure dans la liste de cache (script classique `liste-cache.js`). Sans liste (tests unitaires) : non. */
export function protocolePublie(idProtocole, liste = globalThis.URGENCES_LISTE_CACHE) {
  return Array.isArray(liste) && liste.includes(`protocoles/${idProtocole}.json`);
}

/** La conduite commune est-elle publiée ? */
export function communPublie(liste = globalThis.URGENCES_LISTE_CACHE) { return protocolePublie(ID_COMMUN, liste); }

/** Copie du protocole dont les identifiants d'étape (et de parent) portent le préfixe. Fonction pure ; le protocole d'origine n'est pas modifié. */
export function prefixerProtocole(protocole, prefixe = PREFIXE_COMMUN) {
  const pre = (id) => (typeof id === 'string' ? `${prefixe}${id}` : id);
  return {
    ...protocole,
    etapes: (Array.isArray(protocole?.etapes) ? protocole.etapes : []).map((e) => ({ ...e, id: pre(e.id), parent: typeof e.parent === 'string' ? pre(e.parent) : e.parent })),
  };
}

/**
 * Charge une conduite (la commune par défaut). Ne lève jamais d'exception ; ne fait AUCUNE requête si le fichier n'est pas publié.
 * @returns {Promise<{ok: true, protocole: object} | {ok: false, absent: boolean, raisons: string[]}>}
 */
export async function chargerProtocoleCommun({ liste, id = ID_COMMUN } = {}) {
  if (!protocolePublie(id, liste)) return { ok: false, absent: true, raisons: [] };
  const r = await chargerProtocole(id, { premierEcranRequis: false });
  return r.ok ? r : { ok: false, absent: false, raisons: r.raisons };
}
