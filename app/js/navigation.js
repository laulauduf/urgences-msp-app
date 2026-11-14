// Ouverture d'une situation : charge le protocole, le contrôle, puis affiche son écran — ou l'écran de secours (Q-33).
// Lot L2 : seule la bascule vers l'écran de secours est écrite ; l'écran ACR lui-même arrive au lot L5a, qui remplira
// `afficherEcranSituation`. La fonction est déjà le point d'entrée prévu pour le choix de situation (4.2).
import { chargerProtocole } from './protocole.js';
import { afficherSecours } from './ecrans/secours.js';

/** Entrées de journal produites avant l'existence du journal réel (lot L3) : lisibles par les tests. */
export const journalTemporaire = [];

let secoursEnCours = null;

/** À remplacer au lot L5a : affiche l'écran de la situation avec son protocole contrôlé. */
export function afficherEcranSituation(conteneur, protocole) {
  conteneur.replaceChildren();
  const p = document.createElement('p');
  p.className = 'page';
  p.dataset.situation = protocole.id;
  p.textContent = `Situation « ${protocole.titre_court} » chargée (écran livré au lot L5a).`;
  conteneur.append(p);
}

/**
 * @param {string} id identifiant du protocole (nom du fichier, sans .json)
 * @param {{conteneur?: HTMLElement, t0?: number, simulation?: boolean, journaliser?: (e: object) => void}} options
 * @returns {Promise<{ok: boolean, secours: boolean, protocole?: object, raisons?: string[]}>}
 */
export async function ouvrirSituation(id, { conteneur = document.getElementById('contenu'), t0, simulation = false, journaliser = (e) => journalTemporaire.push(e) } = {}) {
  secoursEnCours?.arreter();
  secoursEnCours = null;
  document.body.dataset.mode = 'intervention'; // la mise en page des écrans vitaux (app.css) prend le pas sur celle de l'accueil
  const resultat = await chargerProtocole(id);
  if (resultat.ok) {
    afficherEcranSituation(conteneur, resultat.protocole);
    return { ok: true, secours: false, protocole: resultat.protocole };
  }
  secoursEnCours = afficherSecours(conteneur, { raisons: resultat.raisons, t0, simulation, journaliser });
  return { ok: false, secours: true, raisons: resultat.raisons };
}
