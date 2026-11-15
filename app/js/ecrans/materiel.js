// Écran « Matériel » (cahier des charges 4.14) : depuis le menu d'une intervention, « Matériel du protocole » liste les articles nécessaires avec leur EMPLACEMENT ;
// depuis l'accueil, « Matériel » montre les contenants et leurs emplacements. Mise en page seulement : le modèle est dans materiel.js, le contenu dans le protocole
// et dans config/structure.json. Textes via textContent.
import { creer, bouton } from '../dom.js';
import { EMPLACEMENT_INCONNU } from '../materiel.js';

/** Intertitres du niveau d'un article (revue design R3, n° 7) : les valeurs du protocole ne s'affichent plus brutes ; une valeur inconnue s'affiche telle quelle, avec sa majuscule. */
const NIVEAUX = [['indispensable', 'Indispensable'], ['recommande', 'Recommandé'], ['optionnel', 'Optionnel']];
const majuscule = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Autres');

/**
 * @param {HTMLElement} conteneur
 * @param {{modele: {articles: object[], contenants: object[]}, avecArticles: boolean, auFermer: () => void}} options
 *   `avecArticles` : faux depuis l'accueil (pas de protocole en cours : seulement les contenants).
 */
export function afficherMateriel(conteneur, { modele, avecArticles = true, auFermer, integre = false }) {
  const page = creer('section', 'ecran-info ecran-materiel', '', { 'aria-label': 'Matériel' });
  // `integre` (pastille Matériel de l'écran ACR) : ni titre ni « Fermer », le contenu seul
  if (!integre) {
    const titre = creer('div', 'panneau-titre');
    titre.append(creer('h1', 'info-titre', avecArticles ? 'Matériel du protocole' : 'Matériel'), bouton('Fermer', 'bouton', auFermer, { id: 'fermer-materiel' }));
    page.append(titre);
  }

  if (avecArticles) {
    if (modele.articles.length === 0) page.append(creer('p', 'plan-aide', 'Aucun matériel listé par le protocole.', { role: 'status', id: 'materiel-vide' }));
    // « Emplacements à renseigner » : UNE note en tête tant qu'aucun emplacement n'est connu, au lieu de la répéter sur chaque ligne
    if (modele.articles.length > 0 && modele.articles.every((a) => a.emplacement === EMPLACEMENT_INCONNU)) page.append(creer('p', 'plan-aide', 'Emplacements à renseigner (configuration de la structure).', { id: 'materiel-emplacements-a-renseigner' }));
    const liste = creer('div', 'materiel-groupes', '', { id: 'materiel-articles' });
    const clefs = [...NIVEAUX.map(([k]) => k), ...new Set(modele.articles.map((a) => a.niveau ?? '').filter((n) => !NIVEAUX.some(([k]) => k === n)))];
    for (const cle of clefs) {
      const articles = modele.articles.filter((a) => (NIVEAUX.some(([k]) => k === cle) ? a.niveau === cle : (a.niveau ?? '') === cle));
      if (articles.length === 0) continue;
      liste.append(creer('h3', 'phase', NIVEAUX.find(([k]) => k === cle)?.[1] ?? majuscule(cle)));
      const ul = creer('ul', 'info-liste');
      for (const a of articles) {
        const li = creer('li', 'info-ligne', '', { 'data-article': a.id });
        li.append(creer('strong', null, a.libelle));
        if (a.marques.length > 0) li.append(creer('sup', 'etoile', '✱', { 'aria-label': a.marques.join(', '), role: 'img' }));
        if (a.emplacement !== EMPLACEMENT_INCONNU) li.append(creer('span', 'info-emplacement', a.emplacement));
        ul.append(li);
      }
      liste.append(ul);
    }
    page.append(liste);
  }

  page.append(creer('h2', 'info-sous-titre', 'Contenants'));
  if (modele.contenants.length === 0) page.append(creer('p', 'plan-aide', 'Aucun contenant renseigné dans la configuration de la structure.', { role: 'status', id: 'contenants-vide' }));
  const contenants = creer('ul', 'info-liste', '', { id: 'materiel-contenants' });
  for (const c of modele.contenants) {
    const li = creer('li', 'info-ligne', '', { 'data-contenant': c.id });
    li.append(creer('strong', null, c.libelle), creer('span', 'info-emplacement', `Emplacement : ${c.emplacement}`));
    contenants.append(li);
  }
  page.append(contenants);
  conteneur.replaceChildren(page);
}
