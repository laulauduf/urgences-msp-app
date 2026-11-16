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
 * @param {{stockage: object, structure?: object, groupes?: {id: string, libelle: string}[], onRetour: () => void, onChangement?: (cle: string, valeur: any) => void}} options
 */
export async function afficherReglages(conteneur, { stockage, structure, groupes = [], onRetour, onChangement = () => {} }) {
  const reglages = await stockage.lireReglages();
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

  // Champs sensibles du lieu : saisis sur chaque appareil, jamais dans un fichier publié (3.2)
  const declares = Array.isArray(structure?.donnees?.champs_sensibles_locaux) ? structure.donnees.champs_sensibles_locaux : [];
  if (declares.length > 0) {
    const sens = groupe('Informations du lieu (sur cet appareil seulement)', "Ces valeurs ne sont jamais envoyées ni publiées ; elles restent sur ce téléphone.");
    sens.dataset.reglage = 'champs-sensibles';
    for (const c of declares) {
      if (typeof c?.id !== 'string' || typeof c?.libelle !== 'string') continue;
      const label = creer('label', 'reglage-champ', `${c.libelle} : `);
      const entree = creer('input');
      entree.type = 'text'; entree.name = c.id; entree.value = reglages.champs_sensibles[c.id] ?? '';
      // pas de saisie automatique, pas de correction ni de vérification orthographique (données qui ne doivent pas fuir, 4.6)
      entree.autocomplete = 'off'; entree.autocapitalize = 'off'; entree.spellcheck = false; entree.setAttribute('autocorrect', 'off');
      entree.addEventListener('change', async () => {
        const courant = (await stockage.lireReglages()).champs_sensibles;
        enregistrer('champs_sensibles', { ...courant, [c.id]: entree.value });
      });
      label.append(entree);
      sens.append(label);
      if (c.aide) sens.append(creer('p', 'reglage-aide', c.aide));
    }
    page.append(sens);
  }

  // Réinitialisation (avec confirmation)
  const rein = groupe("Réinitialiser l'appli", "Efface toutes les fiches, tous les réglages et les fichiers hors ligne de cet appareil. Il faudra rouvrir l'appli avec du réseau.");
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
}
