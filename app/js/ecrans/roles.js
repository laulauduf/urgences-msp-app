// Écran des rôles d'équipe (cahier des charges 4.4) : facultatif, JAMAIS bloquant ; ouvert depuis le bandeau des rôles ou le menu.
// On assigne d'un toucher une personne (prénom ou fonction saisi une fois, réutilisable) ; le cumul est permis ; aucune répartition n'est
// recommandée (A_VALIDER, fiche ACR V7 et V19). L'identité de l'appelant de la transmission est tirée du rôle « appel » : aucun champ de plus.
import { creer, bouton } from '../dom.js';
import { ROLES, AUCUN, resumeRoles, appelant } from '../roles.js';

/**
 * @param {HTMLElement} conteneur
 * @param {{intervention: object, auFermer: () => void}} options
 */
export function afficherRoles(conteneur, { intervention, auFermer }) {
  const page = creer('section', 'ecran-roles');
  page.setAttribute('aria-label', 'Rôles');
  const titre = creer('div', 'panneau-titre');
  titre.append(bouton('Fermer', 'bouton', auFermer, { id: 'fermer-roles' }));
  page.append(titre, creer('h1', null, 'Rôles'));

  const liste = creer('div', 'roles-liste');
  const boutons = new Map();
  for (const r of ROLES) {
    const b = bouton('', 'bouton role-bouton', () => choisir(r.id), { 'data-role': r.id });
    b.append(creer('span', 'role-nom', r.libelle), creer('span', 'role-personne', AUCUN));
    boutons.set(r.id, b);
    liste.append(b);
  }
  page.append(liste);
  const identite = creer('p', 'plan-aide', '', { id: 'appelant' });
  page.append(identite);

  // Sélecteur de personne : construit UNE fois (un seul champ de saisie), affiché quand un rôle est choisi
  const choix = creer('div', 'role-choix');
  choix.hidden = true;
  const question = creer('p', 'role-question', '');
  const puces = creer('div', 'personnes');
  const saisie = creer('input', null, undefined, { id: 'role-saisie', type: 'text', 'aria-label': 'Nouvelle personne (prénom ou fonction)', placeholder: 'Prénom ou fonction' });
  saisie.autocomplete = 'off'; saisie.autocapitalize = 'off'; saisie.spellcheck = false; saisie.setAttribute('autocorrect', 'off');
  saisie.required = false;
  let courant = null;
  const ajouter = bouton('Ajouter', 'bouton bouton-accent', () => {
    if (courant && saisie.value.trim() !== '') { intervention.ajouterPersonne(saisie.value); intervention.attribuerRole(courant, saisie.value); }
    saisie.value = '';
    fermerChoix(); majTout();
  }, { id: 'role-ajouter' });
  const aucun = bouton('Aucun', 'bouton', () => { if (courant) intervention.attribuerRole(courant, ''); fermerChoix(); majTout(); }, { id: 'role-aucun' });
  const ligneSaisie = creer('div', 'role-saisie-ligne');
  ligneSaisie.append(saisie, ajouter);
  choix.append(question, puces, ligneSaisie, aucun);
  page.append(choix);

  function fermerChoix() { courant = null; choix.hidden = true; }
  function choisir(id) {
    courant = id;
    question.textContent = `Qui prend le rôle « ${ROLES.find((r) => r.id === id).libelle} » ?`;
    puces.replaceChildren();
    for (const nom of intervention.personnes) {
      puces.append(bouton(nom, 'bouton personne-chip', () => { intervention.attribuerRole(id, nom); fermerChoix(); majTout(); }, { 'data-personne': nom }));
    }
    choix.hidden = false;
    saisie.focus({ preventScroll: true });
  }
  function majTout() {
    const resume = resumeRoles(intervention.roles);
    for (const r of resume) boutons.get(r.id).querySelector('.role-personne').textContent = r.affiche;
    const a = appelant(intervention.roles);
    identite.textContent = a ? `Appelant pour la transmission : ${a.personne} — ${a.fonction}` : 'Appelant pour la transmission : non attribué';
  }
  majTout();
  conteneur.replaceChildren(page);
}
