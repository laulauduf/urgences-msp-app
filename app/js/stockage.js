// Stockage local (cahier des charges 2.4, 2.8, 2.9, 3.3, 4.11) : trois bases IndexedDB, mode réel / simulation, écriture APRÈS l'affichage,
// mode dégradé en mémoire, reprise, purge, effacement fiche par fiche vérifié, réinitialisation.
//
// RÈGLES DE FOND
//  - On affiche d'abord, on écrit ensuite : aucune fonction qui crée ou modifie une fiche n'attend IndexedDB ; l'état vit en mémoire.
//  - IndexedDB lent, bloqué ou en erreur : l'intervention continue en mémoire (événement « degrade »), nouvel essai à chaque changement.
//    AUCUN repli vers localStorage pour les données de la fiche.
//  - Une fiche lue dans une base doit porter le mode de cette base (reel / simulation), sinon elle n'est pas ouverte.
//  - L'effacement ne rouvre JAMAIS une base pour la vérifier (ce qui la recréerait vide) : il vérifie par `indexedDB.databases()`.
//
// CONTRAT avec sw.js (lot L2) : base « urgences-reglages », magasin « reglages », clé « fiche_ouverte » (booléen), écrite ici.
import { creerFiche, ajouterJournal, verifierFiche, resumer, migrerFiche, TYPES_CRITIQUES } from './fiche.js';
import { decisionPurge, delaiEffectif, SurveillanceHorloge, PLANCHER_DEFAUT_H, DELAI_DEFAUT_H } from './purge.js';
import { choisirReprise, fichesEnAttente } from './reprise.js';

export const BASES = { reel: 'urgences-fiches', simulation: 'urgences-simulation', reglages: 'urgences-reglages' };
const MAGASIN_FICHES = 'fiches';
const MAGASIN_REGLAGES = 'reglages';

/** Valeurs par défaut des réglages de l'appareil (4.13, 2.8). `profession: null` = non réglée (comportement du groupe le plus restreint, Q-22/Q-30). */
export const REGLAGES_PAR_DEFAUT = Object.freeze({
  profession: null,
  delai_effacement_h: DELAI_DEFAUT_H,
  theme: 'auto',
  mode_affichage: 'expert',
  champs_sensibles: {},
});
const CLES_REGLAGES = Object.keys(REGLAGES_PAR_DEFAUT);

/**
 * @param {{idb?: () => IDBFactory, maintenant?: () => number, delaiOuvertureMs?: number, delaiEcritureMs?: number, regroupementMs?: number}} options
 *   `idb` : fournisseur de la fabrique IndexedDB (lu à chaque appel, pour que les tests puissent la remplacer).
 */
