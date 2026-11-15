// Panneau d'alerte (cahier des charges 4.7). Le bouton ALERTER de la barre ne compose JAMAIS directement : il ouvre ce panneau, et l'appel
// part d'un bouton du panneau (un toucher accidentel est sans conséquence). « Appeler le 15 » est tout en haut, pleine largeur, entièrement
// visible sans défilement (portrait, paysage, texte à 200 %, petit écran). En simulation : « Appel simulé », aucun lien tel: ni sms:.
import { creer, bouton } from '../dom.js';
import { lienDe } from '../numeros.js';

export const TEXTE_EQUIPIER = 'Un équipier peut appeler depuis le fixe ou son téléphone : numéros ci-dessus ; la fiche reste affichée ici.';
export const TEXTE_MASQUEE = "L'appli sera masquée pendant l'appel : le métronome s'arrête, l'heure reste exacte.";
export const MARQUE_A_VALIDER = 'à valider';

/**
 * @param {HTMLElement} conteneur
 * @param {{intervention: object, numeros: {numeros: object[], rappels: object[]}, structure: object|null, auFermer: () => void, auLieu: () => void}} options
 */
export function afficherAlerte(conteneur, { intervention, numeros, structure, auFermer, auLieu, auTransmission = null }) {
  const simulation = intervention.simulation;
  const panneau = creer('section', 'panneau-alerte');
  panneau.setAttribute('aria-label', "Alerter");
  panneau.id = 'panneau-alerte';

  const titre = creer('div', 'panneau-titre');
  titre.append(bouton('Fermer', 'bouton', auFermer, { id: 'fermer-alerte' }));
  // « Mode transmission » : en tête du panneau, sans défilement (4.0, fonction 5) ; la transmission se lit à voix haute pendant l'appel
  if (auTransmission) titre.append(bouton('Mode transmission', 'bouton', auTransmission, { id: 'mode-transmission' }));
  panneau.append(titre);

  /** Un bouton d'appel : lien tel:/sms: sans `target`, horodaté dans le journal au toucher ; en simulation, un bouton « Appel simulé ». */
  const appel = (n, classe, libelle) => {
    const moyen = n.moyens.includes('tel') ? 'tel' : n.moyens[0];
    if (simulation) {
      return bouton(`Appel simulé : ${n.numero} (${n.libelle})`, classe, () => intervention.appelLance(n.numero, moyen), { 'data-numero': n.numero });
    }
    const a = creer('a', classe, libelle, { href: lienDe(n.numero, moyen), 'data-numero': n.numero });
    a.addEventListener('click', () => intervention.appelLance(n.numero, moyen)); // l'écriture part dans le même geste ; le lien n'attend pas
    return a;
  };
  const marque = (texte) => creer('span', 'marque', ` (${texte})`);

  const [planA, planB, ...autres] = [
    numeros.numeros.find((n) => n.plan === 'A') ?? numeros.numeros[0],
    numeros.numeros.find((n) => n.plan === 'B') ?? numeros.numeros[1],
  ].concat(numeros.numeros.filter((n) => n.plan !== 'A' && n.plan !== 'B'));
  const dejaA = new Set([planA?.numero, planB?.numero]);
  const reste = autres.filter((n) => !dejaA.has(n.numero));

  // Plan A — tout en haut, pleine largeur
  if (planA) {
    const blocA = creer('div', 'plan plan-a');
    blocA.append(appel(planA, 'bouton bouton-urgence bouton-appel bouton-plein', `Appeler le ${planA.numero}`));
    const hautParleur = numeros.rappels.find((r) => /haut-parleur/i.test(r.texte));
    if (hautParleur) blocA.append(creer('p', 'plan-aide', hautParleur.texte));
    panneau.append(blocA);
  }
  // Plan B — juste dessous, non replié
  if (planB) {
    const blocB = creer('div', 'plan plan-b');
    blocB.append(appel(planB, 'bouton bouton-appel bouton-plein', `Appeler le ${planB.numero}`));
    if (planB.bascule) { const p = creer('p', 'plan-aide', planB.bascule); if (planB.marqueBascule) p.append(marque(MARQUE_A_VALIDER)); blocB.append(p); }
    panneau.append(blocB);
  }

  // Horodatage
  panneau.append(bouton("J'ai appelé", 'bouton bouton-accent bouton-plein', () => { intervention.appelFait(); majConfirmation(); }, { id: 'jai-appele' }));
  const confirmation = creer('p', 'confirmation', '');
  confirmation.setAttribute('role', 'status');
  const majConfirmation = () => { confirmation.textContent = `Appel noté (${intervention.appelsFaits}).`; };
  panneau.append(confirmation);

  // ORDRE (L9c étape 2, M4) : les autres numéros (114, 18) et le plan interne passent AVANT les lignes d'information, pour rester entièrement visibles sans défilement
  // à 375×667 et 320×568 (tableau 4.0, fonctions 3 et 4) ; les lignes d'information restent dans le panneau, juste dessous. Écart d'ordre avec le tableau de 4.7 : à acter.
  // Autres numéros : une ligne compacte chacun, au moins 48 px
  if (reste.length > 0) {
    const liste = creer('div', 'autres-numeros');
    for (const n of reste) {
      const moyen = n.moyens.includes('tel') ? 'tel' : n.moyens[0];
      liste.append(appel(n, 'bouton bouton-plein', moyen === 'sms' ? `${n.numero} — ${n.libelle} (SMS)` : `Appeler le ${n.numero} — ${n.libelle}`));
    }
    panneau.append(liste);
  }

  // Plan interne (configuration de la structure)
  const plan = Array.isArray(structure?.donnees?.plan_interne) ? structure.donnees.plan_interne.filter((l) => typeof l?.libelle === 'string') : [];
  if (plan.length > 0) {
    const bloc = creer('div', 'plan-interne');
    bloc.append(creer('h2', null, 'Plan interne'));
    for (const l of plan) bloc.append(creer('p', null, typeof l.moyen === 'string' ? `${l.libelle} — ${l.moyen}` : l.libelle));
    panneau.append(bloc);
  }

  // Information (une ligne, pas un choix préalable)
  panneau.append(creer('p', 'plan-aide', TEXTE_EQUIPIER));
  if (!simulation) panneau.append(creer('p', 'plan-aide', TEXTE_MASQUEE));
  for (const r of numeros.rappels.filter((x) => !/haut-parleur/i.test(x.texte))) {
    const p = creer('p', 'plan-aide', r.texte);
    if (r.marque) p.append(marque(MARQUE_A_VALIDER));
    panneau.append(p);
  }

  // Lieu (résumé seulement) + lien vers l'unique écran de saisie
  const lieu = creer('div', 'lieu-resume');
  lieu.append(creer('span', null, resumeLieu(intervention.fiche.lieu)), bouton('Modifier le lieu', 'bouton', auLieu, { id: 'modifier-lieu' }));
  panneau.append(lieu);

  conteneur.replaceChildren(panneau);
  return { panneau };
}

/** « Au cabinet » ou l'adresse saisie, en une ligne. */
export function resumeLieu(lieu) {
  if (!lieu || lieu.type !== 'domicile') return 'Au cabinet';
  const morceaux = [lieu.adresse, lieu.etage ? `étage ${lieu.etage}` : null].filter((x) => typeof x === 'string' && x.trim() !== '');
  return morceaux.length > 0 ? `Domicile : ${morceaux.join(', ')}` : 'Domicile (adresse à saisir)';
}
