// Écran « À propos » (cahier des charges 4.15) : présentation sobre, avertissement, versions et statut des protocoles, choix PROVISOIRES, fuites que l'appli ne peut pas
// empêcher, état de l'appareil et diagnostic SANS AUCUNE DONNÉE de patient (nombre de fiches, bases présentes : sert au test T10 sur appareil). Les textes sont dans a-propos.js.
// Un échec de lecture (stockage, protocole) ne vide jamais l'écran : la ligne concernée le dit.
import { creer, bouton } from '../dom.js';
import { PRESENTATION } from './accueil.js';
import {
  AVERTISSEMENT_GENERAL, INFO_PATIENT, VERSIONS_MINIMALES, RAPPEL_DONNEES, FUITES, CHOIX_PROVISOIRES_APPLI, statutProtocole, choixProvisoiresProtocole, lignesCapacites,
} from '../a-propos.js';
import { estInstallee, lireEnvironnement } from '../installation.js';
import { verifierMisesAJour, ETATS_MAJ } from '../mise-a-jour.js';
import { MARQUE_PROVISOIRE } from '../horloge.js';

const TEXTE_MAJ = {
  [ETATS_MAJ.aucune]: "L'appli est à jour (ou aucune vérification n'est possible hors ligne).",
  [ETATS_MAJ.disponible]: 'Une nouvelle version est prête : rechargez depuis l\'accueil.',
  [ETATS_MAJ.attenteFiche]: "Une mise à jour attend : une fiche est encore ouverte (elle s'installera après sa clôture).",
};

/**
 * @param {HTMLElement} conteneur
 * @param {{chargerProtocole: () => Promise<{ok: boolean, protocole?: object}>, stockage: object, auFermer: () => void}} options
 */
export function afficherAPropos(conteneur, { chargerProtocole, stockage, auFermer }) {
  const page = creer('section', 'ecran-info ecran-apropos', '', { 'aria-label': 'À propos' });
  const titre = creer('div', 'panneau-titre');
  titre.append(creer('h1', 'info-titre', 'À propos'), bouton('Fermer', 'bouton', auFermer, { id: 'fermer-apropos' }));
  page.append(titre, creer('p', null, PRESENTATION, { id: 'apropos-presentation' }), creer('p', 'cloture-avertissement', AVERTISSEMENT_GENERAL, { id: 'apropos-avertissement' }));

  const section = (titreSection, id) => { const s = creer('section', 'info-section', '', { id }); s.append(creer('h2', 'info-sous-titre', titreSection)); page.append(s); return s; };
  const liste = (parent, textes, classe = 'info-liste') => { const ul = creer('ul', classe); for (const t of textes) ul.append(creer('li', 'info-ligne', t)); parent.append(ul); return ul; };

  // versions, statut du protocole, mises à jour
  const versions = section('Versions', 'apropos-versions');
  const ligneAppli = creer('p', null, `Version de l'appli : ${globalThis.URGENCES_VERSION ?? '?'}`, { id: 'apropos-version' });
  const ligneProtocole = creer('p', null, 'Protocole : lecture…', { id: 'apropos-protocole' });
  const resultatMaj = creer('p', 'confirmation', '', { id: 'maj-resultat', role: 'status' });
  versions.append(ligneAppli, ligneProtocole,
    bouton('Vérifier les mises à jour', 'bouton', async () => { resultatMaj.textContent = 'Vérification…'; resultatMaj.textContent = TEXTE_MAJ[await verifierMisesAJour()] ?? ''; }, { id: 'maj-verifier' }), resultatMaj);

  // choix provisoires : ceux de l'appli tout de suite, ceux du protocole dès qu'il est lu
  const provisoires = section('Choix provisoires', 'apropos-provisoires');
  provisoires.append(creer('p', 'plan-aide', `Chacun est « ${MARQUE_PROVISOIRE} par le médecin référent » tant que Laurent ne l'a pas validé.`));
  const listeProvisoires = liste(provisoires, CHOIX_PROVISOIRES_APPLI.map((c) => `${c.id} — ${c.texte}`));
  listeProvisoires.id = 'provisoires-liste';

  // données, fuites, information du patient
  const donnees = section('Données et confidentialité', 'apropos-donnees');
  donnees.append(creer('p', null, RAPPEL_DONNEES), creer('p', 'cloture-avertissement', INFO_PATIENT, { id: 'apropos-info-patient' }));
  donnees.append(creer('h3', 'info-sous-sous-titre', "Ce que l'appli ne peut pas empêcher"));
  liste(donnees, FUITES, 'info-liste fuites');

  // appareil
  const appareil = section('Cet appareil', 'apropos-appareil');
  const env = lireEnvironnement();
  const persistance = creer('p', null, 'Stockage persistant : lecture…', { id: 'apropos-persistance' });
  liste(appareil, [`Mode installé : ${estInstallee(env) ? 'oui' : 'non'}`, ...lignesCapacites(globalThis.navigator), VERSIONS_MINIMALES]);
  appareil.append(persistance);

  // diagnostic (aucune donnée de patient)
  const diag = section('Diagnostic', 'apropos-diagnostic');
  const diagLignes = creer('p', null, 'Lecture…', { id: 'diagnostic', role: 'status' });
  diag.append(creer('p', 'plan-aide', "Sans aucune donnée de patient : seulement des nombres et des noms de bases."), diagLignes);

  conteneur.replaceChildren(page);

  // lectures asynchrones : chacune échoue en silence vers un message, jamais vers un écran vide
  (async () => {
    try {
      const r = await chargerProtocole();
      if (r?.ok) {
        const p = r.protocole;
        ligneProtocole.textContent = `Protocole « ${p.titre_court ?? p.id} » : version ${p.version ?? '?'} — ${statutProtocole(p)}`;
        const lp = choixProvisoiresProtocole(p);
        if (lp.length > 0) { const ul = creer('ul', 'info-liste'); for (const t of lp) ul.append(creer('li', 'info-ligne', `${t} — ${MARQUE_PROVISOIRE} par le médecin référent`)); provisoires.append(creer('h3', 'info-sous-sous-titre', 'Dans le protocole'), ul); }
      } else ligneProtocole.textContent = `Protocole illisible : ${(r?.raisons ?? ['cause inconnue']).join(' ; ')}`;
    } catch { ligneProtocole.textContent = 'Protocole : lecture impossible'; }
  })();
  (async () => {
    try {
      const s = globalThis.navigator?.storage;
      persistance.textContent = typeof s?.persisted !== 'function' ? 'Stockage persistant : non pris en charge' : `Stockage persistant : ${(await s.persisted()) ? 'oui' : 'non'}`;
    } catch { persistance.textContent = 'Stockage persistant : lecture impossible'; }
  })();
  (async () => {
    try {
      await stockage.vider();
      const reel = (await stockage.listerResumes('reel')).resumes.length;
      const simulation = (await stockage.listerResumes('simulation')).resumes.length;
      const bases = typeof globalThis.indexedDB?.databases === 'function' ? (await indexedDB.databases()).map((b) => b.name).sort() : null;
      diagLignes.textContent = `Fiches stockées : ${reel} réelle(s), ${simulation} simulation(s). Bases présentes : ${bases === null ? 'liste non fournie par ce navigateur' : bases.length === 0 ? 'aucune' : bases.join(', ')}.`;
    } catch { diagLignes.textContent = 'Diagnostic : lecture impossible'; }
  })();
}
