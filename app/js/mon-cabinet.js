// « Mon cabinet » (décision D-88, 17/11/2026) : les informations de la structure (nom à dire au 15, adresse, repère, accès, stationnement des secours, point d'accueil,
// numéro de rappel, emplacement du DAE) se remplissent SUR CHAQUE APPAREIL, dans les Réglages, et restent sur le téléphone (base `urgences-reglages`, réglage `mon_cabinet`) :
// rien n'est envoyé, rien n'est publié. Modèle PUR, sans DOM, sans stockage (le stockage est dans stockage.js, l'écran dans ecrans/mon-cabinet.js).
//
// ORDRE DE PRIORITÉ d'une valeur affichée : 1. celle de l'INTERVENTION (fiche.lieu.surcharges, D-65 d : saisie sur place, propre à la fiche, jamais écrite ici) ;
// 2. celle de « Mon cabinet » (cet appareil) ; 3. celle de config/structure.json (valeur par défaut publiée, sans information privée). Une valeur « À REMPLIR » ou vide,
// du fichier comme du téléphone, n'est jamais affichée comme une vraie valeur (structure.js : « non renseigné »).
//
// Le reste du code ne change pas : `fusionnerStructure` rend une analyse de structure de même forme que `analyserStructure` (donnees, illisible, manquants, texte), que tous les écrans
// (Lieu, transmission, document, Matériel, alerte) lisent déjà.
import { analyserStructure } from './structure.js';

/** Champs de « Mon cabinet », dans l'ordre de l'écran. `id` = chemin dans structure.json (c'est aussi la clé des surcharges d'intervention). */
export const CHAMPS_CABINET = [
  { id: 'structure.nom', libelle: 'Nom à dire au 15', aide: 'Le nom que vous donnez au régulateur du 15 pour dire où vous êtes.' },
  { id: 'adresse.ligne1', libelle: 'Adresse (numéro et rue)' },
  { id: 'adresse.complement', libelle: "Complément d'adresse (bâtiment, étage)" },
  { id: 'adresse.code_postal', libelle: 'Code postal', mode: 'numeric' },
  { id: 'adresse.commune', libelle: 'Commune' },
  { id: 'adresse.repere', libelle: 'Repère pour les secours', aide: 'Un point facile à reconnaître (enseigne, bâtiment voisin…).' },
  // D-88b (m-4) : une simple phrase, aucun contrôle de ce qui est tapé (la règle R12 ne contrôle que le fichier publié) ; les codes ont leur propre rubrique, jamais écrite dans le document
  { id: 'acces.description', libelle: 'Accès (entrée, étage, ascenseur)', aide: "Pas de code ici : les codes d'accès ont leur propre rubrique, plus bas (jamais écrite dans le document)." },
  { id: 'acces.stationnement_secours', libelle: 'Stationnement des secours' },
  { id: 'acces.point_accueil', libelle: "Point d'accueil", aide: "Où quelqu'un attend les secours." },
  { id: 'dae.emplacement', libelle: 'Emplacement du DAE', aide: 'Le défibrillateur : où le trouver.' },
  // CABINET-2 (PROVISOIRE) : aide seulement, aucun contrôle de format (un portable reste accepté)
  { id: 'numero_rappel', libelle: 'Numéro de rappel', mode: 'tel', aide: 'Le numéro sur lequel le 15 peut vous rappeler, de préférence le standard du cabinet.' },
];

/** Libellé du champ privé « code d'entrée », proposé même si le fichier n'en déclare aucun (le fichier publié n'en déclare pas : il ne contient aucune information privée). */
export const CHAMP_PRIVE_PAR_DEFAUT = { id: 'code_entree', libelle: "Code d'entrée du bâtiment", aide: 'À saisir sur chaque téléphone.' };

const IDS_CABINET = new Set(CHAMPS_CABINET.map((c) => c.id));
const LIBELLES = new Map(CHAMPS_CABINET.map((c) => [c.id, c.libelle]));
const plein = (v) => typeof v === 'string' && v.trim() !== '';
/** Les quatre informations sans lesquelles le mode transmission serait incomplet (même liste que structure.js). */
const ATTENDUS = ['structure.nom', 'adresse.ligne1', 'adresse.commune', 'numero_rappel'];

