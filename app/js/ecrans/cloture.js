// Écran « Clôture et export » (cahier des charges 2.9, 2.11, 4.10). Un seul écran, deux entrées : le menu d'une intervention (Menu → Clôture et export)
// et la ligne « Exporter » d'une fiche en attente sur l'accueil (sans intervention : ni en-tête, ni barre, ni son).
// ORDRE DES PROPOSITIONS (remise en main propre d'abord, 2.11) : « Montrer au SMUR » et « Imprimer » ; ensuite seulement le partage (précédé d'un avertissement,
// jamais d'enregistrement par défaut) ; la copie dans le presse-papiers EN DERNIER, avec son avertissement ; puis « Le document a-t-il été remis ? » ;
// enfin « Clôturer et effacer » (actif après une remise confirmée) ou « Effacer sans exporter » (seconde confirmation explicite).
// Écran avec état propre : il se redessine lui-même et n'est jamais reconstruit sur un « changement » de l'intervention (l'interface le garde à l'écart).
import { creer, bouton, heureLocale } from '../dom.js';
import { construireTransmission, pageJournal } from '../bilan.js';
import {
  AVERTISSEMENT_PARTAGE, AVERTISSEMENT_SAUVEGARDE, AVERTISSEMENT_PRESSE_PAPIERS, RESUME_SANTE, RESUME_PRESSE_PAPIERS, QUESTION_REMISE, MOYENS, messageEffacement,
  peutPartager, partagerFichier, telechargerFichier, copierTexte, imprimerDocument, retirerImpression, empreinteContenu, viderPressePapiers, revoquerExports,
} from '../export.js';
import { afficherTransmission } from './transmission.js';

/**
 * Avertissement de SÛRETÉ allégé (lot R1e) : UNE phrase visible ; le texte complet (un ou plusieurs paragraphes) reste dans « Pourquoi ? » (`details`), jamais retiré :
 * on raccourcit l'avertissement, on ne le supprime pas. L'identifiant reste sur le bloc entier.
 */
function avertissementReplie(id, resume, details) {
  const bloc = creer('div', 'cloture-avertissement cloture-avertissement-replie', '', { id, role: 'note' });
  bloc.append(creer('p', 'cloture-resume', resume));
  const d = creer('details', 'cloture-pourquoi');
  d.append(creer('summary', null, 'Pourquoi ?'), ...details.map((t) => creer('p', null, t)));
  bloc.append(d);
  return bloc;
}

/**
 * @param {HTMLElement} conteneur
 * @param {{fiche: object, stockage: object, structure: () => object|null, champsSensibles: () => object, appelant: () => object|null, protocoleId: string|null,
 *          effacer: () => Promise<object>, apresEffacement: (res: object) => void, auFermer: () => void, libelleFermer?: string, auAction?: () => void}} ctx
 *   `effacer` efface CETTE fiche (l'appelant la termine d'abord si elle est encore en cours) et renvoie le résultat du stockage ;
 *   `apresEffacement` n'est appelé qu'en cas de succès (retour à l'accueil, message « Fiche effacée à hh:mm »).
 * @returns {{demonter: () => void}}
 */
