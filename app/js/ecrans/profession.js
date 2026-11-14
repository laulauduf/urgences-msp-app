// Liste des groupes de professions, ouverte par la puce de l'en-tête (cahier des charges 4.13) : UN toucher sur la puce l'ouvre, UN second choisit
// (2 touchers). Le changement vaut pour cet appareil, s'applique aussitôt et est journalisé (`profession`). Les groupes viennent de
// protocoles/_commun/professions.json : le code ne contient aucun libellé de profession.
import { creer, bouton } from '../dom.js';

/**
 * @param {HTMLElement} conteneur
 * @param {{groupes: {id: string, libelle: string}[], courante: string|null, auChoix: (id: string|null) => void, auFermer: () => void}} options
 */
export function afficherProfession(conteneur, { groupes, courante, auChoix, auFermer }) {
  const page = creer('section', 'ecran-profession');
  page.setAttribute('aria-label', 'Profession');
  const titre = creer('div', 'panneau-titre');
  titre.append(bouton('Fermer', 'bouton', auFermer, { id: 'fermer-profession' }));
  page.append(titre, creer('h1', null, 'Profession'));
  const option = (id, libelle) => {
    const b = bouton('', 'bouton bouton-plein option-profession', () => auChoix(id), { 'data-profession': id ?? '', 'aria-pressed': String((courante ?? null) === id) });
    b.append(creer('span', null, libelle));
    if ((courante ?? null) === id) b.append(creer('span', 'option-coche', ' ✓', { 'aria-label': 'choix actuel' }));
    return b;
  };
  page.append(option(null, 'Non réglée'));
  for (const g of groupes) page.append(option(g.id, g.libelle));
  if (groupes.length === 0) page.append(creer('p', 'plan-aide', 'Liste des professions indisponible (fichier absent ou illisible).'));
  else page.append(creer('p', 'plan-aide', "Le choix vaut pour cet appareil et s'applique tout de suite. Non réglée : comportement du groupe le plus restreint."));
  conteneur.replaceChildren(page);
}
