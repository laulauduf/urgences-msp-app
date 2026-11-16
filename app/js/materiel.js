// Matériel du protocole (cahier des charges 4.14) : modèle PUR, sans DOM. Les articles viennent du PROTOCOLE (liste `materiel`, ou à défaut les identifiants cités
// par les étapes) ; leur EMPLACEMENT vient de `config/structure.json` (contenants et rattachement des articles) ; rien n'est écrit en dur ici.
// Un emplacement inconnu est dit « emplacement non renseigné », jamais deviné. Aucun contenu médical : libellés et niveaux sont ceux du protocole.
import { MARQUE_A_VALIDER } from './horloge.js';

export const EMPLACEMENT_INCONNU = 'emplacement non renseigné';

/** Niveaux de matériel écrits par les protocoles (codes à tirets bas) → intertitre en français. Traduction littérale du code, aucun contenu ajouté (lot A, A8) ; un code inconnu perd ses tirets bas et prend une majuscule. */
const NIVEAUX_FR = { indispensable: 'Indispensable', recommande: 'Recommandé', optionnel: 'Optionnel', optionnel_ou_recommande: 'Optionnel ou recommandé', non_determine: 'Non déterminé', non_preconise: 'Non préconisé', non_recommande_seul: 'Non recommandé seul', hors_protocole: 'Hors protocole' };
export function libelleNiveau(code) {
  if (typeof code !== 'string' || code.trim() === '') return 'Autres';
  if (Object.hasOwn(NIVEAUX_FR, code)) return NIVEAUX_FR[code];
  const t = code.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const plein = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {{protocole: object|null, structure: {donnees: object}|null}} entree
 * @returns {{articles: {id: string, libelle: string, niveau: string|null, marques: string[], emplacement: string, etapes: string[]}[], contenants: {id: string, libelle: string, emplacement: string}[]}}
 */
export function construireMateriel({ protocole, structure, seulementListe = false }) {
  const donnees = structure?.donnees ?? {};
  const contenants = (Array.isArray(donnees.materiel?.contenants) ? donnees.materiel.contenants : []).filter((c) => plein(c?.libelle))
    .map((c) => ({ id: c.id, libelle: c.libelle, emplacement: plein(c.emplacement) ? c.emplacement : EMPLACEMENT_INCONNU }));
  const rattachements = Array.isArray(donnees.materiel?.articles) ? donnees.materiel.articles : [];
  const etapes = Array.isArray(protocole?.etapes) ? protocole.etapes : [];

  // liste des articles : celle du protocole ; sinon, ce que les étapes citent (identifiant tel quel, sans doublon)
  // option seulementListe (conduites, lot A, A8) : sans liste propre au protocole, rien n'est déduit des étapes (leurs identifiants bruts ne sont pas des libellés)
  const liste = Array.isArray(protocole?.materiel) && protocole.materiel.length > 0
    ? protocole.materiel.filter((a) => plein(a?.id))
    : seulementListe ? [] : [...new Set(etapes.flatMap((e) => (Array.isArray(e.materiel) ? e.materiel : [])))].map((id) => ({ id }));

  const articles = liste.map((a) => {
    const rattache = rattachements.find((r) => r?.ref_liste === (a.ref_liste_proposee ?? a.id));
    const contenant = rattache ? contenants.find((c) => c.id === rattache.contenant) : null;
    return {
      id: a.id,
      libelle: plein(a.libelle) ? a.libelle : a.id,
      niveau: plein(a.niveau) ? a.niveau : null,
      marques: a.statut === 'A_VALIDER' ? [MARQUE_A_VALIDER] : [],
      emplacement: contenant ? (contenant.emplacement === EMPLACEMENT_INCONNU ? contenant.libelle : `${contenant.libelle} : ${contenant.emplacement}`) : EMPLACEMENT_INCONNU,
      etapes: etapes.filter((e) => Array.isArray(e.materiel) && e.materiel.includes(a.id)).map((e) => e.texte_court ?? e.id),
    };
  });
  return { articles, contenants };
}
