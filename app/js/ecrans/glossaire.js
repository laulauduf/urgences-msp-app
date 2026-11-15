// Glossaire (cahier des charges 4.12) : écran de consultation (menu de l'intervention, accueil) et définition d'une entrée, réutilisée par la checklist
// (acronymes dépliables). Le contenu vient de protocoles/_commun/glossaire.json ; ici, seulement de la mise en page. Textes via textContent.
import { creer, bouton } from '../dom.js';
import { marquesEntree } from '../glossaire.js';
import { texteSource } from '../checklist.js';

/** Définition d'une entrée : signification, marques (A_VALIDER, provisoire, sigle écrit en toutes lettres), sources, variantes. */
export function construireDefinition(entree, { sigle } = {}) {
  const bloc = creer('div', 'definition');
  if (!entree) {
    bloc.append(creer('p', null, `« ${sigle ?? '?'} » : absent du glossaire (aucune signification connue).`));
    return bloc;
  }
  bloc.append(creer('p', 'definition-sens', `${entree.forme_courte ?? entree.id} : ${entree.signification ?? '—'}`));
  const marques = marquesEntree(entree);
  if (marques.length > 0) bloc.append(creer('p', 'definition-marques', marques.map((m) => `⚠ ${m}`).join(' · ')));
  const sources = [...(Array.isArray(entree.sources) ? entree.sources : []), ...(Array.isArray(entree.terme_source?.sources) ? entree.terme_source.sources : [])];
  if (sources.length > 0) {
    const ul = creer('ul', 'definition-sources');
    for (const s of sources) ul.append(creer('li', null, texteSource(s)));
    bloc.append(creer('p', 'definition-etiquette', 'Sources :'), ul);
  }
  if (typeof entree.variantes === 'string' && entree.variantes !== '' && entree.variantes !== '—') bloc.append(creer('p', null, `Variantes : ${entree.variantes}`));
  if (typeof entree.a_valider === 'string' && entree.a_valider !== '') bloc.append(creer('p', null, `À valider : ${entree.a_valider}`));
  return bloc;
}

/**
 * @param {HTMLElement} conteneur
 * @param {{glossaire: {liste: object[]}, auFermer: () => void}} options
 */
export function afficherGlossaire(conteneur, { glossaire, auFermer }) {
  const page = creer('section', 'ecran-glossaire');
  page.setAttribute('aria-label', 'Glossaire');
  const titre = creer('div', 'panneau-titre');
  titre.append(bouton('Fermer', 'bouton', auFermer, { id: 'fermer-glossaire' }));
  page.append(titre, creer('h1', null, 'Glossaire'));
  const entrees = [...glossaire.liste].sort((a, b) => String(a.forme_courte ?? a.id).localeCompare(String(b.forme_courte ?? b.id), 'fr', { sensitivity: 'base' }));
  if (entrees.length === 0) page.append(creer('p', 'plan-aide', 'Glossaire indisponible (fichier absent ou illisible).', { role: 'status' }));
  const liste = creer('ul', 'glossaire-liste');
  for (const e of entrees) {
    const li = creer('li', 'entree', '', { 'data-entree': e.id });
    const definition = creer('div', 'entree-definition');
    definition.hidden = true;
    definition.append(construireDefinition(e));
    const b = bouton(String(e.forme_courte ?? e.id), 'bouton bouton-plein entree-titre', () => {
      definition.hidden = !definition.hidden;
      b.setAttribute('aria-expanded', String(!definition.hidden));
    }, { 'aria-expanded': 'false' });
    li.append(b, definition);
    liste.append(li);
  }
  page.append(liste);
  conteneur.replaceChildren(page);
}
