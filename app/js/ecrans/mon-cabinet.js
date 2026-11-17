// Écran « Mon cabinet » (décision D-88, 17/11/2026) : les informations de la structure se remplissent SUR CE TÉLÉPHONE, dans les Réglages. Rien n'est obligatoire, rien ne sort de l'appareil.
// Modèle et priorité : mon-cabinet.js. Les valeurs sont enregistrées dans la base des réglages de l'appareil (réglage `mon_cabinet` ; codes d'accès dans `champs_sensibles`, comme avant) ;
// elles ne sont JAMAIS effacées par la purge des interventions. Ouvert hors intervention seulement (depuis les Réglages ou la ligne d'état) : une saisie faite pendant une intervention reste
// propre à l'intervention (D-65 d) et ne passe pas par cet écran.
//
// D-70 : le champ en cours de saisie reste visible au-dessus du clavier du téléphone, sans défilement à la main (ici la PAGE défile, pas une zone : on la fait défiler).
// NON MESURÉ sur un vrai téléphone (le clavier est simulé par un visualViewport de remplacement dans les tests).
import { creer, bouton } from '../dom.js';
import { CHAMPS_CABINET, lireCabinet, champsPrives } from '../mon-cabinet.js';
import { NON_RENSEIGNE } from '../structure.js';

/** Champ de saisie sans saisie automatique ni correction (données qui ne doivent pas fuir par le clavier, 4.6) ; libellé AU-DESSUS, 52 px de haut, comme l'écran « Lieu ». */
function champ({ id, libelle, mode, aide, valeur, propose, auSaisie }) {
  const bloc = creer('div', 'cabinet-champ');
  const label = creer('label', 'champ-fiche lieu-champ');
  label.append(creer('span', 'lieu-etiquette', libelle));
  const entree = creer('input'); entree.type = 'text'; entree.name = id; entree.value = valeur ?? '';
  if (mode) entree.inputMode = mode;
  if (propose) entree.placeholder = propose;
  entree.autocomplete = 'off'; entree.autocapitalize = 'off'; entree.spellcheck = false; entree.setAttribute('autocorrect', 'off');
  // « input » : la frappe est enregistrée tout de suite (aucun « Valider » à oublier) ; l'écriture est une petite écriture de réglage, regroupée par le navigateur
  entree.addEventListener('input', () => auSaisie(entree.value));
  label.append(entree);
  bloc.append(label);
  if (aide) bloc.append(creer('p', 'reglage-aide', aide));
  return bloc;
}

/**
 * D-70 sur la page : clavier ouvert (le visualViewport est plus court que la fenêtre), on réserve de quoi défiler en bas de la page puis on la fait défiler pour que le champ actif soit
 * au-dessus du clavier. Clavier fermé : la réserve est retirée. Les écouteurs se retirent d'eux-mêmes quand l'écran n'est plus dans la page.
 */
function garderChampVisible(page) {
  const vv = window.visualViewport;
  const entete = page.querySelector('.cabinet-haut');
  const placer = () => {
    if (!page.isConnected) { retirer(); return; }
    const H = window.innerHeight;
    const bas = vv ? vv.offsetTop + vv.height : H;
    const clavier = Math.max(0, H - bas);
    const actif = document.activeElement;
    const cible = actif && page.contains(actif) && /^(INPUT|TEXTAREA)$/.test(actif.tagName) ? actif : null;
    // D-88b (m-6) : clavier ouvert, l'en-tête (réduit à URGENCE et Fermer) est collé en haut de l'écran : URGENCE reste en vue ; clavier fermé, il retrouve sa place normale
    const clavierOuvert = !!cible && clavier > 100;
    page.classList.toggle('clavier-ouvert', clavierOuvert);
    if (!clavierOuvert) { if (page.style.paddingBottom) page.style.paddingBottom = ''; return; }
    page.style.paddingBottom = `${Math.round(clavier + 16)}px`;
    const r = cible.getBoundingClientRect();
    // le champ ne passe ni sous l'en-tête collé, ni sous le clavier
    const limite = bas - 12; const haut = Math.max((vv?.offsetTop ?? 0), entete ? entete.getBoundingClientRect().bottom : 0) + 8;
    if (r.bottom > limite) window.scrollBy(0, r.bottom - limite);
    const r2 = cible.getBoundingClientRect();
    if (r2.top < haut) window.scrollBy(0, r2.top - haut);   // un champ plus haut que la place libre : on garde son début en vue
  };
  const apresFocus = (ev) => { if (/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) { placer(); setTimeout(placer, 150); setTimeout(placer, 450); } };
  function retirer() {
    vv?.removeEventListener('resize', placer); vv?.removeEventListener('scroll', placer);
    page.removeEventListener('focusin', apresFocus);
  }
  vv?.addEventListener('resize', placer); vv?.addEventListener('scroll', placer);
  page.addEventListener('focusin', apresFocus);
  return placer;   // D-88c (m-4) : rappelée quand le texte de l'en-tête change (l'en-tête grandit : le champ actif doit être replacé)
}

