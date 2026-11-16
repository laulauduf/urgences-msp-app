// Écran unique de saisie du lieu (cahier des charges 4.7) : cabinet (prérempli depuis la structure) ou visite à domicile (adresse, étage,
// code d'accès, accès). AUCUN champ obligatoire : rien ne bloque jamais l'alerte. Pas de saisie automatique ni de correction sur ces champs.
import { creer, bouton } from '../dom.js';

const CHAMPS_DOMICILE = [
  ['adresse', 'Adresse'],
  ['etage', 'Étage'],
  ['code_acces', "Code d'accès"],
  ['acces', 'Accès (entrée, ascenseur…)'],
];

/**
 * @param {HTMLElement} conteneur
 * @param {{intervention: object, structure: object|null, auRetour: () => void}} options
 */
export function afficherLieu(conteneur, { intervention, structure, auRetour }) {
  const lieu = intervention.fiche.lieu ?? { type: 'cabinet' };
  const page = creer('section', 'ecran-lieu');
  page.setAttribute('aria-label', 'Lieu');
  const titre = creer('div', 'panneau-titre');
  titre.append(bouton('Retour', 'bouton', auRetour, { id: 'retour-lieu' }));
  page.append(titre, creer('h1', null, 'Lieu'));

  const choix = creer('div', 'lieu-choix');
  const radios = {};
  for (const [valeur, libelle] of [['cabinet', 'Au cabinet'], ['domicile', 'Visite à domicile']]) {
    const l = creer('label', 'reglage-choix');
    const r = creer('input'); r.type = 'radio'; r.name = 'lieu-type'; r.value = valeur; r.checked = (lieu.type ?? 'cabinet') === valeur;
    l.append(r, document.createTextNode(` ${libelle}`)); choix.append(l); radios[valeur] = r;
  }
  page.append(choix);

  const cabinet = creer('div', 'lieu-cabinet');
  const adresse = structure?.texte ? ['adresse.ligne1', 'adresse.code_postal', 'adresse.commune'].map((c) => structure.texte(c)) : [];
  cabinet.append(creer('p', null, adresse.length > 0 ? adresse.join(' ') : "Adresse de la structure : non renseignée"));
  page.append(cabinet);

  const domicile = creer('div', 'lieu-domicile');
  for (const [cle, libelle] of CHAMPS_DOMICILE) {
    // A11 : même composant que le volet « Fiche » — libellé au-dessus, champ pleine largeur de 52 px en 18 px ; l'adresse (longue) est un champ sur DEUX lignes
    const label = creer('label', 'champ-fiche lieu-champ');
    label.append(creer('span', 'lieu-etiquette', libelle));
    const long = cle === 'adresse';
    const entree = creer(long ? 'textarea' : 'input'); entree.name = cle; entree.value = lieu[cle] ?? '';
    if (long) { entree.rows = 2; entree.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); }); } else entree.type = 'text';
    entree.autocomplete = 'off'; entree.autocapitalize = 'off'; entree.spellcheck = false; entree.setAttribute('autocorrect', 'off');
    // « input » ET « change » (revue m13) : la frappe est enregistrée sans attendre la perte du focus (l'écriture est déjà regroupée en moins d'1 s)
    for (const evenement of ['input', 'change']) entree.addEventListener(evenement, () => intervention.definirLieu({ [cle]: entree.value }));
    label.append(entree); domicile.append(label);
  }
  page.append(domicile);

  const afficher = () => { const dom = radios.domicile.checked; domicile.hidden = !dom; cabinet.hidden = dom; };
  for (const r of Object.values(radios)) r.addEventListener('change', () => { intervention.definirLieu({ type: radios.domicile.checked ? 'domicile' : 'cabinet' }); afficher(); });
  afficher();
  // A11 : « Terminé » pleine largeur en bas (avant : il fallait remonter à « Retour »)
  page.append(bouton('Terminé', 'bouton bouton-accent bouton-plein', auRetour, { id: 'lieu-termine' }));
  conteneur.replaceChildren(page);
}
