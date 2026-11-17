// Écran « Réglages » (cahier des charges 4.13, 2.8, 2.9, 3.2) : profession, délai d'effacement, thème, champs sensibles du lieu,
// réinitialisation. Hors intervention (depuis l'accueil). JAMAIS bloquant : un réglage qu'on n'enregistre pas ne retient rien.
import { appliquerTheme } from '../theme.js';
import { delaiEffectif, MAXIMUM_H } from '../purge.js';

function creer(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

function rangeeRadio({ nom, valeur, libelle, coche, auChangement }) {
  const label = creer('label', 'reglage-choix');
  const radio = creer('input');
  radio.type = 'radio'; radio.name = nom; radio.value = valeur; radio.checked = coche;
  radio.addEventListener('change', () => { if (radio.checked) auChangement(valeur); });
  label.append(radio, document.createTextNode(` ${libelle}`));
  return label;
}

function groupe(titre, aide) {
  const f = creer('fieldset', 'reglage');
  f.append(creer('legend', null, titre));
  if (aide) f.append(creer('p', 'reglage-aide', aide));
  return f;
}

/**
 * @param {HTMLElement} conteneur
 * @param {{stockage: object, structure?: object, groupes?: {id: string, libelle: string}[], onRetour: () => void, onChangement?: (cle: string, valeur: any) => void, auxCabinet?: () => void}} options
 *   `auxCabinet` : ouvre l'écran « Mon cabinet » (D-88). `peutAfficher` (D-88c, MAJ-1) : revérifié APRÈS la lecture des réglages (qui peut être lente) ; faux = on n'affiche rien (une intervention a
 *   démarré, ou un autre écran a été demandé entre-temps : l'écran ne remplace jamais ce qui est à l'écran).
 * @returns {Promise<boolean>} vrai si l'écran a été affiché
 */
export async function afficherReglages(conteneur, { stockage, structure, groupes = [], onRetour, onChangement = () => {}, auxCabinet = () => {}, peutAfficher = () => true }) {
  const reglages = await stockage.lireReglages();
  if (!peutAfficher()) return false;
  const plancherH = stockage.etat().plancherH;
  const page = creer('section', 'page reglages');
  page.setAttribute('aria-label', 'Réglages');
  const retour = creer('button', 'bouton', 'Fermer');
  retour.type = 'button';
  retour.id = 'fermer-reglages';
  retour.addEventListener('click', onRetour);
  const titre = creer('div', 'panneau-titre');
  titre.append(creer('h1', 'info-titre', 'Réglages'), retour);   // même gabarit que les autres écrans : titre à gauche, « Fermer » à droite
  page.append(titre);

  // A6 : la confirmation « Enregistré sur cet appareil » est collée sous le titre (feuille de style : sticky) — elle s'écrivait tout en bas de la page, hors de l'écran
  const etat = creer('p', 'reglage-etat');
  etat.setAttribute('role', 'status');
  page.append(etat);
  const enregistrer = async (cle, valeur) => {
    const ok = await stockage.ecrireReglage(cle, valeur);
    etat.textContent = ok ? 'Enregistré sur cet appareil.' : "Réglage pris en compte, mais non enregistré : le stockage de l'appareil ne répond pas.";
    onChangement(cle, valeur);
  };

  // Profession
  const prof = groupe('Profession', "Filtre les gestes proposés ; se change aussi pendant l'intervention. Non réglée : comportement du groupe le plus restreint.");
  prof.dataset.reglage = 'profession';
  prof.append(rangeeRadio({ nom: 'profession', valeur: '', libelle: 'Non réglée', coche: reglages.profession === null, auChangement: () => enregistrer('profession', null) }));
  for (const g of groupes) {
    prof.append(rangeeRadio({ nom: 'profession', valeur: g.id, libelle: g.libelle, coche: reglages.profession === g.id, auChangement: (v) => enregistrer('profession', v) }));
  }
  if (groupes.length === 0) prof.append(creer('p', 'reglage-aide', 'Liste des professions indisponible (fichier absent ou illisible).'));
  page.append(prof);

  // Délai d'effacement
  const delai = groupe("Effacement automatique", `Délai compté depuis la création de la fiche, réglable de ${plancherH} h (minimum, provisoire) à ${MAXIMUM_H} h. L'effacement ne se fait que quand l'appli est ouverte.`);
  delai.dataset.reglage = 'delai';
  const etiquette = creer('label', null, "Délai d'effacement (heures) : ");
  const select = creer('select');
  select.id = 'reglage-delai';
  const valeurs = new Set([plancherH, MAXIMUM_H]);
  for (let h = plancherH; h <= MAXIMUM_H; h += 4) valeurs.add(h);
  valeurs.add(reglages.delai_effacement_h);
  for (const h of [...valeurs].sort((a, b) => a - b)) {
    const o = creer('option', null, `${h} h`);
    o.value = String(h); o.selected = h === reglages.delai_effacement_h;
    select.append(o);
  }
  select.addEventListener('change', () => enregistrer('delai_effacement_h', delaiEffectif(Number(select.value), { plancherH })));
  etiquette.append(select);
  delai.append(etiquette);
  page.append(delai);

  // Thème
  const theme = groupe('Thème');
  theme.dataset.reglage = 'theme';
  for (const [v, libelle] of [['auto', 'Automatique (réglage du téléphone)'], ['clair', 'Clair'], ['sombre', 'Sombre']]) {
    theme.append(rangeeRadio({ nom: 'theme', valeur: v, libelle, coche: reglages.theme === v, auChangement: (val) => { appliquerTheme(val); enregistrer('theme', val); } }));
  }
  page.append(theme);

  // « Mon cabinet » (D-88) : nom à dire au 15, adresse, accès, DAE, rappel et codes d'accès, saisis sur chaque appareil, jamais dans un fichier publié (3.2). Les codes d'accès, qui étaient ici
  // (« Informations du lieu »), sont dans cet écran avec le reste : un seul endroit à remplir.
  const cab = groupe('Mon cabinet', "Nom à dire au 15, adresse, accès, défibrillateur, numéro de rappel, codes d'accès : à remplir une fois sur ce téléphone. Ils restent sur ce téléphone, rien ne sort de l'appareil.");
  cab.dataset.reglage = 'mon-cabinet';
  const ouvrirCabinet = creer('button', 'bouton', 'Mon cabinet…');
  ouvrirCabinet.type = 'button'; ouvrirCabinet.id = 'ouvrir-mon-cabinet';
  ouvrirCabinet.addEventListener('click', () => auxCabinet());
  cab.append(ouvrirCabinet);
  page.append(cab);

  // Réinitialisation (avec confirmation)
  const rein = groupe("Réinitialiser l'appli", "Efface toutes les fiches, tous les réglages (Mon cabinet compris) et les fichiers hors ligne de cet appareil. Il faudra rouvrir l'appli avec du réseau, et remplir de nouveau Mon cabinet.");
  rein.dataset.reglage = 'reinitialisation';
  const bouton = creer('button', 'bouton', "Réinitialiser l'appli…");
  bouton.type = 'button';
  const confirmation = creer('div');
  confirmation.hidden = true;
  const question = creer('p', 'bandeau bandeau-avertissement', 'Confirmer : tout sera effacé sur cet appareil.');
  const oui = creer('button', 'bouton bouton-urgence', 'Oui, tout effacer');
  oui.type = 'button';
  const non = creer('button', 'bouton', 'Annuler');
  non.type = 'button';
  const resultat = creer('p');
  resultat.setAttribute('role', 'status');
  bouton.addEventListener('click', () => { confirmation.hidden = false; bouton.hidden = true; });
  non.addEventListener('click', () => { confirmation.hidden = true; bouton.hidden = false; });
  oui.addEventListener('click', async () => {
    oui.disabled = true;
    const r = await stockage.reinitialiser();
    resultat.textContent = r.ok ? "Appli réinitialisée. Rouvrez-la avec du réseau pour recharger les fichiers hors ligne." : `Réinitialisation incomplète : ${r.restes.join(' ; ')}`;
    if (r.ok) {
      const relancer = creer('button', 'bouton bouton-accent', 'Recharger');
      relancer.type = 'button';
      relancer.addEventListener('click', () => location.reload());
      resultat.append(' ', relancer);
    } else oui.disabled = false;
  });
  confirmation.append(question, oui, non);
  rein.append(bouton, confirmation, resultat);
  page.append(rein);

  conteneur.replaceChildren(page);
  return true;
}
