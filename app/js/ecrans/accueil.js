// Accueil (cahier des charges 4.1, refonte R1 : décisions D-36 et D-39, maquette `specs/maquette/maquette-acr-2026-11-15.html`) : accueil à gros boutons.
// « Arrêt cardiaque adulte · DAE » en grand — il démarre l'intervention ET ouvre directement la conduite à tenir —, puis « Autre urgence » et « Simulation »,
// puis les entrées secondaires. L'accueil s'affiche IMMÉDIATEMENT au lancement ; les fiches en attente s'ajoutent quand le stockage a répondu (jamais attendues).
// Aucun texte médical ici.
import { creer, bouton, heureLocale } from '../dom.js';
import { etatTest, confirmerSon } from '../test-appareil.js';

export const PRESENTATION = "Aide-mémoire interne à la MSP APSIS, qui affiche des recommandations publiées et aide à noter et transmettre les informations d'une intervention.";

/**
 * @param {HTMLElement} conteneur
 * @param {{auUrgence: () => void, auAutre?: () => void, auSimulation: () => void, auxReglages: () => void, auGlossaire?: () => void, auToucher?: () => void}} actions
 * @returns {{afficherEnAttente: (lignes: object[], actions: {reprendre: Function, effacer: Function}) => void}}
 */
export function afficherAccueil(conteneur, { auUrgence, auAutre = null, auSimulation, auxReglages, auGlossaire = null, auMateriel = null, auAPropos = null, auTester = null, auToucher = () => {} }) {
  const page = creer('section', 'accueil');
  page.addEventListener('pointerdown', auToucher, { capture: true, passive: true }); // « l'utilisateur a touché l'accueil » : plus de reprise directe
  page.append(creer('h1', 'accueil-titre', 'Urgences MSP APSIS'));

  const grille = creer('div', 'accueil-grille');
  /** Grosse tuile : titre + sous-titre discret. */
  const gros = (titre, sous, classe, action, id) => {
    const b = bouton(titre, classe, action, { id });
    if (sous) b.append(creer('small', null, sous));
    return b;
  };
  grille.append(gros('Arrêt cardiaque', 'adulte · DAE', 'bouton bouton-urgence gros gros-urgence', auUrgence, 'urgence'));
  // grille 2 × 2 (relecture design D9) : Autre urgence · Simulation · Matériel · Préparer ce téléphone ; le reste en liens discrets dessous
  if (auAutre) grille.append(gros('Autre urgence', 'alerte, fiche bilan', 'bouton gros', auAutre, 'ouvrir-autre'));
  grille.append(gros('Simulation', "pour s'entraîner", 'bouton gros', auSimulation, 'ouvrir-simulation'));
  if (auMateriel) grille.append(gros('Matériel', 'où est quoi', 'bouton gros', auMateriel, 'ouvrir-materiel'));
  const test = auTester ? gros('Préparer ce téléphone', '', 'bouton gros', auTester, 'ouvrir-test') : null;
  if (test) { const etat = creer('small', null, etatTest.son ? 'son vérifié ✓' : 'à faire ✱', { id: 'etat-test' }); test.append(etat); grille.append(test); }
  page.append(grille);

  const attente = creer('div', 'en-attente');
  attente.id = 'en-attente';
  page.append(attente);
  // résultat d'un effacement (2.9, revue m10) : « Fiche effacée à hh:mm » ou la cause de l'échec — jamais un échec silencieux
  const resultat = creer('p', 'confirmation', '', { id: 'resultat-effacement', role: 'status' });
  page.append(resultat);
  const resultatTest = creer('p', 'confirmation', '', { id: 'resultat-test', role: 'status' });
  page.append(resultatTest);
  const confirmation = creer('div', 'test-confirmation', '', { id: 'test-confirmation' });
  page.append(confirmation);

  const liens = creer('div', 'accueil-liens');
  // chaque entrée n'apparaît qu'à partir du lot qui livre son écran (4.1)
  if (auGlossaire) liens.append(bouton('Glossaire', 'bouton gros gros-petit', auGlossaire, { id: 'ouvrir-glossaire' }));
  liens.append(bouton('Réglages', 'bouton gros gros-petit', auxReglages, { id: 'ouvrir-reglages' }));
  // M5 (L9c étape 2, cahier 2.5, 2.6, 2.8, 4.1) : préparer son téléphone la veille — le test du son et de l'écran, et la demande de stockage persistant, sans lancer d'intervention
  if (auAPropos) liens.append(bouton('À propos', 'bouton gros gros-petit', auAPropos, { id: 'ouvrir-apropos' }));
  page.append(liens);
  conteneur.replaceChildren(page);
  // taille de texte (200 %) : l'accueil suit la même règle que les écrans d'intervention (body[data-texte]) pour que le bouton d'urgence reste entièrement visible
  const majTaille = () => { document.body.dataset.texte = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 22 ? 'grand' : 'normal'; };
  majTaille();
  const suivi = setInterval(() => { if (page.isConnected) majTaille(); else clearInterval(suivi); }, 400);

  return {
    afficherResultat(texte) { resultat.textContent = texte; },
    afficherTest(texte) { resultatTest.textContent = texte; const e = document.getElementById('etat-test'); if (e) e.textContent = etatTest.son ? 'son vérifié ✓' : 'à faire ✱'; },
    /** « Avez-vous entendu le bip ? » (revue R1, M1) : seule la réponse « Oui » valide le son. */
    demanderConfirmationSon() {
      confirmation.replaceChildren(creer('p', null, 'Avez-vous entendu le bip ?'),
        bouton("Oui, j'ai entendu", 'bouton', () => { confirmerSon(true); confirmation.replaceChildren(); this.afficherTest('Son vérifié par vous.'); }, { id: 'test-entendu' }),
        bouton('Non, pas entendu', 'bouton', () => { confirmerSon(false); confirmation.replaceChildren(); this.afficherTest("Bip non entendu : vérifiez le mode silencieux et le volume média, puis testez de nouveau."); }, { id: 'test-pas-entendu' }));
    },
    /** Lignes « fiche en attente » sous les tuiles : jamais plus grandes que le bouton d'urgence, jamais devant lui. */
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
