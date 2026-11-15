// Chargement d'un protocole et CONTRÔLE DE COHÉRENCE À L'EXÉCUTION (cahier des charges 2.2, 3.1, Q-33).
// Si le protocole est absent, illisible ou incohérent, on ne l'utilise pas : l'appelant bascule vers l'écran de secours.
// Ce contrôle protège contre un fichier cassé (mauvaise copie, mise en cache partielle) ; il ne juge PAS l'exactitude médicale
// (c'est le rôle de tests/controle-json.mjs, du `verificateur` puis de Laurent). Aucune valeur médicale n'est écrite ici.

const DELAI_MAX_MS = 5000;

/**
 * Raisons pour lesquelles ce protocole ne peut pas piloter l'écran ; liste vide = utilisable. Fonction pure.
 * `premierEcranRequis` (vrai par défaut : l'ACR) : faux pour la checklist commune de « Autre situation », qui n'a ni tuile vitale ni cycle ;
 * si elle porte tout de même des étapes `premier_ecran`, elles doivent rester « vital ».
 */
export function verifierProtocole(p, { premierEcranRequis = true } = {}) {
  const raisons = [];
  const estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!estObjet(p)) return ['le fichier ne contient pas un objet JSON'];
  if (p.format !== 1) raisons.push(`format inconnu (${JSON.stringify(p.format)}), 1 attendu`);
  for (const champ of ['id', 'titre', 'titre_court', 'version']) {
    if (typeof p[champ] !== 'string' || p[champ].trim() === '') raisons.push(`champ « ${champ} » absent`);
  }
  if (!['BROUILLON', 'CONTROLE', 'VALIDE'].includes(p.statut_validation)) raisons.push('statut de validation absent ou invalide');

  const etapes = Array.isArray(p.etapes) ? p.etapes : [];
  if (etapes.length === 0) { raisons.push('aucune étape'); return raisons; }
  const ids = new Set();
  for (const [i, e] of etapes.entries()) {
    if (!estObjet(e)) { raisons.push(`étape ${i + 1} mal formée`); continue; }
    if (typeof e.id !== 'string' || e.id === '') raisons.push(`étape ${i + 1} sans identifiant`);
    else if (ids.has(e.id)) raisons.push(`identifiant d'étape en double : ${e.id}`);
    else ids.add(e.id);
    if (typeof e.texte_court !== 'string' || e.texte_court.trim() === '') raisons.push(`étape ${e.id ?? i + 1} sans texte`);
    if (!Number.isInteger(e.ordre)) raisons.push(`étape ${e.id ?? i + 1} sans ordre`);
  }
  const premier = etapes.filter((e) => estObjet(e) && e.premier_ecran === true);
  if (premier.length === 0 && premierEcranRequis) raisons.push('aucune étape de premier écran');
  if (premier.some((e) => e.niveau !== 'vital')) raisons.push("une étape de premier écran n'est pas « vital »");
  for (const e of etapes) {
    // `parent: null` = pas de parent (étape de premier niveau)
    if (estObjet(e) && e.parent !== undefined && e.parent !== null && !ids.has(e.parent)) raisons.push(`étape ${e.id} : parent « ${e.parent} » inexistant`);
  }

  const chronos = p.chronometres === undefined ? [] : p.chronometres;
  if (!Array.isArray(chronos)) raisons.push('« chronometres » doit être une liste');
  else {
    const idsChrono = new Set(chronos.map((c) => c?.id));
    for (const c of chronos) {
      if (!estObjet(c) || typeof c.id !== 'string') { raisons.push('chronomètre mal formé'); continue; }
      // la durée s'écrit seule (nombre) ou enveloppée { valeur, statut, sources… } quand elle porte sa propre traçabilité
      const duree = estObjet(c.duree_s) ? c.duree_s.valeur : c.duree_s;
      if (duree !== null && duree !== undefined && !(Number.isFinite(duree) && duree > 0)) raisons.push(`chronomètre ${c.id} : durée invalide`);
      const m = typeof c.demarrage === 'string' ? /^avec:(.+)$/.exec(c.demarrage) : null;
      if (m && !idsChrono.has(m[1])) raisons.push(`chronomètre ${c.id} : « ${m[1]} » inexistant`);
    }
    for (const e of etapes) {
      const cible = estObjet(e?.declenche) ? e.declenche.chronometre : undefined;
      if (cible !== undefined && !idsChrono.has(cible)) raisons.push(`étape ${e.id} : chronomètre « ${cible} » inexistant`);
    }
  }
  const metronome = p.parametres?.metronome;
  if (metronome !== undefined && !(estObjet(metronome) && Number.isFinite(metronome.frequence_par_min) && metronome.frequence_par_min > 0)) {
    raisons.push('métronome : fréquence absente ou invalide');
  }
  if (p.evenements !== undefined && !Array.isArray(p.evenements)) raisons.push('« evenements » doit être une liste');
  return raisons;
}

/**
 * Charge protocoles/<id>.json. Ne lève jamais d'exception.
 * @returns {Promise<{ok: true, protocole: object} | {ok: false, raisons: string[]}>}
 */
export async function chargerProtocole(id, { dossier = 'protocoles', premierEcranRequis = true } = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MAX_MS);
  try {
    const reponse = await fetch(`${dossier}/${id}.json`, { signal: controleur.signal });
    if (!reponse.ok) return { ok: false, raisons: [`fichier introuvable (HTTP ${reponse.status})`] };
    let protocole;
    try { protocole = await reponse.json(); } catch { return { ok: false, raisons: ['JSON illisible'] }; }
    const raisons = verifierProtocole(protocole, { premierEcranRequis });
    if (protocole?.id !== undefined && protocole.id !== id) raisons.push(`identifiant « ${protocole.id} » différent du nom de fichier « ${id} »`);
    return raisons.length === 0 ? { ok: true, protocole } : { ok: false, raisons };
  } catch (erreur) {
    return { ok: false, raisons: [erreur?.name === 'AbortError' ? 'délai dépassé' : 'chargement impossible'] };
  } finally {
    clearTimeout(minuteur);
  }
}
