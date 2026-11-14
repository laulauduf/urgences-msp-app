// Écran de secours — affiché quand le protocole est absent, illisible ou incohérent (cahier des charges, Q-33 PROVISOIRE).
// Règle absolue 5 de SPEC.md : l'appli ne bloque jamais l'accès aux actions vitales, même si son contenu est cassé.
//
// DÉROGATION assumée à « aucun texte médical en dur dans le code » (2.1) : les trois mots ci-dessous sont recopiés MOT POUR MOT de
// SPEC.md, règle absolue 5 (« masser, alerter, DAE »). Rien d'autre : aucune consigne, aucun chiffre, aucune durée. Les numéros
// 15 et 112 sont cités (cahier des charges 4.7). Toute modification de ce fichier doit rester dans ces limites.

export const ACTIONS_VITALES_SECOURS = ['Masser', 'Alerter', 'DAE'];
export const NUMEROS_SECOURS = [
  { numero: '15', libelle: 'Appeler le 15' },
  { numero: '112', libelle: 'Appeler le 112' },
];
export const MENTION_SECOURS = 'Protocole illisible — écran de secours';

const deuxChiffres = (n) => String(n).padStart(2, '0');

/** « T+mm:ss » (mm peut dépasser 59 : le temps écoulé ne dépend ni du fuseau ni du changement d'heure). */
export function formaterEcoule(millisecondes) {
  const total = Math.max(0, Math.floor(millisecondes / 1000));
  return `T+${deuxChiffres(Math.floor(total / 60))}:${deuxChiffres(total % 60)}`;
}

/**
 * Affiche l'écran de secours dans `conteneur`.
 * @param {HTMLElement} conteneur
 * @param {{raisons?: string[], t0?: number, simulation?: boolean, journaliser?: (entree: object) => void}} options
 *   t0 = heure de départ de l'urgence (Date.now()) ; à défaut, l'instant d'affichage.
 *   simulation = pas de lien tel: (cahier des charges 4.11).
 * @returns {{arreter: () => void}}
 */
export function afficherSecours(conteneur, { raisons = [], t0 = Date.now(), simulation = false, journaliser } = {}) {
  conteneur.replaceChildren();
  const section = document.createElement('section');
  section.className = 'secours';
  section.setAttribute('aria-label', MENTION_SECOURS);

  const mention = document.createElement('p');
  mention.className = 'secours-mention';
  mention.textContent = `⚠ ${MENTION_SECOURS}`;

  const chrono = document.createElement('p');
  chrono.className = 'secours-chrono';
  chrono.setAttribute('role', 'timer');
  const majChrono = () => { chrono.textContent = formaterEcoule(Date.now() - t0); };
  majChrono();
  const minuteur = setInterval(majChrono, 250);

  const actions = document.createElement('ul');
  actions.className = 'secours-actions';
  for (const texte of ACTIONS_VITALES_SECOURS) {
    const li = document.createElement('li');
    li.textContent = texte;
    actions.append(li);
  }

  const appels = document.createElement('div');
  appels.className = 'secours-appels';
  for (const { numero, libelle } of NUMEROS_SECOURS) {
    const bouton = document.createElement(simulation ? 'button' : 'a');
    bouton.className = 'bouton bouton-urgence';
    if (simulation) { bouton.type = 'button'; bouton.textContent = `Appel simulé : ${numero}`; }
    else { bouton.href = `tel:${numero}`; bouton.textContent = libelle; }
    appels.append(bouton);
  }

  const detail = document.createElement('details');
  const resume = document.createElement('summary');
  resume.textContent = 'Détail technique (maintenance)';
  const liste = document.createElement('ul');
  for (const r of raisons) { const li = document.createElement('li'); li.textContent = r; liste.append(li); }
  detail.append(resume, liste);

  // ordre voulu : les boutons d'appel avant les trois mots (ils doivent rester visibles sans défilement, texte à 200 %)
  section.append(mention, chrono, appels, actions, detail);
  conteneur.append(section);

  // Entrée de journal `secours_protocole` (3.3) : le journal réel arrive au lot L3 ; l'appelant fournit sa fonction.
  if (typeof journaliser === 'function') {
    try { journaliser({ type: 'secours_protocole', t: Date.now(), donnees: { raisons } }); } catch { /* le journal ne doit jamais empêcher l'affichage */ }
  }
  return { arreter: () => clearInterval(minuteur) };
}