export function creerStockage({
  idb = () => globalThis.indexedDB,
  maintenant = () => Date.now(),
  delaiOuvertureMs = 1500,
  delaiEcritureMs = 3000,
  regroupementMs = 1000,
} = {}) {
  const connexions = {};
  const ouvertures = {};
  const suivi = new Map();        // id → { fiche, mode, sale, minuteur, promesse, efface }
  const nonEnregistrees = new Set();
  const auditeurs = new Set();
  const reportees = new Set();
  let reglagesCache = null;
  let afficheeId = null;
  let purgeFaite = false;
  let resoudrePurge;
  const purgeTerminee = new Promise((r) => { resoudrePurge = r; });
  let surveillance = new SurveillanceHorloge();
  let config = { plancherH: PLANCHER_DEFAUT_H, repriseMaxH: 2 };
  let minuteurPeriodique = null;

  const emettre = (type, detail = {}) => { for (const f of auditeurs) { try { f({ type, ...detail }); } catch { /* un auditeur fautif ne doit rien casser */ } } };
  const avecDelai = (promesse, ms, message) => new Promise((resoudre, rejeter) => {
    const t = setTimeout(() => rejeter(new Error(message)), ms);
    promesse.then((v) => { clearTimeout(t); resoudre(v); }, (e) => { clearTimeout(t); rejeter(e); });
  });

  // ───────── Connexions ─────────

  function ouvrir(nom) {
    if (connexions[nom]) return Promise.resolve(connexions[nom]);
    if (ouvertures[nom]) return ouvertures[nom];
    const promesse = new Promise((resoudre) => {
      let fini = false;
      const fin = (db) => { if (!fini) { fini = true; clearTimeout(minuteur); resoudre(db); } };
      const minuteur = setTimeout(() => fin(null), delaiOuvertureMs);
      let requete;
      try { requete = idb().open(nom, 1); } catch { fin(null); return; }
      requete.onupgradeneeded = () => {
        const db = requete.result;
        if (nom === BASES.reglages) { if (!db.objectStoreNames.contains(MAGASIN_REGLAGES)) db.createObjectStore(MAGASIN_REGLAGES); }
        else if (!db.objectStoreNames.contains(MAGASIN_FICHES)) db.createObjectStore(MAGASIN_FICHES, { keyPath: 'id' });
      };
      requete.onsuccess = () => {
        const db = requete.result;
        // une suppression de la base (effacement, réinitialisation) demande à toutes les connexions de se fermer
        db.onversionchange = () => { db.close(); if (connexions[nom] === db) delete connexions[nom]; };
        db.onclose = () => { if (connexions[nom] === db) delete connexions[nom]; };
        connexions[nom] = db; // même arrivée tardive : la connexion sert aux essais suivants
        fin(db);
      };
      requete.onerror = () => fin(null);
    }).finally(() => { delete ouvertures[nom]; });
    ouvertures[nom] = promesse;
    return promesse;
  }

  /** Exécute une transaction ; rejette si la base est indisponible, lente (> delaiEcritureMs) ou en erreur. */
  function executer(nom, magasin, mode, action) {
    const travail = (async () => {
      const db = await ouvrir(nom);
      if (!db) throw new Error('base indisponible');
      return new Promise((resoudre, rejeter) => {
        let transaction;
        try { transaction = db.transaction(magasin, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
        catch { try { transaction = db.transaction(magasin, mode); } catch (e) { rejeter(e); return; } }
        let resultat;
        const requete = action(transaction.objectStore(magasin));
        if (requete) requete.onsuccess = () => { resultat = requete.result; };
        transaction.oncomplete = () => resoudre(resultat);
        transaction.onerror = () => rejeter(transaction.error ?? new Error('transaction en erreur'));
        transaction.onabort = () => rejeter(transaction.error ?? new Error('transaction annulée'));
      });
    })();
    return avecDelai(travail, delaiEcritureMs, 'base trop lente');
  }

  function fermerConnexions() {
    for (const [nom, db] of Object.entries(connexions)) { try { db.close(); } catch { /* déjà fermée */ } delete connexions[nom]; }
  }

  // ───────── Réglages de l'appareil ─────────

  function normaliser(brut) {
    const r = { ...REGLAGES_PAR_DEFAUT, champs_sensibles: {} };
    for (const cle of CLES_REGLAGES) if (brut && brut[cle] !== undefined && brut[cle] !== null) r[cle] = brut[cle];
    if (brut && brut.profession === null) r.profession = null;
    if (typeof r.profession !== 'string' && r.profession !== null) r.profession = null;
    if (!['auto', 'clair', 'sombre'].includes(r.theme)) r.theme = 'auto';
    if (!['expert', 'guide'].includes(r.mode_affichage)) r.mode_affichage = 'expert';
    if (r.champs_sensibles === null || typeof r.champs_sensibles !== 'object' || Array.isArray(r.champs_sensibles)) r.champs_sensibles = {};
    r.delai_effacement_h = delaiEffectif(Number(r.delai_effacement_h), { plancherH: config.plancherH });
    return r;
  }

  /** Réglages courants (copie). Base indisponible : valeurs par défaut, `reglagesEnMemoire` vrai. Ne lève jamais. */
  async function lireReglages() {
    if (reglagesCache) return structuredClone(reglagesCache);
    try {
      const cles = await executer(BASES.reglages, MAGASIN_REGLAGES, 'readonly', (s) => s.getAllKeys());
      const valeurs = await executer(BASES.reglages, MAGASIN_REGLAGES, 'readonly', (s) => s.getAll());
      reglagesCache = normaliser(Object.fromEntries(cles.map((c, i) => [c, valeurs[i]])));
    } catch {
      reglagesCache = normaliser({});
    }
    return structuredClone(reglagesCache);
  }

  /** Écrit un réglage. La valeur est prise en compte TOUT DE SUITE en mémoire ; renvoie true si l'écriture a aussi réussi. */
  async function ecrireReglage(cle, valeur) {
    if (!CLES_REGLAGES.includes(cle)) throw new Error(`réglage inconnu : ${cle}`);
    await lireReglages();
    reglagesCache = normaliser({ ...reglagesCache, [cle]: valeur });
    try { await executer(BASES.reglages, MAGASIN_REGLAGES, 'readwrite', (s) => s.put(reglagesCache[cle], cle)); return true; } catch { return false; }
  }

  function delaiCourantH() { return delaiEffectif(Number(reglagesCache?.delai_effacement_h ?? DELAI_DEFAUT_H), { plancherH: config.plancherH }); }

  /** Indicateur « fiche_ouverte » lu par sw.js : vrai tant qu'une fiche `en_cours` existe (réelle ou simulation). */
  async function ecrireIndicateur(valeur) {
    try { await executer(BASES.reglages, MAGASIN_REGLAGES, 'readwrite', (s) => s.put(valeur === true, 'fiche_ouverte')); return true; } catch { return false; }
  }
  async function recalculerIndicateur() {
    let enCours = [...suivi.values()].some((s) => s.fiche.etat === 'en_cours' && !s.efface);
    if (!enCours) {
      for (const mode of ['reel', 'simulation']) {
        try { if ((await listerResumes(mode)).resumes.some((r) => r.etat === 'en_cours')) { enCours = true; break; } } catch { /* base illisible : on ne bloque pas les mises à jour sur un doute */ }
      }
    }
    return ecrireIndicateur(enCours);
  }

  // ───────── Écriture des fiches (après l'affichage, jamais avant) ─────────

  function signalerEtat(id, reussi) {
    const avant = nonEnregistrees.size > 0;
    if (reussi) nonEnregistrees.delete(id); else nonEnregistrees.add(id);
    const apres = nonEnregistrees.size > 0;
    if (apres !== avant) emettre('degrade', { actif: apres });
  }

  async function boucleEcriture(s) {
    while (s.sale && !s.efface) {
      s.sale = false;
      const copie = structuredClone(s.fiche);
      try {
        await executer(BASES[s.mode], MAGASIN_FICHES, 'readwrite', (st) => st.put(copie));
        if (!s.efface) signalerEtat(s.fiche.id, true);
      } catch {
        if (!nonEnregistrees.has(s.fiche.id) && !s.efface) {
          // première panne de l'épisode : trace dans le journal (écrite avec la fiche dès que le stockage répond)
          try { ajouterJournal(s.fiche, 'stockage_echec', {}, { maintenant: maintenant() }); } catch { /* journal toujours optionnel */ }
        }
        if (!s.efface) signalerEtat(s.fiche.id, false);
        s.sale = true; // à réécrire au prochain changement, ou à la prochaine demande de vidage
        return;
      }
    }
  }

  function lancerEcriture(s) {
    if (s.promesse) return s.promesse; // une écriture est en cours ; la boucle reprend si `sale`
    s.promesse = boucleEcriture(s).finally(() => { s.promesse = null; });
    return s.promesse;
  }

  function planifier(s, immediat) {
    s.sale = true;
    if (immediat) { clearTimeout(s.minuteur); s.minuteur = null; lancerEcriture(s); return; }
    if (!s.minuteur) s.minuteur = setTimeout(() => { s.minuteur = null; lancerEcriture(s); }, regroupementMs);
  }

  function adopter(fiche) {
    let s = suivi.get(fiche.id);
    if (!s) { s = { fiche, mode: fiche.mode, sale: false, minuteur: null, promesse: null, efface: false }; suivi.set(fiche.id, s); }
    else s.fiche = fiche;
    return s;
  }

  /** Crée une fiche EN MÉMOIRE et la renvoie tout de suite ; l'écriture part en parallèle (« on affiche d'abord »). */
  function nouvelleFiche(mode, { versionAppli } = {}) {
    const fiche = creerFiche({ mode, maintenant: maintenant(), versionAppli, delaiEffacementH: delaiCourantH() });
    const s = adopter(fiche);
    planifier(s, true);
    ecrireIndicateur(true);
    return fiche;
  }

  /** Modifie une fiche en mémoire, puis planifie l'écriture (regroupée en moins d'1 s, ou immédiate si `immediat`). */
  function modifier(fiche, mutateur, { immediat = false } = {}) {
    const s = adopter(fiche);
    mutateur(fiche);
    fiche.derniere_activite = Math.max(fiche.derniere_activite, maintenant());
    planifier(s, immediat);
    return fiche;
  }

  /** Ajoute une entrée au journal ; les événements critiques (URGENCE, appel, case, DAE) sont écrits sans regroupement. */
  function journaliser(fiche, type, donnees = {}, options = {}) {
    const s = adopter(fiche);
    const entree = ajouterJournal(fiche, type, donnees, { maintenant: maintenant(), ...options });
    planifier(s, TYPES_CRITIQUES.includes(type));
    return entree;
  }

  /** « Terminer l'intervention » : la fiche ne sera plus jamais reprise d'elle-même (2.8, 4.10). */
  function terminer(fiche) {
    modifier(fiche, (f) => { f.etat = 'terminee'; f.terminee_le = maintenant(); }, { immediat: true });
    lancerEcriture(adopter(fiche)).then(() => recalculerIndicateur());
    return fiche;
  }

  /** Force l'écriture de tout ce qui est en attente (passage en arrière-plan : dernier moment fiable, 2.4). */
  function vider() {
    return Promise.all([...suivi.values()].filter((s) => s.sale || s.promesse).map((s) => { clearTimeout(s.minuteur); s.minuteur = null; return lancerEcriture(s); }));
  }

  // ───────── Lecture ─────────

  /** Résumés SANS contenu des fiches d'une base. Les enregistrements incohérents (mauvais mode, illisibles) sont comptés à part. */
  async function listerResumes(mode) {
    // lister une base qui n'existe pas la CRÉERAIT vide : on regarde d'abord (quand le navigateur sait le dire)
    const noms = await nomsDesBases();
    if (noms !== null && !noms.includes(BASES[mode])) return { resumes: [], incoherentes: [] };
    const brutes = await executer(BASES[mode], MAGASIN_FICHES, 'readonly', (s) => s.getAll());
    const resumes = [];
    const incoherentes = [];
    for (const f of brutes) {
      if (verifierFiche(f, mode).length === 0) resumes.push(resumer(f));
      else incoherentes.push({ id: f?.id ?? null, cree_le: Number.isFinite(f?.cree_le) ? f.cree_le : null });
    }
    return { resumes, incoherentes };
  }

  /**
   * Ouvre une fiche (CONTENU). Refusée tant que la purge de l'ouverture n'a pas fini, et si la fiche n'a pas le mode de sa base.
   * @returns {Promise<{ok: true, fiche: object, migree: boolean, plusRecente: boolean} | {ok: false, raison: string}>}
   */
  async function lireFiche(mode, id) {
    if (!purgeFaite) return { ok: false, raison: 'purge_en_attente' };
    let brute;
    try { brute = await executer(BASES[mode], MAGASIN_FICHES, 'readonly', (s) => s.get(id)); } catch { return { ok: false, raison: 'stockage_indisponible' }; }
    if (brute === undefined) return { ok: false, raison: 'introuvable' };
    const raisons = verifierFiche(brute, mode);
    if (raisons.length > 0) return { ok: false, raison: `incoherente : ${raisons.join(' ; ')}` };
    const { fiche, migree, plusRecente } = migrerFiche(brute);
    const s = adopter(fiche);
    if (migree) planifier(s, true);
    return { ok: true, fiche, migree, plusRecente };
  }

  /** Quelle fiche reprendre au lancement, et quelles lignes « en attente » montrer ? Attend la fin de la purge. */
  async function trouverReprise({ accueilTouche = false } = {}) {
    await purgeTerminee;
    const resumes = [];
    for (const mode of ['reel', 'simulation']) { try { resumes.push(...(await listerResumes(mode)).resumes); } catch { /* base indisponible : rien à reprendre de ce côté */ } }
    const reprise = choisirReprise({ resumes, maintenant: maintenant(), repriseMaxH: config.repriseMaxH, accueilTouche });
    return { reprise, enAttente: fichesEnAttente({ resumes, reprise }) };
  }

  // ───────── Effacement ─────────

  function supprimerBase(nom) {
    if (connexions[nom]) { try { connexions[nom].close(); } catch { /* rien */ } delete connexions[nom]; }
    return avecDelai(new Promise((resoudre, rejeter) => {
      const requete = idb().deleteDatabase(nom);
      requete.onsuccess = () => resoudre();
      requete.onerror = () => rejeter(requete.error ?? new Error('suppression refusée'));
      requete.onblocked = () => { /* une autre connexion se ferme : on attend le succès (ou le délai) */ };
    }), delaiEcritureMs, `suppression de la base ${nom} bloquée`);
  }

  /** Noms des bases présentes, ou null si `indexedDB.databases()` n'existe pas dans ce navigateur. */
  async function nomsDesBases() {
    const f = idb();
    if (!f || typeof f.databases !== 'function') return null;
    try { return (await f.databases()).map((b) => b.name); } catch { return null; }
  }

  function nettoyerStockagesWeb({ tout = false } = {}) {
    try { globalThis.sessionStorage?.clear(); } catch { /* indisponible */ }
    try {
      const ls = globalThis.localStorage;
      if (ls) for (const cle of Object.keys(ls)) if (tout || cle.startsWith('urgences-fiche')) ls.removeItem(cle);
    } catch { /* indisponible */ }
  }

  /**
   * « Clôturer et effacer », pour UNE fiche (2.9) : (1) suppression de l'enregistrement ; (2) lecture de contrôle ; (3) seulement s'il ne
   * reste plus aucune fiche : fermeture des connexions puis suppression de la base ; (4) vérification par `indexedDB.databases()` — jamais
   * en rouvrant la base ; (5) vidage de sessionStorage et de ce que localStorage pourrait contenir de la fiche ; (6) presse-papiers vidé si
   * l'appli y avait écrit ; (7) heure de l'effacement. Les autres fiches ne sont jamais touchées.
   * @returns {Promise<{ok: true, effaceeA: number, baseSupprimee: boolean, pressePapiers: string} | {ok: false, raison: string}>}
   */
  async function effacerFiche(mode, id) {
    const s = suivi.get(id);
    try {
      let utilisePressePapiers = s?.fiche?.presse_papiers_utilise === true;
      if (!s) {
        const brute = await executer(BASES[mode], MAGASIN_FICHES, 'readonly', (st) => st.get(id));
        utilisePressePapiers = brute?.presse_papiers_utilise === true;
      }
      if (s) { // plus aucune écriture ne doit ressusciter cette fiche
        s.efface = true; clearTimeout(s.minuteur); s.minuteur = null; s.sale = false;
        try { await s.promesse; } catch { /* écriture en échec : sans importance, on efface */ }
      }
      await executer(BASES[mode], MAGASIN_FICHES, 'readwrite', (st) => st.delete(id));
      const encore = await executer(BASES[mode], MAGASIN_FICHES, 'readonly', (st) => st.get(id));
      if (encore !== undefined) return { ok: false, raison: 'la fiche est toujours présente après suppression' };
      const reste = await executer(BASES[mode], MAGASIN_FICHES, 'readonly', (st) => st.count());
      let baseSupprimee = false;
      if (reste === 0) {
        await supprimerBase(BASES[mode]);
        const noms = await nomsDesBases();
        if (noms !== null && noms.includes(BASES[mode])) return { ok: false, raison: `la base ${BASES[mode]} existe encore après suppression` };
        baseSupprimee = true;
      }
      nettoyerStockagesWeb();
      let pressePapiers = 'non_utilise';
      if (utilisePressePapiers) {
        try { await globalThis.navigator.clipboard.writeText(''); pressePapiers = 'vide'; } catch { pressePapiers = 'echec'; }
      }
      suivi.delete(id); nonEnregistrees.delete(id); reportees.delete(id);
      if (afficheeId === id) afficheeId = null;
      signalerEtat(id, true);
      await recalculerIndicateur();
      emettre('efface', { id, mode });
      return { ok: true, effaceeA: maintenant(), baseSupprimee, pressePapiers };
    } catch (erreur) {
      if (s) s.efface = false;
      return { ok: false, raison: erreur?.message ?? 'effacement impossible' };
    }
  }

  /** « Réinitialiser l'appli » (2.9) : les trois bases, localStorage, sessionStorage et les caches de l'appli ; vérifié ; puis le service worker est retiré (il se réinstalle au rechargement). */
  async function reinitialiser() {
    for (const s of suivi.values()) { s.efface = true; clearTimeout(s.minuteur); }
    suivi.clear(); nonEnregistrees.clear(); reportees.clear(); reglagesCache = null; afficheeId = null;
    const restes = [];
    try {
      fermerConnexions();
      for (const nom of Object.values(BASES)) { try { await supprimerBase(nom); } catch (e) { restes.push(`${nom} : ${e.message}`); } }
      nettoyerStockagesWeb({ tout: true });
      if (globalThis.caches) { for (const nom of await caches.keys()) if (nom.startsWith('urgences-')) await caches.delete(nom); }
      const noms = await nomsDesBases();
      if (noms) for (const nom of Object.values(BASES)) if (noms.includes(nom)) restes.push(`${nom} : existe encore`);
      if (globalThis.caches && (await caches.keys()).some((n) => n.startsWith('urgences-'))) restes.push('caches : il en reste');
      if (globalThis.navigator?.serviceWorker) { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); }
    } catch (e) { restes.push(e.message); }
    emettre('reinitialise');
    return { ok: restes.length === 0, restes };
  }

  // ───────── Purge ─────────

  /**
   * Un passage de purge (2.9) : pour chaque fiche de chaque base, décision pure (purge.js) puis exécution. Jamais silencieuse sur une
   * fiche affichée ou non terminée quand l'appli est ouverte : bandeau (événement « purge_reportee ») et entrée de journal.
   * @param {'ouverture'|'retour'|'periodique'} passage
   */
  async function purger(passage) {
    const suspecte = surveillance.echantillonner();
    const reglages = await lireReglages();
    const delaiH = delaiEffectif(reglages.delai_effacement_h, { plancherH: config.plancherH });
    const bilan = { effacees: [], reportees: [], horloge: suspecte, erreurs: 0 };
    for (const mode of ['reel', 'simulation']) {
      let listes;
      try { listes = await listerResumes(mode); } catch { bilan.erreurs += 1; continue; }
      const aExaminer = [
        ...listes.resumes,
        ...listes.incoherentes.filter((i) => i.cree_le !== null && typeof i.id === 'string').map((i) => ({ id: i.id, cree_le: i.cree_le, expire_le: undefined, etat: 'terminee' })),
      ];
      for (const r of aExaminer) {
        const decision = decisionPurge(r, { maintenant: maintenant(), delaiH, passage, afficheeId, horlogeSuspecte: suspecte });
        if (decision === 'effacer') {
          const res = await effacerFiche(mode, r.id);
          if (res.ok) bilan.effacees.push(r.id); else bilan.erreurs += 1;
        } else if (decision === 'reporter' && !reportees.has(r.id)) {
          reportees.add(r.id);
          bilan.reportees.push(r.id);
          const s = suivi.get(r.id);
          if (s) journaliser(s.fiche, 'purge_reportee', {}, {});
          emettre('purge_reportee', { id: r.id, mode });
        } else if (decision === 'reporter') bilan.reportees.push(r.id);
        else if (decision === 'horloge') bilan.horloge = true;
      }
    }
    // heure antérieure à la création d'une fiche, ou saut détecté : on ne purge pas en silence (2.9)
    if (bilan.horloge) emettre('horloge', { saut: surveillance.dernierSaut });
    if (passage === 'ouverture') { purgeFaite = true; resoudrePurge(); }
    await recalculerIndicateur();
    return bilan;
  }

  /**
   * Démarre la vie du stockage : purge de l'ouverture (en parallèle de l'affichage), purge au retour au premier plan, contrôle chaque
   * minute, vidage des écritures en attente au passage en arrière-plan. N'attend rien : l'appelant affiche d'abord.
   */
  function demarrer({ plancherH, repriseMaxH, ecouteurs = true } = {}) {
    if (Number.isFinite(plancherH)) config.plancherH = plancherH;
    if (Number.isFinite(repriseMaxH)) config.repriseMaxH = repriseMaxH;
    surveillance = new SurveillanceHorloge();
    const premier = purger('ouverture').catch(() => { purgeFaite = true; resoudrePurge(); });
    if (ecouteurs && globalThis.document) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { vider(); return; }
        surveillance.repartir(); // pas de détection de saut sur la période passée en arrière-plan (limite connue, 2.7)
        purger('retour').catch(() => {});
      });
      globalThis.addEventListener?.('pagehide', () => { vider(); });
      minuteurPeriodique = setInterval(() => { purger('periodique').catch(() => {}); }, 60_000);
    }
    return premier;
  }

  function arreter() { clearInterval(minuteurPeriodique); minuteurPeriodique = null; }

  return {
    // fiches
    nouvelleFiche, modifier, journaliser, terminer, vider, lireFiche, listerResumes, trouverReprise,
    definirAffichee: (id) => { afficheeId = id; if (id) { reportees.delete(id); } },
    // effacement et purge
    effacerFiche, reinitialiser, purger, demarrer, arreter,
    configurer: ({ plancherH, repriseMaxH } = {}) => {
      if (Number.isFinite(plancherH)) config.plancherH = plancherH;
      if (Number.isFinite(repriseMaxH)) config.repriseMaxH = repriseMaxH;
      reglagesCache = null; // le délai effectif dépend du plancher : on relira
    },
    acquitterHorloge: () => surveillance.acquitter(),
    // réglages
    lireReglages, ecrireReglage,
    // état
    etat: () => ({ degrade: nonEnregistrees.size > 0, nonEnregistrees: [...nonEnregistrees], purgeFaite, horlogeSuspecte: surveillance.suspecte, plancherH: config.plancherH }),
    purgeTerminee: () => purgeTerminee,
    ecouter: (f) => { auditeurs.add(f); return () => auditeurs.delete(f); },
    diagnostic: async () => {
      const noms = await nomsDesBases();
      const compte = {};
      for (const mode of ['reel', 'simulation']) { try { compte[mode] = (await listerResumes(mode)).resumes.length; } catch { compte[mode] = null; } }
      return { bases: noms, fiches: compte, ecritureEnAttente: nonEnregistrees.size };
    },
  };
}

/** Instance unique de l'appli. */
export const stockage = creerStockage();