/**
 * @param {HTMLElement} conteneur
 * @param {{stockage: object, structure?: object|null, onRetour: () => void, onUrgence?: (() => void)|null, onChangement?: (cle: string, valeur: any) => void, peutAfficher?: () => boolean}} options
 *   `structure` = l'analyse du FICHIER (valeurs par défaut proposées en grisé), pas la fusion. `peutAfficher` (D-88b) : revérifié APRÈS la lecture des réglages (qui peut être lente) ; faux = on
 *   n'affiche rien (une intervention a démarré, ou un autre écran a été demandé, entre-temps : l'écran ne remplace jamais ce qui est à l'écran).
 *   `avantAffichage` (D-88c, m-1) : appelée juste AVANT de remplacer l'écran courant (jamais si l'on n'affiche finalement rien) : c'est là que l'écran quitté (la clôture) est quitté par sa sortie propre.
 *   `onLu(reglages)` (D-88c, m-7) : appelée quand les réglages ont été lus avec succès dans la base (la structure rejoint alors Mon cabinet, même si la lecture du démarrage avait échoué).
 * @returns {Promise<boolean>} vrai si l'écran (ou son message d'échec) a été affiché
 */
export async function afficherMonCabinet(conteneur, options) {
  const { stockage, structure = null, onRetour, onUrgence = null, onChangement = () => {}, peutAfficher = () => true, avantAffichage = () => {}, onLu = () => {} } = options;
  // D-88b (m-5) : lecture SÛRE. Si les réglages n'ont pas pu être lus, on n'ouvre PAS des cases vides (la première frappe écraserait tout Mon cabinet) : message, aucun champ, aucune écriture.
  const lecture = await stockage.lireReglagesSurs();
  if (!peutAfficher()) return false;
  if (lecture.ok) { try { onLu(lecture.reglages); } catch { /* jamais bloquant */ } }
  const reglages = lecture.reglages;
  const cabinet = lireCabinet(reglages.mon_cabinet);
  const prives = { ...(reglages.champs_sensibles ?? {}) };
  const page = creer('section', 'page mon-cabinet', '', { 'aria-label': 'Mon cabinet' });

  const titre = creer('div', 'panneau-titre');
  titre.append(creer('h1', 'info-titre', 'Mon cabinet'));
  if (onUrgence) titre.append(bouton('URGENCE', 'bouton bouton-urgence', onUrgence, { id: 'mon-cabinet-urgence' }));   // rien ne retarde un geste vital : un toucher, depuis cet écran aussi
  titre.append(bouton('Fermer', 'bouton', onRetour, { id: 'fermer-mon-cabinet' }));

  if (!lecture.ok) {
    page.append(titre);
    page.append(creer('p', 'bandeau bandeau-avertissement cabinet-lecture-impossible',
      "Lecture impossible : les informations enregistrées sur ce téléphone n'ont pas pu être lues. Rien n'a été modifié ni effacé. Réessayez dans un instant ; si cela persiste, fermez puis rouvrez l'appli.", { role: 'alert' }));
    page.append(bouton('Réessayer', 'bouton bouton-accent bouton-plein', () => { afficherMonCabinet(conteneur, options); }, { id: 'mon-cabinet-reessayer' }));
    try { avantAffichage(); } catch { /* la sortie ne doit jamais empêcher d'afficher */ }
    conteneur.replaceChildren(page);
    return true;
  }

  // l'en-tête (titre, URGENCE, Fermer, confirmation) est un seul bloc : collé en haut quand le clavier est ouvert (garderChampVisible), jamais autrement
  const haut = creer('div', 'cabinet-haut');
  const etat = creer('p', 'reglage-etat', '', { role: 'status' });
  haut.append(titre, etat);
  page.append(haut);
  page.append(creer('p', 'reglage-aide', "Remplissez ces informations une fois, sur ce téléphone. Elles servent à l'écran « Lieu », à la transmission au 15 et au document. "
    + "Elles restent sur ce téléphone : rien ne sort de l'appareil. Rien n'est obligatoire ; une case vide reprend la valeur proposée en grisé, s'il y en a une."));

  // Chaque frappe est enregistrée (réglage de l'appareil). On appelle `ecrireReglage` d'abord : la valeur est prise en compte tout de suite en mémoire, puis `onChangement`
  // met à jour l'écran « Lieu », la transmission et la ligne d'état ; on attend ensuite la fin de l'écriture pour le dire.
  let replacer = () => {};   // D-88c (m-4) : posée par garderChampVisible, une fois l'écran affiché
  const sauver = async (cle, valeur) => {
    const ecriture = stockage.ecrireReglage(cle, valeur);
    onChangement(cle, valeur);
    const ok = await ecriture;
    etat.textContent = ok ? 'Enregistré sur cet appareil.' : "Pris en compte, mais non enregistré : le stockage de l'appareil ne répond pas.";
    replacer();   // la phrase agrandit l'en-tête collé (clavier ouvert) : le champ actif est replacé sous lui et au-dessus du clavier
  };

  const liste = creer('div', 'cabinet-champs');
  for (const c of CHAMPS_CABINET) {
    const defaut = structure?.texte ? structure.texte(c.id) : NON_RENSEIGNE;   // la valeur du fichier, jamais « À REMPLIR » (texte() la dit « non renseigné »)
    liste.append(champ({
      ...c, valeur: cabinet[c.id] ?? '', propose: defaut === NON_RENSEIGNE ? '' : defaut,
      auSaisie: (v) => { if (v.trim() === '') delete cabinet[c.id]; else cabinet[c.id] = v; sauver('mon_cabinet', { ...cabinet }); },
    }));
  }
  page.append(liste);

  // Codes d'accès : privés. Dits à l'écran de transmission, jamais écrits dans le document exporté (CABINET-1, choix PROVISOIRE).
  const sens = creer('fieldset', 'reglage');
  sens.dataset.reglage = 'champs-sensibles';
  sens.append(creer('legend', null, "Codes d'accès (privés)"));
  sens.append(creer('p', 'reglage-aide', "Dits à l'écran de transmission au 15 (le régulateur en a besoin), mais jamais écrits dans le document exporté ni dans le texte copié (choix provisoire)."));
  for (const c of champsPrives(structure)) {
    sens.append(champ({
      id: c.id, libelle: c.libelle, aide: c.aide, valeur: prives[c.id] ?? '',
      auSaisie: (v) => { prives[c.id] = v; sauver('champs_sensibles', { ...prives }); },
    }));
  }
  page.append(sens);

  page.append(bouton('Terminé', 'bouton bouton-accent bouton-plein', onRetour, { id: 'mon-cabinet-termine' }));
  try { avantAffichage(); } catch { /* la sortie ne doit jamais empêcher d'afficher */ }
  conteneur.replaceChildren(page);
  replacer = garderChampVisible(page);
  return true;
}
