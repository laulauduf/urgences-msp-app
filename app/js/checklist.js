// Modèle de la checklist (cahier des charges 4.5). Fonctions PURES : hiérarchie des étapes, filtre par profession, étapes critiques « non faites »,
// gestes notés, séquence du mode guidé, conversion de l'heure saisie. Aucun DOM, aucun stockage, aucun contenu médical : l'ordre, les libellés,
// les critiques et les habilitations viennent du protocole et de professions.json.
import { habilitationPour, OUI } from './habilitations.js';

/*
 * ══ NE PAS MODIFIER SANS DÉCISION DU MÉDECIN RÉFÉRENT (D-25) ══════════════════════════════════════════════════════════════════
 * Règle absolue 5 de SPEC.md : l'appli ne bloque jamais un geste vital. Une étape VITALE (niveau « vital » OU étape du premier écran)
 * est EXEMPTE du filtre par profession : elle reste cochable pour TOUTE profession, y compris « non réglée », même si les
 * habilitations sont absentes ou illisibles. Ne pas « uniformiser » avec `etapesPremierEcran` (intervention.js, qui ne retient que
 * `premier_ecran` : usage différent et voulu). SEULE exception décidée par le médecin référent : l'étape marquée `reserve_habilites: true` (D-58, lot P4b : adrénaline de l'anaphylaxie),
 * voir MENTION_SUR_DEMANDE plus bas. Avant toute modification : relire la règle absolue 5 et les décisions D-25 et D-58, puis lancer
 * `node --test tests/unitaires/checklist.test.mjs tests/unitaires/protections-surete.test.mjs` (le test « étape vitale cochable pour TOUTE profession »
 * doit rester vert).
 */
/** Étape VITALE : niveau « vital » ou étape du premier écran. Une seule définition (revue L6 m10) : elle sert à l'exemption du filtre ET au chemin de la tuile. */
export function estVitale(etape) { return etape?.niveau === 'vital' || etape?.premier_ecran === true; }

/**
 * ÉTAPE « RÉSERVÉE AUX HABILITÉS » (lot P4b, décision D-58, réponse de Laurent à ANA-2) : une étape vitale dont le protocole porte `reserve_habilites: true` (aujourd'hui l'adrénaline de l'anaphylaxie)
 * N'EST PLUS exemptée du filtre par profession (D-25). Elle reste en tête du premier écran, cochable par TOUS — jamais bloquée (règle absolue 5) — mais :
 *  - habilitation du profil = « oui » (le médecin) : coche directe ;
 *  - profession RÉGLÉE, habilitation autre (ou habilitations illisibles) : mention « sur demande du 15 », coche APRÈS une confirmation « fait sur demande du 15 » (l'heure est celle de la confirmation,
 *    elle part dans la transmission avec la mention) ;
 *  - profession NON réglée (état par défaut d'un téléphone neuf) : comme une profession non habilitée — « sur demande du 15 » + confirmation (P4d, M1 de la revue de code P4 : D-58 réserve la coche directe au
 *    médecin, et une profession non réglée prend ailleurs le groupe le plus restreint) ; un toucher de plus, rien n'est bloqué ;
 *  - jamais « non faite » (critique sans effet), jamais « Noter : fait à hh:mm » (inutile : elle se coche).
 * Seule la valeur booléenne `true` compte. Les autres étapes vitales (alerter, masser, DAE…) restent exemptées.
 */
export const MENTION_SUR_DEMANDE = 'sur demande du 15';
export function estReservee(etape) { return etape?.reserve_habilites === true; }

/**
 * @param {{etapes: object[], checklist: Record<string, {coche_le: number}>, journal: object[], habilitations: object|null, profession: string|null}} p
 * @returns {{racines: object[], plat: object[], critiques: object[], nonFaites: object[]}}
 *   Chaque item : { id, etape, enfants, habilitation, exempte, cochable, cochableProtocole, restreint, cochee, coche_le, notee, nonFaite }
 */