/** Lit le réglage `mon_cabinet` tel qu'enregistré : seuls les champs connus, en texte rogné ; tout le reste est ignoré, sans exception. */
export function lireCabinet(brut) {
  const r = {};
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return r;
  for (const id of IDS_CABINET) if (typeof brut[id] === 'string') r[id] = brut[id].trim();
  return r;
}

/** Vrai dès qu'une valeur non vide est enregistrée sur ce téléphone. */
export function cabinetRenseigne(cabinet) { return Object.values(lireCabinet(cabinet)).some(plein); }

/** Écrit `valeur` au `chemin` d'une copie (jamais dans l'original). */
function poser(objet, chemin, valeur) {
  const cles = chemin.split('.');
  let courant = objet;
  for (const cle of cles.slice(0, -1)) {
    courant[cle] = courant[cle] !== null && typeof courant[cle] === 'object' && !Array.isArray(courant[cle]) ? { ...courant[cle] } : {};
    courant = courant[cle];
  }
  courant[cles.at(-1)] = valeur;
}

/**
 * Fusionne le fichier lu (`analyserStructure`) et « Mon cabinet » : la valeur du téléphone prime quand elle n'est pas vide. Renvoie une analyse de même forme que `analyserStructure`
 * (donnees, illisible, manquants, texte), SANS modifier le fichier lu ni l'objet Mon cabinet. `illisible` reste celui du FICHIER (le point de la ligne d'état le dit encore) ;
 * `manquants` tient compte de Mon cabinet.
 */
export function fusionnerStructure(fichier, cabinet) {
  const base = fichier && typeof fichier === 'object' && fichier.donnees && typeof fichier.donnees === 'object' ? fichier.donnees : {};
  const donnees = structuredClone(base);
  const valeurs = lireCabinet(cabinet);
  for (const [id, v] of Object.entries(valeurs)) if (plein(v)) poser(donnees, id, v);
  const analyse = analyserStructure(donnees);
  const texte = analyse.texte;
  return { donnees: analyse.donnees, illisible: Boolean(fichier?.illisible), manquants: ATTENDUS.filter((c) => texte(c) === 'non renseigné'), texte };
}

/**
 * Champs privés de l'appareil (codes d'accès : jamais dans un fichier publié, jamais dans le document exporté) : « code d'entrée » toujours proposé, puis ceux que le fichier déclare
 * (`champs_sensibles_locaux` : seulement leurs libellés). Chacun est enregistré dans le réglage `champs_sensibles` (clé = id).
 */
export function champsPrives(fichier) {
  const declares = Array.isArray(fichier?.donnees?.champs_sensibles_locaux) ? fichier.donnees.champs_sensibles_locaux.filter((c) => plein(c?.id) && plein(c?.libelle)) : [];
  const entree = declares.find((c) => c.id === CHAMP_PRIVE_PAR_DEFAUT.id) ?? CHAMP_PRIVE_PAR_DEFAUT;
  return [entree, ...declares.filter((c) => c.id !== CHAMP_PRIVE_PAR_DEFAUT.id)].map((c) => ({ id: c.id, libelle: c.libelle, aide: typeof c.aide === 'string' ? c.aide : '' }));
}

/**
 * Point « Configuration de la structure » de la liste « Points à vérifier » (D-88) : « à faire sur ce téléphone » tant qu'il manque une information, avec le nom des champs en clair
 * (jamais une valeur saisie). `ok: true` : « Configuration de la structure renseignée ». `action` : l'écran à ouvrir (fixé par l'appelant).
 */
export function pointCabinet(analyse) {
  if (analyse.illisible && analyse.manquants.length === 0) return { ok: true, texte: 'Configuration de la structure illisible — Mon cabinet (ce téléphone) la remplace' };
  if (analyse.manquants.length > 0) {
    const noms = analyse.manquants.map((c) => LIBELLES.get(c) ?? c);
    const debut = analyse.illisible ? 'Configuration de la structure illisible — ' : '';
    const n = noms.length;
    return { ok: false, texte: `${debut}À faire sur ce téléphone : Mon cabinet (Réglages) — ${n} information${n > 1 ? 's' : ''} à renseigner (${noms.join(', ')})` };
  }
  return { ok: true, texte: 'Configuration de la structure renseignée' };
}
