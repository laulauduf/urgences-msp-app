// Accueil (cahier des charges 4.1) : un gros bouton URGENCE, une ligne de présentation sobre, les fiches en attente, quelques liens.
// L'accueil s'affiche IMMÉDIATEMENT au lancement ; les fiches en attente s'ajoutent quand le stockage a répondu (jamais attendues).
import { creer, bouton, heureLocale } from '../dom.js';

export const PRESENTATION = "Aide-mémoire interne à la MSP APSIS, qui affiche des recommandations publiées et aide à noter et transmettre les informations d'une intervention.";

/**
 * @param {HTMLElement} conteneur
 * @param {{auUrgence: () => void, auSimulation: () => void, auxReglages: () => void, auGlossaire?: () => void, auToucher?: () => void}} actions
 * @returns {{afficherEnAttente: (lignes: object[], actions: {reprendre: Function, effacer: Function}) => void}}
 */
export function afficherAccueil(conteneur, { auUrgence, auSimulation, auxReglages, auGlossaire = null, auToucher = () => {} }) {
  const page = creer('section', 'accueil');
  page.addEventListener('pointerdown', auToucher, { capture: true, passive: true }); // « l'utilisateur a touché l'accueil » : plus de reprise directe
  page.append(creer('h1', 'accueil-titre', 'Urgences MSP APSIS'));
  page.append(creer('p', 'presentation', PRESENTATION));
  const urgence = bouton('URGENCE', 'bouton bouton-urgence bouton-urgence-geant', auUrgence, { id: 'urgence' });
  page.append(urgence);
  const attente = creer('div', 'en-attente');
  attente.id = 'en-attente';
  page.append(attente);
  const liens = creer('div', 'accueil-liens');
  // chaque lien n'apparaît qu'à partir du lot qui livre son écran (4.1) : le glossaire est livré au lot L6
  liens.append(bouton('Simulation', 'bouton', auSimulation, { id: 'ouvrir-simulation' }));
  if (auGlossaire) liens.append(bouton('Glossaire', 'bouton', auGlossaire, { id: 'ouvrir-glossaire' }));
  liens.append(bouton('Réglages', 'bouton', auxReglages, { id: 'ouvrir-reglages' }));
  page.append(liens);
  conteneur.replaceChildren(page);

  return {
    /** Lignes « fiche en attente » sous URGENCE : jamais plus grandes que le bouton, jamais devant lui. */
    afficherEnAttente(lignes, { reprendre, effacer }) {
      attente.replaceChildren();
      for (const r of lignes) {
        const ligne = creer('div', 'ligne-attente');
        ligne.dataset.fiche = r.id;
        const titre = r.mode === 'simulation' ? 'Simulation en pause' : `Fiche du ${heureLocale(r.cree_le)}${r.etat === 'terminee' ? ' (terminée)' : ''}`;
        ligne.append(creer('span', 'ligne-attente-titre', titre));
        ligne.append(bouton('Reprendre', 'bouton', () => reprendre(r)));
        const efface = bouton('Effacer', 'bouton', () => {
          // « Effacer sans exporter » : seconde confirmation explicite (4.10)
          ligne.replaceChildren(creer('span', 'ligne-attente-titre', `${titre} : effacer définitivement, sans export ?`),
            bouton('Oui, effacer', 'bouton bouton-urgence', () => effacer(r)),
            bouton('Annuler', 'bouton', () => afficherLigne()));
        });
        const afficherLigne = () => { ligne.replaceChildren(creer('span', 'ligne-attente-titre', titre), bouton('Reprendre', 'bouton', () => reprendre(r)), efface); };
        afficherLigne();
        attente.append(ligne);
      }
    },
  };
}
