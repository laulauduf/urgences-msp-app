// Mode transmission (cahier des charges 4.8) : très gros caractères, lisible à voix haute, en PAGES courtes — Lieu, puis S, A, E, D (répartition SAED de la
// HAS, D-9) — avec « Précédent » / « Suivant » en bas et une ligne d'adresse toujours visible en tête. Un champ vide de la fiche ne s'affiche pas.
// La barre du bas, le chronomètre global et le métronome restent visibles (cet écran n'est qu'un contenu). Aucun voile ne le recouvre.
import { creer, bouton } from '../dom.js';
import { cleEdition } from '../edition.js';

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
  // D-64 : le sous-titre d'une victime (« — Victime 2 — ») est mis en évidence ; les lignes ordinaires ne changent pas
  /** Contenu d'une ligne : « libellé : valeur » (libellé petit, valeur grasse ; le texte reste « libellé : valeur » à la lecture et à la copie) ou le texte entier. */
  const remplir = (el, l) => {
    if (typeof l.libelle === 'string' && typeof l.texte === 'string') el.append(creer('span', 'transmission-k', `${l.libelle} : `), creer('strong', 'transmission-v', l.texte)); else el.append(l.valeur);
    return el;
  };
  const finEdition = () => { etat.ligne = null; auRendre(); };
  for (const l of p.lignes) {
    if (l.titre) { liste.append(creer('p', 'transmission-ligne transmission-sous-titre', l.valeur)); continue; }
    if (l.vide) { liste.append(creer('p', 'transmission-ligne transmission-vide', l.valeur)); continue; }
    // D-65 (d) : une ligne modifiable se touche, devient un champ de saisie, et est enregistrée à chaque frappe dans la fiche (le lieu de l'intervention, la victime de la ligne) ; jamais dans l'aperçu en lecture seule
    if (intervention && l.edit) {
      const cle = cleEdition(l.edit);
      const libelle = l.libelle ?? l.valeur.split(' : ')[0];
      if (etat.ligne === cle) {
        const bloc = creer('div', 'transmission-edition', '', { 'data-edit-ouvert': cle });
        const saisie = creer('input', 'transmission-saisie-ligne', '', { id: 'transmission-ligne-saisie', type: 'text', 'aria-label': `Modifier : ${libelle}`, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
        saisie.value = intervention.lireEdition(l.edit);
        saisie.addEventListener('input', () => intervention.ecrireEdition(l.edit, saisie.value));      // enregistré à chaque frappe, sans redessiner (on perdrait la frappe)
        saisie.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finEdition(); });
        // F5 (m2 de la relecture D-65) : « Annuler » remet la valeur lue à l'OUVERTURE de la ligne (vider l'adresse par erreur pendant la lecture au 15 la supprimait de la fiche, sans retour)
        bloc.append(creer('span', 'transmission-k', libelle), saisie, bouton('Terminé', 'bouton bouton-accent', finEdition, { id: 'transmission-ligne-ok' }),
          // m7 (revue AF) : rien n'est écrit si la valeur n'a pas changé (sinon la valeur de la structure serait figée dans la fiche comme surcharge)
          bouton('Annuler', 'bouton', () => { if (intervention.lireEdition(l.edit) !== (etat.initiale ?? '')) intervention.ecrireEdition(l.edit, etat.initiale ?? ''); finEdition(); }, { id: 'transmission-ligne-annuler' }));
        liste.append(bloc);
        setTimeout(() => saisie.focus({ preventScroll: true }), 0);
        continue;
      }
      const ligne = remplir(creer('p', 'transmission-ligne transmission-editable', '', { role: 'button', tabindex: '0', 'data-edit': cle, 'aria-label': `Modifier : ${l.valeur}` }), l);
      const ouvrir = () => { etat.ligne = cle; etat.initiale = intervention.lireEdition(l.edit); auRendre(); };
      ligne.addEventListener('click', ouvrir);
      ligne.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrir(); } });
      liste.append(ligne);
      continue;
    }
    liste.append(remplir(creer('p', 'transmission-ligne'), l));
  }
  ecran.append(liste);

  // E et D : champs libres de la fiche, modifiables ici (« Mon évaluation », « Ma demande »)
  // (sans `intervention` — aperçu « Montrer au SMUR » de la clôture — rien ne se modifie ici)
  if (intervention && (p.id === 'e' || p.id === 'd')) {
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

  ecran.append(creer('div', 'transmission-suite', '', { 'aria-hidden': 'true' }));   // dégradé : l'écran se poursuit sous Précédent / Suivant
  const nav = creer('div', 'transmission-nav');
  const aller = (delta) => { etat.page += delta; etat.edition = false; etat.ligne = null; auRendre(); };
  nav.append(
    bouton('Précédent', 'bouton bouton-grand', () => aller(-1), { id: 'transmission-precedent' }),
    bouton('Suivant', 'bouton bouton-grand bouton-accent', () => aller(1), { id: 'transmission-suivant' }),
  );
  nav.querySelector('#transmission-precedent').disabled = etat.page === 0;
  nav.querySelector('#transmission-suivant').disabled = etat.page === pages.length - 1;
  ecran.append(nav);
  conteneur.replaceChildren(ecran);
  // D-64c, N4 : le dégradé de suite n'apparaît que si la page se poursuit sous Précédent / Suivant (jamais un faux signe sur une page courte ou en bas de page)
  const suite = ecran.querySelector('.transmission-suite');
  const majSuite = () => { if (!suite.isConnected) { conteneur.onscroll = null; return; } suite.hidden = !(conteneur.scrollHeight - conteneur.scrollTop - conteneur.clientHeight > 8); };
  conteneur.onscroll = majSuite; majSuite(); requestAnimationFrame(majSuite);
}