export function construireVue({ etapes, checklist, journal, habilitations, profession }) {
  const items = [...(Array.isArray(etapes) ? etapes : [])].sort((a, b) => a.ordre - b.ordre).map((etape) => {
    // ══ NE PAS MODIFIER SANS DÉCISION DU MÉDECIN RÉFÉRENT (D-25) ══ (voir le bloc au-dessus de estVitale)
    // une étape VITALE (premier écran) est « exempte » : elle reste cochable pour toute profession, comme sa tuile (règle absolue 5 : aucun geste vital bloqué) —
    // SAUF l'étape « réservée aux habilités » (P4b, D-58 : voir MENTION_SUR_DEMANDE), qui reste cochable par tous mais avec confirmation pour une profession réglée non habilitée
    const reserve = estReservee(etape);
    const exempte = estVitale(etape) && !reserve;
    const habilitation = habilitationPour(etape, profession, habilitations);
    const cochableProtocole = etape.cochable === true;
    const cochable = cochableProtocole && (exempte || reserve || habilitation === OUI);
    const surDemande = cochable && reserve && habilitation !== OUI;   // (toute profession dont l'habilitation n'est pas « oui », y compris non réglée)
    const coche = checklist?.[etape.id];
    return {
      id: etape.id, etape, enfants: [], habilitation, exempte, cochable, cochableProtocole,
      vitale: estVitale(etape), reserve, surDemande,        // `vitale` : barre verticale, même pour l'étape réservée (qui n'est plus « exempte »)
      restreint: cochableProtocole && !cochable,            // action normalement cochable que ce profil ne peut pas cocher : « Noter : fait à hh:mm »
      cochee: Boolean(coche), coche_le: coche?.coche_le ?? null,
      cocheeSurDemande: Boolean(coche) && derniereCocheSurDemande(journal, etape.id),
      notee: derniereNote(journal, etape.id), nonFaite: false,
    };
  });
  const parId = new Map(items.map((i) => [i.id, i]));
  const racines = [];
  for (const i of items) {
    const parent = typeof i.etape.parent === 'string' ? parId.get(i.etape.parent) : null;
    if (parent && parent !== i) parent.enfants.push(i); else racines.push(i);   // parent inconnu → racine (rien n'est caché)
  }
  // « non faite » : critique, ni cochée ni notée, alors qu'une étape SUIVANTE (ordre croissant) est cochée
  const derniereCochee = Math.max(-Infinity, ...items.filter((i) => i.cochee).map((i) => i.etape.ordre));
  // (jamais pour l'étape réservée aux habilitations, D-58 : « jamais signalée non faite »)
  for (const i of items) i.nonFaite = i.etape.critique === true && !i.reserve && !i.cochee && !i.notee && derniereCochee > i.etape.ordre;
  return {
    racines, plat: items, parId,
    critiques: items.filter((i) => i.etape.critique === true),
    nonFaites: items.filter((i) => i.nonFaite),
  };
}

/** Une source du protocole en une ligne : « ref — localisation ». */
export function texteSource(s) {
  const ref = typeof s?.ref === 'string' ? s.ref : '?';
  return typeof s?.localisation === 'string' && s.localisation !== '' ? `${ref} — ${s.localisation}` : ref;
}

/** La coche COURANTE d'une étape a-t-elle été faite « sur demande du 15 » ? La dernière entrée `case` non décochée du journal fait foi. */
function derniereCocheSurDemande(journal, id) {
  let sur = false;
  for (const e of Array.isArray(journal) ? journal : []) if (e?.type === 'case' && e.donnees?.id === id && !e.donnees?.decochee) sur = e.donnees?.sur_demande === true;
  return sur;
}

/** Dernière note « geste fait » du journal pour une étape (entrée `geste`), ou null. */
function derniereNote(journal, id) {
  let note = null;
  for (const e of Array.isArray(journal) ? journal : []) if (e?.type === 'geste' && e.donnees?.id === id) note = { t: e.t };
  return note;
}

/**
 * « hh:mm » saisi → instant (ms) de l'occurrence LA PLUS RÉCENTE de cette heure locale, jamais dans le futur (un geste noté a déjà eu lieu).
 * Heure invalide → null.
 */
export function heureVersTimestamp(texte, maintenant = Date.now()) {
  const m = typeof texte === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(texte) : null;
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(maintenant);
  d.setHours(h, min, 0, 0);
  // L7c (revue L7, mineur 4) : quelques minutes d'avance (écart entre l'heure tapée et l'horloge) restent AUJOURD'HUI ; au-delà, c'est la veille
  if (d.getTime() > maintenant + 5 * 60 * 1000) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/**
 * Position d'un geste NOTÉ par rapport au début de l'intervention (lot A, A4). L'heure saisie est une minute pleine (hh:mm, secondes à zéro) : un geste noté « maintenant »
 * tombe donc jusqu'à 59 s AVANT le début, alors qu'il vient d'être fait. Un écart qui ne dépasse pas cette minute d'arrondi n'est jamais « avant le début » : il vaut T+00:00.
 * @returns {{avantDebut: boolean, ecartMs: number}} `ecartMs` : distance au début (positive), ou 0 quand elle vient seulement de l'arrondi à la minute
 */
export function positionGeste(t, debut) {
  const minute = (x) => Math.floor(x / 60000);
  if (t >= debut) return { avantDebut: false, ecartMs: t - debut };
  if (minute(t) >= minute(debut)) return { avantDebut: false, ecartMs: 0 };
  return { avantDebut: true, ecartMs: debut - t };
}
