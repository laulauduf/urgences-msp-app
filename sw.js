/* sw.js — service worker de l'appli (script CLASSIQUE ; cahier des charges 2.3 et 2.4).

   Règles :
   - pré-mise en cache de TOUTE la liste (app/js/liste-cache.js, générée) à l'installation ; l'installation échoue si un fichier manque ;
   - « cache d'abord » pour les fichiers de la liste ; aucune autre réponse n'est mise en cache, jamais (aucune donnée de fiche ne doit
     pouvoir atterrir dans le Cache Storage) ; une adresse hors liste ne passe pas par ce script ;
   - AUCUNE mise à jour pendant une intervention : pas de skipWaiting automatique ; l'installation d'une nouvelle version ÉCHOUE
     volontairement tant que l'indicateur « fiche_ouverte » est vrai (le navigateur la retentera plus tard) ;
   - l'activation d'une version en attente n'a lieu que sur demande de la page (message « activer »), et seulement sans fiche ouverte.

   CONTRAT avec le stockage (lot L3, stockage.js) : base IndexedDB « urgences-reglages », magasin « reglages », clé « fiche_ouverte »,
   valeur booléenne (true = au moins une fiche non clôturée). Aucune donnée patient dans cet indicateur. Ici on LIT seulement, et
   sans jamais créer la base. */
importScripts('app/js/version.js', 'app/js/liste-cache.js');

const PREFIXE_CACHE = 'urgences-';
const NOM_CACHE = PREFIXE_CACHE + self.URGENCES_VERSION;
const BASE = new URL('./', self.location.href).href;
const URLS = self.URGENCES_LISTE_CACHE.map((chemin) => new URL(chemin, BASE).href);
const URLS_CONNUES = new Set(URLS);
const INDEX = new URL('index.html', BASE).href;

/** Lit l'indicateur « fiche_ouverte ». En cas de doute (base absente, erreur, réponse trop lente) : faux. */
function ficheOuverte() {
  return new Promise((resoudre) => {
    const fin = (valeur) => { clearTimeout(minuteur); resoudre(valeur); };
    const minuteur = setTimeout(() => resoudre(false), 3000);
    let requete;
    try { requete = indexedDB.open('urgences-reglages'); } catch { return fin(false); }
    // Sans version, open() crée la base si elle n'existe pas : on annule cette création (sinon le lot L3 trouverait une base vide).
    requete.onupgradeneeded = () => { try { requete.transaction.abort(); } catch { /* rien */ } };
    requete.onerror = () => fin(false);
    requete.onblocked = () => fin(false);
    requete.onsuccess = () => {
      const base = requete.result;
      try {
        if (!base.objectStoreNames.contains('reglages')) { base.close(); return fin(false); }
        const lecture = base.transaction('reglages', 'readonly').objectStore('reglages').get('fiche_ouverte');
        lecture.onsuccess = () => { base.close(); fin(lecture.result === true); };
        lecture.onerror = () => { base.close(); fin(false); };
      } catch { try { base.close(); } catch { /* rien */ } fin(false); }
    };
  });
}

self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    // Parade 1 (2.4) : pas d'installation d'une nouvelle version tant qu'une fiche est ouverte. Sans version déjà active
    // (tout premier lancement), on installe toujours.
    if (self.registration.active && await ficheOuverte()) {
      throw new Error('Mise à jour reportée : une fiche est ouverte.');
    }
    try {
      const cache = await caches.open(NOM_CACHE);
      // « reload » : on veut les fichiers du serveur, jamais une copie du cache HTTP du navigateur.
      await cache.addAll(URLS.map((url) => new Request(url, { cache: 'reload' })));
    } catch (erreur) {
      await caches.delete(NOM_CACHE); // pas de cache à moitié rempli
      throw erreur;
    }
  })());
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((n) => n.startsWith(PREFIXE_CACHE) && n !== NOM_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  const cle = url.origin + url.pathname; // sans paramètres de recherche ni fragment
  if (!URLS_CONNUES.has(cle)) return;    // hors liste (blob:, data:, autre chemin…) : le réseau, comme si ce script n'existait pas
  evenement.respondWith((async () => {
    const copie = await caches.match(cle, { cacheName: NOM_CACHE });
    if (copie) return copie;
    if (requete.mode === 'navigate') {
      const accueil = await caches.match(INDEX, { cacheName: NOM_CACHE });
      if (accueil) return accueil;
    }
    return fetch(requete);
  })());
});

self.addEventListener('message', (evenement) => {
  const message = evenement.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'version' && evenement.source) {
    evenement.source.postMessage({ type: 'version', version: self.URGENCES_VERSION, empreinte: self.URGENCES_EMPREINTE });
  }
  if (message.type === 'activer') {
    // Demandé par la page (geste de l'utilisateur) ; refusé s'il reste une fiche ouverte.
    evenement.waitUntil((async () => { if (!(await ficheOuverte())) await self.skipWaiting(); })());
  }
});
