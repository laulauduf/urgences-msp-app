// Mode transmission (cahier des charges 4.8) : très gros caractères, lisible à voix haute, en PAGES courtes — Lieu, puis S, A, E, D (répartition SAED de la
// HAS, D-9) — avec « Précédent » / « Suivant » en bas et une ligne d'adresse toujours visible en tête. Un champ vide de la fiche ne s'affiche pas.
// La barre du bas, le chronomètre global et le métronome restent visibles (cet écran n'est qu'un contenu). Aucun voile ne le recouvre.
import { creer, bouton } from '../dom.js';

/**
 * @param {HTMLElement} conteneur
 * @param {{pages: {id: string, titre: string, adresse?: string, lignes: {valeur: string}[]}[], etat: {page: number, edition: boolean},
 *          intervention: object, auFermer: () => void, auRendre: () => void}} options
 */
export function afficherTransmission(conteneur, { pages, etat, intervention, auFermer, auRendre }) {
  etat.page = Math.min(Math.max(etat.page ?? 0, 0), pages.length - 1);
  const p = pages[etat.page];
  const adresse = pages[0].adresse;
  const ecran = creer('section', 'ecran-transmission', '', { 'aria-label': 'Mode transmission', 'data-page': p.id });
  const haut = creer('div', 'transmission-haut');
  haut.append(bouton('Fermer', 'bouton', auFermer, { id: 'fermer-transmission' }), creer('span', 'transmission-rang', `${etat.page + 1} / ${pages.length}`));
  ecran.append(haut, creer('p', 'transmission-adresse', adresse, { id: 'transmission-adresse' }), creer('h1', 'transmission-titre', p.titre));

  const liste = creer('div', 'transmission-lignes');
  for (const l of p.lignes) liste.append(creer('p', 'transmission-ligne', l.valeur));
  ecran.append(liste);

  // E et D : champs libres de la fiche, modifiables ici (« Mon évaluation », « Ma demande »)
  if (p.id === 'e' || p.id === 'd') {
    const cle = p.id === 'e' ? 'evaluation' : 'demande';
    if (etat.edition) {
      const t = creer('textarea', 'transmission-saisie', '', { id: 'transmission-saisie', rows: 4, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': p.id === 'e' ? 'Mon évaluation' : 'Ma demande' });
      t.value = intervention.fiche[cle] ?? '';
      t.addEventListener('input', () => intervention.definirChamp(null, cle, t.value));      // enregistré à chaque frappe, sans redessiner
      ecran.append(t, bouton('Terminé', 'bouton bouton-accent', () => { etat.edition = false; auRendre(); }, { id: 'transmission-saisie-ok' }));
    } else {
      ecran.append(bouton(p.lignes.length > 0 ? 'Modifier' : p.id === 'e' ? 'Écrire mon évaluation' : 'Écrire ma demande', 'bouton', () => { etat.edition = true; auRendre(); }, { id: 'transmission-modifier' }));
    }
  }

  const nav = creer('div', 'transmission-nav');
  const aller = (delta) => { etat.page += delta; etat.edition = false; auRendre(); };
  nav.append(
    bouton('Précédent', 'bouton bouton-grand', () => aller(-1), { id: 'transmission-precedent' }),
    bouton('Suivant', 'bouton bouton-grand bouton-accent', () => aller(1), { id: 'transmission-suivant' }),
  );
  nav.querySelector('#transmission-precedent').disabled = etat.page === 0;
  nav.querySelector('#transmission-suivant').disabled = etat.page === pages.length - 1;
  ecran.append(nav);
  conteneur.replaceChildren(ecran);
}
