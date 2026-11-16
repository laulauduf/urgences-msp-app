// Panneau d'alerte (cahier des charges 4.7). Le bouton ALERTER de la barre ne compose JAMAIS directement : il ouvre ce panneau, et l'appel
// part d'un bouton du panneau (un toucher accidentel est sans conséquence). « Appeler le 15 » est tout en haut, pleine largeur, entièrement
// visible sans défilement (portrait, paysage, texte à 200 %, petit écran). En simulation : « Appel simulé », aucun lien tel: ni sms:.
import { creer, bouton } from '../dom.js';
import { lienDe } from '../numeros.js';

export const TEXTE_EQUIPIER = 'Un équipier peut appeler depuis le fixe ou son téléphone : numéros ci-dessus ; la fiche reste affichée ici.';
export const TEXTE_MASQUEE = "L'appli sera masquée pendant l'appel : le métronome s'arrête, l'heure reste exacte.";
export const MARQUE_A_VALIDER = 'à valider';
/** Rappels de numeros.json qui restent TOUJOURS visibles (par identifiant, jamais par le texte : revue R2-R3, m2). */
export const RAPPELS_TOUJOURS_VISIBLES = ['haut-parleur', 'ne-raccrochez-pas'];

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
    const hautParleur = numeros.rappels.find((r) => r.id === 'haut-parleur');
    if (hautParleur) blocA.append(creer('p', 'plan-aide', hautParleur.texte));
    panneau.append(blocA);
  }
  // Plan B — juste dessous, non replié
  if (planB) {
    const blocB = creer('div', 'plan plan-b');
    blocB.append(appel(planB, 'bouton bouton-appel bouton-secondaire bouton-plein', `Appeler le ${planB.numero}`));   // le 15 reste LE choix évident : le 112 est secondaire
    if (planB.bascule) { const p = creer('p', 'plan-aide', planB.bascule); if (planB.marqueBascule) p.append(marque(MARQUE_A_VALIDER)); blocB.append(p); }
    panneau.append(blocB);
  }

  // Horodatage
  panneau.append(bouton("J'ai appelé", 'bouton bouton-accent bouton-plein', () => { intervention.appelFait(); majConfirmation(); auFermer(); }, { id: 'jai-appele' }));   // D-65 (b) : « Alerter » est cochée avec l'heure (appelFait) et l'écran d'appel se ferme : retour à la liste à cocher
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
      const el = appel(n, 'bouton bouton-plein bouton-numero-ligne', moyen === 'sms' ? `${n.numero} (SMS) — ${n.libelle}` :`Appeler le ${n.numero} — ${n.libelle}`);
      // m2 (revue AF) : « (SMS) » est en tête du libellé, pour ne jamais être avalé par le « … » de fin de ligne
      // A12 : UNE ligne de 48 px chacun (le libellé du fichier, long pour le 114, se coupe par « … » ; le texte complet reste dans le nom accessible et l'infobulle)
      const texteComplet = el.textContent;
      el.replaceChildren(creer('span', 'numero-texte', texteComplet)); el.title = texteComplet; el.setAttribute('aria-label', texteComplet);
      liste.append(el);
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

  // Lignes d'information du cahier 4.7 et 2.10 : VISIBLES, jamais repliées (revue R2-R3, M1) — la procédure nominale (« un équipier appelle ») et la parade du soignant seul (« l'appli sera masquée ») ;
  // placées APRÈS les numéros et le plan interne (tableau 4.0, fonction 3 : le plan interne reste atteint sans défiler à 320 × 568)
  panneau.append(creer('p', 'plan-aide', TEXTE_EQUIPIER));
  if (!simulation) panneau.append(creer('p', 'plan-aide', TEXTE_MASQUEE));

  // Infos utiles : repliées (relecture design D7) — « Ne raccrochez pas en premier » et tout rappel qui le dit restent VISIBLES
  const infos = creer('details', 'infos-utiles', '', { id: 'infos-utiles' });
  const resume = creer('summary', null, 'Infos utiles');
  resume.append(creer('span', 'etape-fleche', '', { 'aria-hidden': 'true' }));
  infos.append(resume);
  const visibles = [];
  // Autres moyens d'un numéro (ex. 114 : application, visio, tchat), tels que le fichier les donne ; avec les lignes d'information, sous les numéros (m2, revue aval)
  for (const n of reste.filter((x) => x.autresMoyens)) {
    const p = creer('p', 'plan-aide autres-moyens', `${n.numero} : ${n.autresMoyens}`);
    if (n.marqueAutresMoyens) p.append(marque(MARQUE_A_VALIDER));
    infos.append(p);
  }

  // Rappels du fichier : ceux de RAPPELS_TOUJOURS_VISIBLES restent visibles, les autres vont sous « Infos utiles »
  for (const r of numeros.rappels.filter((x) => x.id !== 'haut-parleur')) {
    const p = creer('p', 'plan-aide', r.texte);
    if (r.marque) p.append(marque(MARQUE_A_VALIDER));
    if (RAPPELS_TOUJOURS_VISIBLES.includes(r.id)) visibles.push(p); else infos.append(p);
  }
  for (const p of visibles) panneau.append(p);
  if (infos.childElementCount > 1) panneau.append(infos);   // « Infos utiles » n'existe que s'il y a quelque chose dessous

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
