// Indicateur « fiche_ouverte » (cahier des charges 2.4, parade 1) : vrai tant qu'une fiche non clôturée existe.
// CONTRAT partagé avec sw.js (qui le LIT à l'installation d'une nouvelle version) et avec le lot L3 (stockage.js, qui l'ÉCRIT) :
//   base IndexedDB « urgences-reglages » (version 1), magasin « reglages », clé « fiche_ouverte », valeur booléenne.
// Aucune donnée patient dans cet indicateur. Ce module n'ouvre jamais la base en lecture si elle n'existe pas (pour ne pas la créer
// vide : stockage.js la crée avec ses magasins).
export const BASE_REGLAGES = 'urgences-reglages';
export const MAGASIN_REGLAGES = 'reglages';
export const CLE_FICHE_OUVERTE = 'fiche_ouverte';

function ouvrir({ creer }) {
  return new Promise((resoudre) => {
    let requete;
    try { requete = creer ? indexedDB.open(BASE_REGLAGES, 1) : indexedDB.open(BASE_REGLAGES); } catch { return resoudre(null); }
    requete.onupgradeneeded = () => {
      if (creer) { if (!requete.result.objectStoreNames.contains(MAGASIN_REGLAGES)) requete.result.createObjectStore(MAGASIN_REGLAGES); }
      else { try { requete.transaction.abort(); } catch { /* la base n'existe pas : ne pas la créer */ } }
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => resoudre(null);
    requete.onblocked = () => resoudre(null);
  });
}

/** Lit l'indicateur. En cas d'erreur ou de base absente : false. Ne lève jamais. */
export async function lireFicheOuverte() {
  const base = await ouvrir({ creer: false });
  if (!base) return false;
  try {
    if (!base.objectStoreNames.contains(MAGASIN_REGLAGES)) return false;
    return await new Promise((resoudre) => {
      const lecture = base.transaction(MAGASIN_REGLAGES, 'readonly').objectStore(MAGASIN_REGLAGES).get(CLE_FICHE_OUVERTE);
      lecture.onsuccess = () => resoudre(lecture.result === true);
      lecture.onerror = () => resoudre(false);
    });
  } catch { return false; } finally { base.close(); }
}

/** Écrit l'indicateur (le lot L3 s'en servira à la création et à la clôture des fiches). Renvoie true si l'écriture a réussi. */
export async function ecrireFicheOuverte(valeur) {
  const base = await ouvrir({ creer: true });
  if (!base) return false;
  try {
    return await new Promise((resoudre) => {
      const transaction = base.transaction(MAGASIN_REGLAGES, 'readwrite');
      transaction.objectStore(MAGASIN_REGLAGES).put(valeur === true, CLE_FICHE_OUVERTE);
      transaction.oncomplete = () => resoudre(true);
      transaction.onerror = () => resoudre(false);
      transaction.onabort = () => resoudre(false);
    });
  } catch { return false; } finally { base.close(); }
}
