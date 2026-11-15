// Modèle de la checklist (cahier des charges 4.5). Fonctions PURES : hiérarchie des étapes, filtre par profession, étapes critiques « non faites »,
// gestes notés, séquence du mode guidé, conversion de l'heure saisie. Aucun DOM, aucun stockage, aucun contenu médical : l'ordre, les libellés,
// les critiques et les habilitations viennent du protocole et de professions.json.
import { habilitationPour, OUI } from './habilitations.js';

/** Étape VITALE : niveau « vital » ou étape du premier écran. Une seule définition (revue L6 m10) : elle sert à l'exemption du filtre ET au chemin de la tuile. */
export function estVitale(etape) { return etape?.niveau === 'vital' || etape?.premier_ecran === true; }

/**
 * @param {{etapes: object[], checklist: Record<string, {coche_le: number}>, journal: object[], habilitations: object|null, profession: string|null}} p
 * @returns {{racines: object[], plat: object[], critiques: object[], nonFaites: object[], sequenceGuidee: object[]}}
 *   Chaque item : { id, etape, enfants, habilitation, exempte, cochable, cochableProtocole, restreint, cochee, coche_le, notee, nonFaite }
 */
export function construireVue({ etapes, checklist, journal, habilitations, profession }) {
  const items = [...(Array.isArray(etapes) ? etapes : [])].sort((a, b) => a.ordre - b.ordre).map((etape) => {
    // une étape VITALE (premier écran) est « exempte » : elle reste cochable pour toute profession, comme sa tuile (règle absolue 5 : aucun geste vital bloqué)
    const exempte = estVitale(etape);
    const habilitation = habilitationPour(etape, profession, habilitations);
    const cochableProtocole = etape.cochable === true;
    const cochable = cochableProtocole && (exempte || habilitation === OUI);
    const coche = checklist?.[etape.id];
    return {
      id: etape.id, etape, enfants: [], habilitation, exempte, cochable, cochableProtocole,
      restreint: cochableProtocole && !cochable,            // action normalement cochable que ce profil ne peut pas cocher : « Noter : fait à hh:mm »
      cochee: Boolean(coche), coche_le: coche?.coche_le ?? null,
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
  for (const i of items) i.nonFaite = i.etape.critique === true && !i.cochee && !i.notee && derniereCochee > i.etape.ordre;
  return {
    racines, plat: items, parId,
    critiques: items.filter((i) => i.etape.critique === true),
    nonFaites: items.filter((i) => i.nonFaite),
    sequenceGuidee: items.filter((i) => i.cochableProtocole),
  };
}

/** Une source du protocole en une ligne : « ref — localisation ». */
export function texteSource(s) {
  const ref = typeof s?.ref === 'string' ? s.ref : '?';
  return typeof s?.localisation === 'string' && s.localisation !== '' ? `${ref} — ${s.localisation}` : ref;
}

/** Dernière note « geste fait » du journal pour une étape (entrée `geste`), ou null. */
function derniereNote(journal, id) {
  let note = null;
  for (const e of Array.isArray(journal) ? journal : []) if (e?.type === 'geste' && e.donnees?.id === id) note = { t: e.t };
  return note;
}

/**
 * Étape à montrer en mode guidé : celle demandée explicitement (`forcee`), sinon la première de la séquence ni faite, ni notée, ni passée.
 * @returns {object|null} null quand plus rien n'est à faire
 */
export function etapeGuidee(vue, passees, forcee = null) {
  if (forcee !== null) { const f = vue.sequenceGuidee.find((i) => i.id === forcee); if (f) return f; }
  return vue.sequenceGuidee.find((i) => !i.cochee && !i.notee && !passees.has(i.id)) ?? null;
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
  if (d.getTime() > maintenant) d.setDate(d.getDate() - 1);
  return d.getTime();
}
