// Écran « Matériel » (cahier des charges 4.14) : depuis le menu d'une intervention, « Matériel du protocole » liste les articles nécessaires avec leur EMPLACEMENT ;
// depuis l'accueil, « Matériel » montre les contenants et leurs emplacements. Mise en page seulement : le modèle est dans materiel.js, le contenu dans le protocole
// et dans config/structure.json. Textes via textContent.
import { creer, bouton } from '../dom.js';

/**
 * @param {HTMLElement} conteneur
 * @param {{modele: {articles: object[], contenants: object[]}, avecArticles: boolean, auFermer: () => void}} options
 *   `avecArticles` : faux depuis l'accueil (pas de protocole en cours : seulement les contenants).
 */
export function afficherMateriel(conteneur, { modele, avecArticles = true, auFermer }) {
  const page = creer('section', 'ecran-info ecran-materiel', '', { 'aria-label': 'Matériel' });
  const titre = creer('div', 'panneau-titre');
  titre.append(creer('h1', 'info-titre', avecArticles ? 'Matériel du protocole' : 'Matériel'), bouton('Fermer', 'bouton', auFermer, { id: 'fermer-materiel' }));
  page.append(titre);

  if (avecArticles) {
    if (modele.articles.length === 0) page.append(creer('p', 'plan-aide', 'Aucun matériel listé par le protocole.', { role: 'status', id: 'materiel-vide' }));
    const liste = creer('ul', 'info-liste', '', { id: 'materiel-articles' });
    for (const a of modele.articles) {
      const li = creer('li', 'info-ligne', '', { 'data-article': a.id });
      li.append(creer('strong', null, a.libelle));
      if (a.niveau) li.append(creer('span', 'info-detail', ` — ${a.niveau}`));
      for (const m of a.marques) li.append(creer('span', 'marque', ` ${m}`));
      li.append(creer('span', 'info-emplacement', `Emplacement : ${a.emplacement}`));
      if (a.etapes.length > 0) li.append(creer('span', 'info-detail', `Pour : ${a.etapes.join(' ; ')}`));
      liste.append(li);
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
