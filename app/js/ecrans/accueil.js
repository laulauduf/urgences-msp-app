// Accueil (cahier des charges 4.1) : un gros bouton URGENCE, une ligne de présentation sobre, les fiches en attente, quelques liens.
// L'accueil s'affiche IMMÉDIATEMENT au lancement ; les fiches en attente s'ajoutent quand le stockage a répondu (jamais attendues).
import { creer, bouton, heureLocale } from '../dom.js';

export const PRESENTATION = "Aide-mémoire interne à la MSP APSIS, qui affiche des recommandations publiées et aide à noter et transmettre les informations d'une intervention.";

/**
 * @param {HTMLElement} conteneur
 * @param {{auUrgence: () => void, auSimulation: () => void, auxReglages: () => void, auGlossaire?: () => void, auToucher?: () => void}} actions
 * @returns {{afficherEnAttente: (lignes: object[], actions: {reprendre: Function, effacer: Function}) => void}}
 */
export function afficherAccueil(conteneur, { auUrgence, auSimulation, auxReglages, auGlossaire = null, auMateriel = null, auAPropos = null, auTester = null, auToucher = () => {} }) {
  const page = creer('section', 'accueil');
  page.addEventListener('pointerdown', auToucher, { capture: true, passive: true }); // « l'utilisateur a touché l'accueil » : plus de reprise directe
  page.append(creer('h1', 'accueil-titre', 'Urgences MSP APSIS'));
  page.append(creer('p', 'presentation', PRESENTATION));
  const urgence = bouton('URGENCE', 'bouton bouton-urgence bouton-urgence-geant', auUrgence, { id: 'urgence' });
  page.append(urgence);
  const attente = creer('div', 'en-attente');
  attente.id = 'en-attente';
  page.append(attente);
  // résultat d'un effacement (2.9, revue m10) : « Fiche effacée à hh:mm » ou la cause de l'échec — jamais un échec silencieux
  const resultat = creer('p', 'confirmation', '', { id: 'resultat-effacement', role: 'status' });
  page.append(resultat);
  const resultatTest = creer('p', 'confirmation', '', { id: 'resultat-test', role: 'status' });
  page.append(resultatTest);
  const liens = creer('div', 'accueil-liens');
  // chaque lien n'apparaît qu'à partir du lot qui livre son écran (4.1) : le glossaire est livré au lot L6
  liens.append(bouton('Simulation', 'bouton', auSimulation, { id: 'ouvrir-simulation' }));
  if (auMateriel) liens.append(bouton('Matériel', 'bouton', auMateriel, { id: 'ouvrir-materiel' }));   // livré au lot L9
  if (auGlossaire) liens.append(bouton('Glossaire', 'bouton', auGlossaire, { id: 'ouvrir-glossaire' }));
  liens.append(bouton('Réglages', 'bouton', auxReglages, { id: 'ouvrir-reglages' }));
  // M5 (L9c étape 2, cahier 2.5, 2.6, 2.8, 4.1) : préparer son téléphone la veille — le test du son et de l'écran, et la demande de stockage persistant, sans lancer d'intervention
  if (auTester) liens.append(bouton("Tester le son et l'écran", 'bouton', auTester, { id: 'ouvrir-test' }));
  if (auAPropos) liens.append(bouton('À propos', 'bouton', auAPropos, { id: 'ouvrir-apropos' }));   // livré au lot L9
  page.append(liens);
  conteneur.replaceChildren(page);
  // taille de texte (200 %) : l'accueil suit la même règle que les écrans d'intervention (body[data-texte]) pour que URGENCE reste entièrement visible
  const majTaille = () => { document.body.dataset.texte = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 22 ? 'grand' : 'normal'; };
  majTaille();
  const suivi = setInterval(() => { if (page.isConnected) majTaille(); else clearInterval(suivi); }, 400);

  return {
    afficherResultat(texte) { resultat.textContent = texte; },
    afficherTest(texte) { resultatTest.textContent = texte; },
    /** Lignes « fiche en attente » sous URGENCE : jamais plus grandes que le bouton, jamais devant lui. */
    afficherEnAttente(lignes, { reprendre, effacer, exporter = null }) {
      attente.replaceChildren();
      for (const r of lignes) {
        const ligne = creer('div', 'ligne-attente');
        ligne.dataset.fiche = r.id;
        const titre = r.mode === 'simulation' ? 'Simulation en pause' : `Fiche du ${heureLocale(r.cree_le)}${r.etat === 'terminee' ? ' (terminée)' : ''}`;
        ligne.append(creer('span', 'ligne-attente-titre', titre));
        ligne.append(bouton('Reprendre', 'bouton', () => reprendre(r)));
        // « Reprendre · Exporter ou effacer » pour une fiche réelle ; « Reprendre · Effacer » pour une simulation (4.1, 2.8)
        const exporte = exporter && r.mode === 'reel' ? bouton('Exporter', 'bouton', () => exporter(r)) : null;
        const efface = bouton('Effacer', 'bouton', () => {
          // « Effacer sans exporter » : seconde confirmation explicite (4.10)
          ligne.replaceChildren(creer('span', 'ligne-attente-titre', `${titre} : effacer définitivement, sans export ?`),
            bouton('Oui, effacer', 'bouton bouton-urgence', () => effacer(r)),
            bouton('Annuler', 'bouton', () => afficherLigne()));
        });
        const afficherLigne = () => { ligne.replaceChildren(creer('span', 'ligne-attente-titre', titre), bouton('Reprendre', 'bouton', () => reprendre(r)), ...(exporte ? [exporte] : []), efface); };
        afficherLigne();
        attente.append(ligne);
      }
    },
  };
}