export function afficherCloture(conteneur, ctx) {
  const { fiche, stockage } = ctx;
  const etat = { vue: 'cloture', tr: { page: 0, edition: false }, partage: false, question: false, moyen: null, message: '', erreur: '', confirmeEffacer: false, confirmeSans: false, occupe: false };
  let detruit = false;
  const entree = () => ({ fiche, structure: ctx.structure(), champsSensibles: ctx.champsSensibles(), appelant: ctx.appelant(), protocoleId: ctx.protocoleId, maintenant: Date.now() });

  function rendre() {
    if (detruit) return;
    if (etat.vue === 'smur') { rendreApercu(); return; }
    const page = creer('section', 'ecran-cloture', '', { 'aria-label': 'Clôture et export' });
    const titre = creer('div', 'panneau-titre');
    titre.append(creer('h1', 'cloture-titre', 'Clôture et export'), ...(ctx.auUrgence ? [bouton('URGENCE', 'bouton bouton-urgence', () => { demonter(); ctx.auUrgence(); }, { id: 'cloture-urgence' })] : []), bouton(ctx.libelleFermer ?? 'Fermer', 'bouton', () => { demonter(); ctx.auFermer(); }, { id: 'fermer-cloture' }));
    page.append(titre);

    // 1. remise en main propre : d'abord
    const main = creer('div', 'cloture-groupe cloture-main');
    main.append(
      bouton('Montrer au SMUR', 'bouton bouton-accent', () => { etat.vue = 'smur'; etat.tr = { page: 0, edition: false }; etat.message = ''; rendre(); }, { id: 'cloture-montrer' }),
      bouton('Imprimer', 'bouton', () => {
        etat.message = ''; etat.erreur = '';
        try { imprimerDocument(entree()); etat.moyen = 'impression'; etat.question = true; } catch { etat.erreur = "L'impression n'a pas pu être lancée sur cet appareil : montrez le document au SMUR."; }
        rendre();
      }, { id: 'cloture-imprimer' }),
    );
    page.append(main);

    // 2. partage : l'avertissement d'abord, le geste ensuite
    const partage = creer('div', 'cloture-groupe');
    if (!etat.partage) {
      partage.append(bouton('Partager ou enregistrer…', 'bouton bouton-plein', () => { etat.partage = true; etat.message = peutPartager(entree()) ? '' : "Le partage de fichier n'est pas disponible sur cet appareil : montrez ou imprimez le document, ou enregistrez-le dans un fichier."; rendre(); }, { id: 'cloture-partager' }));
    } else {
      partage.append(avertissementReplie('cloture-avertissement-partage', RESUME_SANTE, [AVERTISSEMENT_PARTAGE, AVERTISSEMENT_SAUVEGARDE]));
      if (peutPartager(entree())) {
        partage.append(bouton('Partager le fichier', 'bouton bouton-plein', async () => {
          etat.message = ''; etat.erreur = '';
          const r = await partagerFichier(entree());
          if (r.ok) { etat.moyen = 'partage'; etat.question = true; etat.partage = false; }
          else if (r.raison === 'indisponible') etat.message = "Le partage de fichier n'est pas disponible sur cet appareil.";
          else if (r.raison === 'echec') etat.erreur = "Le partage n'a pas abouti : réessayez, ou montrez ou imprimez le document.";
          rendre();
        }, { id: 'cloture-partager-fichier' }));
      }
      partage.append(
        bouton('Enregistrer le fichier', 'bouton bouton-plein', () => {
          try { telechargerFichier(entree()); etat.moyen = 'enregistrement'; etat.question = true; etat.partage = false; etat.message = ''; etat.erreur = ''; }
          catch { etat.erreur = "Le fichier n'a pas pu être enregistré sur cet appareil : montrez ou imprimez le document."; }
          rendre();
        }, { id: 'cloture-enregistrer' }),
        bouton('Annuler', 'bouton bouton-plein', () => { etat.partage = false; etat.message = ''; rendre(); }, { id: 'cloture-partage-annuler' }),
      );
    }
    page.append(partage);

    // 3. copie : en dernier, avec son avertissement lisible AVANT le geste
    const copie = creer('div', 'cloture-groupe');
    copie.append(
      // A12 : UN SEUL avertissement avant « Copier » (avant : deux pavés de ≈ 110 px). Les deux phrases sont fusionnées (données de santé, puis historique du clavier) et un « Pourquoi ? » unique garde
      // les textes complets : on raccourcit, on ne retire rien (R1e). R1f (m6) : quand le bloc partage est ouvert juste au-dessus, il dit déjà la phrase de santé : seule celle du presse-papiers reste.
      avertissementReplie('cloture-avertissement-copie', etat.partage ? RESUME_PRESSE_PAPIERS : `${RESUME_SANTE} ${RESUME_PRESSE_PAPIERS}`, etat.partage ? [AVERTISSEMENT_PRESSE_PAPIERS] : [AVERTISSEMENT_PARTAGE, AVERTISSEMENT_PRESSE_PAPIERS]),   // L8c (revue L8 M1) : données de santé, messagerie déconseillée — AVANT la copie (4.10.3)
      bouton('Copier le texte', 'bouton bouton-plein', async () => {
        etat.message = ''; etat.erreur = '';
        // l'appli retient qu'elle a écrit dans le presse-papiers AVANT d'écrire : si l'écriture aboutit à moitié, il sera quand même vidé à l'effacement
        stockage.modifier(fiche, (f) => { f.presse_papiers_utilise = true; }, { immediat: true });
        const r = await copierTexte(entree());
        if (r.ok) { etat.moyen = 'copie'; etat.question = true; } else etat.erreur = "La copie n'a pas pu être faite : l'appareil a refusé l'accès au presse-papiers.";
        rendre();
      }, { id: 'cloture-copier' }),
    );
    page.append(copie);

    page.append(creer('p', 'confirmation', etat.message, { id: 'cloture-message', role: 'status' }));
    if (etat.erreur) page.append(creer('p', 'noter-erreur', etat.erreur, { id: 'cloture-erreur', role: 'alert' }));

    // 4. « Le document a-t-il été remis ? »
    if (etat.question) {
      const q = creer('div', 'cloture-question', '', { id: 'cloture-question' });
      q.append(creer('p', null, QUESTION_REMISE),
        bouton('Oui', 'bouton bouton-accent', () => confirmerRemise(), { id: 'cloture-remis-oui' }),
        bouton('Non, réessayer', 'bouton', () => { etat.question = false; etat.moyen = null; rendre(); }, { id: 'cloture-remis-non' }));
      page.append(q);
    }
    // L8c (revue L8 M2) : une donnée ajoutée APRÈS la remise la périme — le SMUR a un document incomplet ; on ne laisse pas effacer ce qui n'a pas été remis
    const perime = Boolean(fiche.export?.empreinte) && fiche.export.empreinte !== empreinteContenu(entree());
    if (perime) page.append(creer('p', 'cloture-avertissement', `Fiche modifiée depuis la remise de ${heureLocale(fiche.export.fait_le)} — exportez à nouveau (ou choisissez « Effacer sans exporter »).`, { id: 'cloture-perime', role: 'alert' }));
    if (fiche.export && !perime) page.append(creer('p', 'cloture-statut', `Remise confirmée à ${heureLocale(fiche.export.fait_le)} (${MOYENS[fiche.export.moyen] ?? fiche.export.moyen})`, { id: 'cloture-statut', role: 'status' }));

    // 5. clôture
    const fin = creer('div', 'cloture-groupe cloture-fin');
    const exportee = Boolean(fiche.export) && !perime;
    if (etat.confirmeEffacer) {
      fin.append(creer('p', 'cloture-avertissement', 'Effacer définitivement cette fiche de cet appareil ?'),
        bouton('Confirmer : clôturer et effacer', 'bouton bouton-urgence bouton-plein', () => effacer(), { id: 'cloture-effacer-confirme' }),
        bouton('Annuler', 'bouton bouton-plein', () => { etat.confirmeEffacer = false; rendre(); }, { id: 'cloture-effacer-annuler' }));
    } else {
      const b = bouton('Clôturer et effacer', 'bouton bouton-plein', () => { etat.confirmeEffacer = true; etat.confirmeSans = false; rendre(); }, { id: 'cloture-effacer' });
      b.disabled = !exportee || etat.occupe;
      fin.append(b);
      // bouton grisé : on dit une fois, en petit, ce qui le débloque (aucune explication ailleurs sur l'écran)
      if (!exportee) { b.setAttribute('aria-describedby', 'cloture-effacer-aide'); fin.append(creer('p', 'cloture-aide', 'Possible une fois la remise confirmée (montrer, imprimer, partager…)', { id: 'cloture-effacer-aide' })); }
    }
    if (!exportee) {
      if (etat.confirmeSans) {
        fin.append(creer('p', 'cloture-avertissement', 'Effacer cette fiche SANS l\'avoir remise ni exportée ? Cela ne peut pas être annulé.'),
          bouton('Oui, effacer sans export', 'bouton bouton-urgence bouton-plein', () => effacer(), { id: 'cloture-sans-export-confirme' }),
          bouton('Annuler', 'bouton bouton-plein', () => { etat.confirmeSans = false; rendre(); }, { id: 'cloture-sans-export-annuler' }));
      } else {
        fin.append(bouton('Effacer sans exporter', 'bouton bouton-plein', () => { etat.confirmeSans = true; etat.confirmeEffacer = false; rendre(); }, { id: 'cloture-sans-export' }));
      }
    }
    page.append(fin);
    conteneur.replaceChildren(page);
  }

  /** Aperçu « Montrer au SMUR » : les pages du mode transmission, en gros caractères, SANS modification possible ici. */
  function rendreApercu() {
    const pages = [...construireTransmission(entree()), pageJournal(fiche)];   // + la frise du journal (L8c, revue L8 m3)
    afficherTransmission(conteneur, {
      pages, etat: etat.tr, intervention: null,
      auFermer: () => { etat.vue = 'cloture'; etat.moyen = 'montre'; etat.question = true; rendre(); },   // au retour : « Le document a-t-il été remis ? »
      auRendre: rendre,
    });
  }

  /** « Oui » : la remise est enregistrée dans la fiche (moyen, heure) et au journal ; « Clôturer et effacer » devient actif. */
  function confirmerRemise() {
    const moyen = etat.moyen ?? 'montre';
    stockage.journaliser(fiche, 'export', { moyen });
    stockage.modifier(fiche, (f) => { f.export = { fait_le: Date.now(), moyen, empreinte: empreinteContenu(entree()) }; }, { immediat: true });
    etat.question = false; etat.moyen = null; etat.message = '';
    rendre();
  }

  async function effacer() {
    if (etat.occupe) return;
    // M3 (revue L8) : le presse-papiers est vidé EN PREMIER, dans le toucher, avant toute attente — l'iPhone n'autorise l'écriture que dans le geste de l'utilisateur.
    // Sans risque : si l'effacement échoue, la fiche est encore là et on peut recopier. m1 : les adresses « blob: » du fichier enregistré sont révoquées aussitôt.
    const vidage = fiche.presse_papiers_utilise ? viderPressePapiers() : null;
    revoquerExports();
    etat.occupe = true; etat.confirmeEffacer = false; etat.confirmeSans = false; etat.message = 'Effacement en cours…'; etat.erreur = '';
    rendre();
    let res;
    try { res = await ctx.effacer(); } catch (e) { res = { ok: false, raison: e?.message ?? 'effacement impossible' }; }
    etat.occupe = false;
    if (res?.ok) {
      if (vidage && (await vidage) === 'vide') res = { ...res, pressePapiers: 'vide' };   // vidé dans le geste : c'est ce qui compte, même si le second essai du stockage est refusé
      demonter(); ctx.apresEffacement(res); return;
    }
    etat.message = ''; etat.erreur = messageEffacement(res);
    rendre();
  }

  // D-89 (n-1), D-90 (m-2) : tout toucher dans la clôture ET dans son aperçu « Montrer au SMUR » est une action du soignant sur CET écran : il le dit à l'appelant (qui invalide alors une ouverture lente
  // d'un autre écran, restée en cours). Un seul écouteur sur le conteneur, posé ici (hors de `rendre`, que l'aperçu ne traverse pas) et retiré par `demonter`.
  // D-90b (m-1) : filet — si l'écran a été remplacé sans passer par `demonter`, le toucher suivant retire l'écouteur au lieu d'appeler `auAction` (la clôture et son aperçu portent chacun leur page).
  const auToucher = () => { if (!conteneur.querySelector('.ecran-cloture, .ecran-transmission')) { demonter(); return; } try { ctx.auAction?.(); } catch { /* l'écran ne dépend jamais de ce rappel */ } };
  conteneur.addEventListener('click', auToucher, true);

  function demonter() { detruit = true; conteneur.removeEventListener('click', auToucher, true); retirerImpression(); }

  rendre();
  return { demonter };
}
