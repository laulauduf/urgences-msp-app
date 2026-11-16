// Écran ACR « aide-mémoire » (refonte R1, décisions D-36, D-37, D-39 ; maquette `specs/maquette/maquette-acr-2026-11-15.html`).
// UN seul écran pour la conduite à tenir : pastilles (Conduite à tenir · Matériel · Reprise · Sources), liste courte en ≈ 3 mots (`texte_court`) avec, au plus, une
// précision d'une ligne dépliable (`precision`), case = « fait » avec l'heure T+. Le reste (texte détaillé, sources, statut, habilitations, acronymes, sous-étapes) est
// dans « Sources », à un toucher : plus rien de tout cela sur la conduite à tenir. Même objet que l'ancienne checklist : `fiche.checklist[id] = {coche_le}`.
// RÈGLES : aucun libellé, ordre ni habilitation médicale ici (tout vient du protocole et de professions.json) ; textes via textContent seulement ;
// l'information ne passe jamais par la couleur seule (icône + texte) ; l'état d'affichage (précisions dépliées, saisie de l'heure, pastille courante) vit dans `etat`,
// fourni par l'interface, pour survivre au redessin de l'écran — et la saisie de l'heure n'est jamais perdue.
// CHAMPS OPTIONNELS DU PROTOCOLE lus ici (PROVISOIRE, pilote à confirmer) : `precision` (string, une ligne) ; `phase` (string : intertitre affiché quand il change d'une
// étape à l'autre, ex. « Protéger », « Alerter ») ; `section` (« reprise » range l'étape sous la pastille Reprise, sinon Conduite à tenir).
import { creer, bouton, heureLocale } from '../dom.js';
import { formaterDuree, MARQUE_PROVISOIRE, MARQUE_A_VALIDER } from '../horloge.js';
import { texteSource, MENTION_SUR_DEMANDE, positionGeste } from '../checklist.js';
import { detailHabilitation } from '../habilitations.js';
import { construireDefinition } from './glossaire.js';
import { afficherMateriel } from './materiel.js';
import { construireMateriel } from '../materiel.js';
import { valeurEtape } from '../saisie-etape.js';
import { construireZoneSaisie } from './etape-saisie.js';

/** État d'affichage de l'écran ACR, conservé par l'interface entre deux dessins. */
export function etatAcrInitial() { return { deplies: new Set(), acronymes: new Set(), notation: null, section: 'conduite', evenements: false, confirmation: null }; }

const STATUTS = { CITE: 'CITÉ', DEDUIT: 'DÉDUIT', A_VALIDER: 'A_VALIDER' };
const heureCourante = () => heureLocale(Date.now());
const plein = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {HTMLElement} conteneur
 * @param {{intervention: object, etat: ReturnType<typeof etatAcrInitial>, structure: object|null, auAlerte: () => void, auRendre: () => void, avantEcran?: Node[], zoneCycle?: HTMLElement}} options
 *   `avantEcran` : éléments posés AVANT les pastilles (équipe, annulation) ; `zoneCycle` : la carte du cycle, collée en haut de la liste.
 *   Réutilisation par la checklist COMMUNE de « Autre situation » (D-51), sans toucher à la logique de l'ACR : `vue` et `protocole` remplacent ceux de l'intervention
 *   (par défaut, l'ACR), `classe` est la classe de la section, `sansMateriel` retire la pastille Matériel (pas de matériel propre à une checklist commune),
 *   `auRenvoi(idProtocole)` est appelée quand on TOUCHE le bouton « Passer en ACR » d'une étape qui porte `renvoi_protocole` (R1f, M1 : ce n'est PLUS une case) ; `renvoiPossible(idProtocole)` dit si l'interface sait ouvrir ce protocole (sinon l'étape reste une case ordinaire).
 */
export function afficherAcr(conteneur, { intervention, etat, structure, auAlerte, auRendre, avantEcran = [], zoneCycle = null, vue = intervention.vueChecklist, protocole = intervention.protocole, classe = 'ecran-acr', sansMateriel = false, auRenvoi = null, renvoiPossible = () => false, renvoiCibles = null }) {
  const page = creer('section', classe, '', { 'aria-label': protocole?.titre_court ?? 'ACR' });
  const debut = intervention.fiche.journal[0].t;
  const tPlus = (t) => `T+${formaterDuree(t - debut)}`;
  const racines = vue.racines;
  const enReprise = racines.filter((r) => r.etape.section === 'reprise');
  const enConduite = racines.filter((r) => r.etape.section !== 'reprise');
  const sections = [
    { id: 'conduite', libelle: 'Conduite à tenir' },
    ...(sansMateriel ? [] : [{ id: 'materiel', libelle: 'Matériel' }]),
    ...(enReprise.length > 0 ? [{ id: 'reprise', libelle: 'Reprise' }] : []),
    { id: 'sources', libelle: 'Sources' },
  ];
  if (!sections.some((s) => s.id === etat.section)) etat.section = 'conduite';

  const rendre = () => auRendre();
  const cocher = (id) => {
    const r = intervention.cocherDepuisChecklist(id);
    // étape réservée aux habilités, profession non habilitée ou non réglée (D-58, P4d M1) : rien n'est coché ; la confirmation « fait sur demande du 15 » s'ouvre sous la ligne
    if (r.confirmationRequise) { etat.confirmation = id; rendre(); return; }
    etat.confirmation = null;
    if (r.ouvrirAlerte) { auAlerte(); return; }
    rendre();
  };
  const confirmer = (id) => { etat.confirmation = null; intervention.cocherDepuisChecklist(id, { confirme: true }); rendre(); };
  /** Cible d'un renvoi affichable en bouton (D-51, R1f M1) : `renvoi_protocole` textuel, non vide, que l'interface sait ouvrir ; sinon null (l'étape reste une case ordinaire). */
  const renvoiDe = (e) => (auRenvoi && typeof e.renvoi_protocole === 'string' && e.renvoi_protocole !== '' && renvoiPossible(e.renvoi_protocole)) ? e.renvoi_protocole : null;
  /**
   * Les boutons d'un renvoi (P4a) : par défaut un seul, « Passer en ACR » vers la cible du protocole. Quand l'interface propose plusieurs protocoles de même nature (`renvoiCibles` : ACR adulte
   * ET enfant), un bouton par protocole, nommé par le protocole ; la cible du protocole est la PREMIÈRE (elle seule porte `data-renvoi`).
   */
  const boutonsRenvoi = (cible, id) => {
    const cibles = renvoiCibles ? renvoiCibles(cible) : [];
    const liste = cibles.length > 0 ? [...cibles].sort((a, b) => (b.id === cible) - (a.id === cible)) : [{ id: cible, libelle: 'Passer en ACR' }];
    return liste.map((c, rang) => bouton(liste.length > 1 ? c.libelle : 'Passer en ACR', 'bouton bouton-urgence bouton-renvoi', () => auRenvoi(c.id), rang === 0 ? { 'data-renvoi': id, 'data-cible': c.id, 'data-vital': 'renvoi' } : { 'data-renvoi-autre': id, 'data-cible': c.id, 'data-vital': 'renvoi' }));   // `data-vital` (D-64d) : navigation SANS effet d'écriture autre qu'un changement de situation : elle agit tout de suite, même volet ouvert
  };
  const noter = (id) => { etat.notation = { id, valeur: heureCourante(), erreur: null }; rendre(); };
  const valider = () => {
    const n = etat.notation;
    const r = intervention.noterGeste(n.id, n.valeur);
    if (r.ok) { etat.notation = null; rendre(); } else { n.erreur = r.raison; rendre(); }
  };

  // habilitations illisibles : on le DIT (sinon « habilitation non établie » semble une décision), avec la conséquence (revue L6 m2)
  const illisibles = intervention.habilitationsEtat === 'absent'
    ? creer('p', 'avertissement-checklist', "Habilitations par profession illisibles : seules les étapes vitales et les étapes ouvertes à tous sont cochables. Vérifiez l'installation de l'appli.", { id: 'habilitations-illisibles', role: 'status' })
    : null;

  // ───── pièces communes ─────
  /**
   * Marques d'état d'une ligne. Sur la LISTE (complet = faux) : fait à T+, noté, non faite (mot simple, sans cadre), habilitation — le « provisoire » et l'« A_VALIDER » ne sont plus des
   * badges mais un signe ✱ après le libellé (relecture design D4) ; dans SOURCES (complet = vrai) les mentions complètes sont toutes là.
   */
  const marques = (item, { complet = false } = {}) => {
    const e = item.etape;
    const m = creer('div', 'etape-marques');
    if (item.cochee) m.append(creer('span', 'etape-fait', `fait à ${tPlus(item.coche_le)}`));
    if (item.notee) {
      // un geste noté avant le début de l'intervention (cas courant : on agit avant de sortir le téléphone) le dit, au lieu d'afficher « T+00:00 » (revue L6 m6)
      // A4 : l'écart qui vient seulement de l'arrondi à la minute (hh:mm) n'est PAS « avant le début »
      const pos = positionGeste(item.notee.t, debut);
      const rel = pos.avantDebut ? `avant le début, T−${formaterDuree(pos.ecartMs)}` : `T+${formaterDuree(pos.ecartMs)}`;
      m.append(creer('span', 'etape-notee', `noté fait à ${heureLocale(item.notee.t)} (${rel})`));
    }
    if (item.nonFaite && renvoiDe(e) === null) m.append(creer('span', 'marque-non-faite', '⚠ non faite'));
    if (complet && e.statut === 'DEDUIT') m.append(creer('span', 'marque', 'DÉDUIT'));   // r2 : le statut DÉDUIT se voit dès le titre replié de Sources
    if (complet && e.statut === 'A_VALIDER') m.append(creer('span', 'marque marque-a-valider', MARQUE_A_VALIDER));   // (la marque porte déjà son « ⚠ » : P4a, il s'affichait en double)
    if (complet && typeof e.provisoire === 'string') m.append(creer('span', 'marque marque-provisoire', MARQUE_PROVISOIRE));   // « provisoire » seulement si le protocole le porte (R15)
    // pas de mention sur une étape VITALE : elle reste cochable pour tous (règle absolue 5), la mention contredirait la case active (revue L6 m1)
    // profession non réglée : la ligne en tête de l'écran le dit une fois pour toutes ; seule une profession RÉGLÉE affiche la mention sur chaque ligne concernée
    if (item.reserve) {
      // étape réservée aux habilités (D-58) : « sur demande du 15 » pour une profession réglée non habilitée tant qu'elle n'est pas faite ; une fois faite, la mention dit comment (jamais « non proposé »)
      if (item.surDemande && !item.cochee) m.append(creer('span', complet ? 'marque marque-habilitation' : 'etape-habilitation etape-sur-demande', MENTION_SUR_DEMANDE));
      if (item.cocheeSurDemande) m.append(creer('span', 'etape-fait etape-sur-demande', MENTION_SUR_DEMANDE));
    } else if (item.habilitation !== 'oui' && !item.exempte && (complet || intervention.profession !== null)) {
      const texte = item.habilitation === 'non' ? 'non proposé pour votre profession' : 'habilitation non établie';
      const cause = intervention.profession === null || intervention.professionReconnue ? '' : ' (profession non reconnue)';
      m.append(creer('span', complet ? 'marque marque-habilitation' : 'etape-habilitation', `⚠ ${texte}${cause}`));
    }
    return m;
  };

  const formulaireNotation = (item) => {
    const f = creer('div', 'noter-formulaire', '', { 'data-etape': item.id });
    const etiquette = creer('label', null, 'Heure du geste (hh:mm) : ', { for: 'noter-heure' });
    const saisie = creer('input', null, '', { id: 'noter-heure', type: 'time', value: etat.notation.valeur, autocomplete: 'off' });
    saisie.addEventListener('input', () => { etat.notation.valeur = saisie.value; });     // la frappe survit à un redessin
    f.append(etiquette, saisie);
    if (etat.notation.erreur) f.append(creer('p', 'noter-erreur', etat.notation.erreur, { role: 'alert' }));
    f.append(bouton('Noter', 'bouton bouton-accent', valider, { id: 'noter-valider' }), bouton('Annuler', 'bouton', () => { etat.notation = null; rendre(); }, { id: 'noter-annuler' }));
    return f;
  };

  const acronymes = (item) => {
    const liste = Array.isArray(item.etape.acronymes) ? item.etape.acronymes : [];
    if (liste.length === 0) return null;
    const zone = creer('div', 'acronymes');
    zone.append(creer('span', 'acronymes-etiquette', 'Acronymes :'));
    for (const a of liste) {
      const cle = `${item.id}:${a}`;
      const entree = intervention.glossaire.parId.get(a) ?? null;
      const def = creer('div', 'acronyme-definition', '', { 'data-acronyme': a });
      def.append(construireDefinition(entree, { sigle: a }));
      def.hidden = !etat.acronymes.has(cle);
      const b = bouton(entree?.forme_courte ?? a, 'bouton acronyme', () => {
        if (etat.acronymes.has(cle)) etat.acronymes.delete(cle); else etat.acronymes.add(cle);
        def.hidden = !etat.acronymes.has(cle);
        b.setAttribute('aria-expanded', String(!def.hidden));
      }, { 'data-acronyme': a, 'aria-expanded': String(!def.hidden) });
      zone.append(b, def);
    }
    return zone;
  };

  /** Détail d'une étape (pastille Sources) : texte, référence, sources, statut (CITÉ / DÉDUIT / A_VALIDER), raisonnement, habilitation de la profession, acronymes. */
  const detail = (item) => {
    const e = item.etape;
    const d = creer('div', 'etape-detail');
    if (plein(e.detail)) d.append(creer('p', null, e.detail));
    if (plein(e.ref_fiche)) d.append(creer('p', null, `Référence : ${e.ref_fiche}`));
    if (Array.isArray(e.sources) && e.sources.length > 0) {
      const ul = creer('ul', 'definition-sources');
      for (const s of e.sources) ul.append(creer('li', null, texteSource(s)));
      d.append(creer('p', 'definition-etiquette', 'Sources :'), ul);
    }
    d.append(creer('p', null, `Statut : ${STATUTS[e.statut] ?? String(e.statut ?? 'non indiqué')}`));
    if (e.statut === 'DEDUIT' && typeof e.raisonnement === 'string') d.append(creer('p', null, `Raisonnement : ${e.raisonnement}`));
    if (plein(e.a_valider)) d.append(creer('p', null, `À valider : ${e.a_valider}`));
    // l'habilitation du profil d'après professions.json : valeur, statut, sources et texte de la restriction (4.13 : « chaque restriction renvoie à son texte », revue L6 m4)
    const h = detailHabilitation(e, intervention.profession, intervention.habilitations);
    if (h) {
      const nom = intervention.habilitations?.libelles?.[h.groupe] ?? h.groupe;
      d.append(creer('p', 'definition-etiquette', `Habilitation pour ${nom} : ${h.valeur}${h.statut ? ` (${STATUTS[h.statut] ?? h.statut})` : ''}`));
      if (h.sources.length > 0) { const ul = creer('ul', 'definition-sources'); for (const s of h.sources) ul.append(creer('li', null, texteSource(s))); d.append(ul); }
      if (h.raisonnement) d.append(creer('p', null, `Raisonnement : ${h.raisonnement}`));
      if (h.a_valider) d.append(creer('p', null, `À valider : ${h.a_valider}`));
    }
    const ac = acronymes(item);
    if (ac) d.append(ac);
    return d;
  };

  // ───── la liste « conduite à tenir » (et « reprise ») ─────
  const etatDeLigne = (item) => (item.nonFaite ? 'non_faite' : item.cochee ? 'faite' : item.notee ? 'notee' : item.cochable ? 'a_faire' : 'info');
  /** Case de l'étape (ou signe d'information quand elle ne se coche pas). Une fonction à part : la saisie dans l'étape la remplace sans redessiner la liste. */
  const marqueur = (item) => {
    const e = item.etape;
    if (item.cochable || item.cochee) {
      // une étape déjà cochée garde sa case (pour pouvoir la décocher) même si la profession a changé ; sinon elle ne se coche que si elle est cochable
      const c = bouton(item.cochee ? '✓' : '', 'bouton case', () => cocher(item.id), {
        'data-case': item.id, 'aria-pressed': String(item.cochee), 'aria-label': `${e.texte_court} : ${item.cochee ? 'faite' : 'à faire'}`,
      });
      if (!item.cochable && !item.cochee) c.disabled = true;   // une case cochée reste décochable même si la profession a changé (revue L6 m5)
      return c;
    }
    return creer('span', 'etape-info', item.notee ? '✎' : 'ℹ', { 'aria-hidden': 'true' });
  };
  /** G1 : après une saisie dans une étape, la LIGNE de l'étape suit la fiche (case, « fait à T+ », valeur sous le libellé) SANS redessiner l'écran : la frappe et le clavier ne sont jamais interrompus. */
  const majSaisie = (id) => {
    const it = intervention.itemChecklist(id);
    const li = [...page.querySelectorAll('li.etape')].find((l) => l.dataset.etape === id);
    if (!it || !li) return;
    li.dataset.etat = etatDeLigne(it);
    const premier = li.firstElementChild;
    if (premier && (premier.classList.contains('case') || premier.classList.contains('etape-info'))) premier.replaceWith(marqueur(it));
    li.querySelector('.etape-marques')?.replaceWith(marques(it));
    const v = li.querySelector('[data-valeur]');
    if (v) { const t = valeurEtape(intervention.fiche, it.etape.saisie); v.textContent = t; v.hidden = t === ''; }
  };
  const ligne = (item) => {
    const e = item.etape;
    const precision = plein(e.precision) ? e.precision.trim() : '';
    // D-61 (lot V1) : une étape qui porte `precision_visible: true` (« Se protéger », « Respire ? ») garde sa précision TOUJOURS affichée, en petit, sous le libellé, sans dépliage ; les autres restent dépliables
    const visible = precision !== '' && e.precision_visible === true;
    // dépliable : la précision, et — pour une action que cette profession ne peut pas cocher — « Noter : fait à hh:mm » (hors de la ligne : une carte = une hauteur)
    const saisie = intervention.saisiePermise(item);   // M4 : champ connu, étape non vitale, APRÈS toute étape vitale, jamais dans un arrêt cardiaque (même condition que la règle R20 du contrôle)
    const noterDispo = item.restreint && !item.cochee && !saisie;   // (une étape de recueil se saisit : la donnée est notée avec sa valeur, pas « fait à hh:mm »)
    const depliable = (precision !== '' && !visible) || noterDispo || saisie;
    const ouverte = depliable && (etat.deplies.has(item.id) || etat.notation?.id === item.id);
    const cibleRenvoi = renvoiDe(e);
    if (cibleRenvoi !== null) {
      // RENVOI (R1f, M1, CHOIX PROVISOIRE) : pas de case (cocher « vérifié » ne doit jamais déclarer un arrêt cardiaque) ; un bouton rouge net, un toucher, jamais « non faite ».
      const lr = creer('li', 'etape etape-renvoi', '', { 'data-etape': item.id, 'data-etat': 'renvoi' });
      if (item.vitale) lr.dataset.vitale = 'oui';
      lr.append(creer('span', 'etape-texte', e.texte_court));
      const boutons = boutonsRenvoi(cibleRenvoi, item.id);
      if (boutons.length === 1) lr.append(boutons[0]);
      else { const groupe = creer('span', 'renvoi-boutons'); groupe.append(...boutons); lr.append(groupe); lr.classList.add('etape-renvoi-multi'); }   // plusieurs boutons : sous le libellé, sur toute la largeur (sinon le libellé est écrasé)
      return lr;
    }
    const li = creer('li', 'etape', '', { 'data-etape': item.id, 'data-etat': etatDeLigne(item) });
    if (item.vitale) li.dataset.vitale = 'oui';   // (même l'étape réservée aux habilités, qui n'est plus « exempte ») étape vitale : barre verticale et libellé en graisse 800 (jamais de rouge : réservé au 15)
    li.append(marqueur(item));
    // G1 (D-66, D-69 variante A) : une étape de recueil porte `saisie` dans les DONNÉES du protocole ; seule une étape que le contrôle R20 a laissée passer (jamais vitale, jamais avant l'alerte)
    // se déplie sur des puces ou un champ. Toucher son NOM la déplie (D-72) ; la case reste séparée ; la valeur saisie s'affiche sous le libellé, la case se coche toute seule.
    const texte = creer('span', 'etape-texte', e.texte_court);
    // ✱ = « provisoire » ou « à valider » (légende dans le bandeau BROUILLON ; détail dans Sources) : un signe, pas un badge
    const incertainSoi = (x) => typeof x.etape.provisoire === 'string' || x.etape.statut === 'A_VALIDER';
    const incertainDesc = (x) => x.enfants.some((c) => incertainSoi(c) || incertainDesc(c));
    const incertain = incertainSoi(item) || incertainDesc(item);   // une sous-étape provisoire ou à valider se voit aussi sur sa mère (revue R1, M3)
    if (incertain) texte.append(creer('sup', 'etoile', '✱', { 'aria-label': incertainSoi(item) ? (typeof e.provisoire === 'string' ? MARQUE_PROVISOIRE : MARQUE_A_VALIDER) : `${MARQUE_A_VALIDER} (détail)`, role: 'img' }));
    if (depliable) {
      const titre = bouton('', 'bouton etape-titre', () => {
        if (etat.deplies.has(item.id)) etat.deplies.delete(item.id); else etat.deplies.add(item.id);
        rendre();
      }, { 'data-deplier': item.id, 'aria-expanded': String(ouverte) });
      if (noterDispo) texte.append(creer('span', 'etape-noter-indice', ' ✎', { 'aria-label': 'noter l\'heure possible', role: 'img' }));
      else if (saisie) texte.append(creer('span', 'etape-noter-indice', ' ✎', { 'aria-label': 'saisie possible', role: 'img' }));
      titre.append(texte, creer('span', 'etape-fleche', '', { 'aria-hidden': 'true', 'data-ouverte': String(ouverte) }));
      li.append(titre);
    } else {
      const titre = creer('div', 'etape-titre sans-precision');
      titre.append(texte);
      li.append(titre);
    }
    if (visible) li.append(creer('p', 'etape-precision etape-precision-visible', precision, { 'data-precision': item.id }));   // juste sous le libellé, avant les marques (fait à T+…)
    if (saisie) {
      // la valeur saisie sous le libellé (lue dans la fiche : jamais une seconde copie) ; masquée tant que rien n'est saisi
      const v = valeurEtape(intervention.fiche, e.saisie);
      li.append(creer('p', 'etape-valeur', v, { 'data-valeur': item.id, ...(v === '' ? { hidden: '' } : {}) }));
    }
    li.append(marques(item));
    if (etat.confirmation === item.id && item.surDemande && !item.cochee) {
      // confirmation « fait sur demande du 15 » (D-58) : deux boutons sous la ligne, la case ne se coche qu'au second geste ; Annuler ne coche rien
      const c = creer('div', 'demande-confirmation', '', { 'data-confirmation': item.id, role: 'group', 'aria-label': `${e.texte_court} : confirmer ${MENTION_SUR_DEMANDE}` });
      c.append(
        bouton(`Confirmer : fait ${MENTION_SUR_DEMANDE}`, 'bouton bouton-accent bouton-plein', () => confirmer(item.id), { 'data-confirmer': item.id }),
        bouton('Annuler', 'bouton bouton-plein', () => { etat.confirmation = null; rendre(); }, { 'data-annuler-confirmation': item.id }),
      );
      li.append(c);
    }
    if (ouverte) {
      if (precision !== '' && !visible) li.append(creer('p', 'etape-precision', precision, { 'data-precision': item.id }));
      if (noterDispo) {
        if (etat.notation?.id === item.id) li.append(formulaireNotation(item));
        else li.append(bouton('Noter : fait à hh:mm', 'bouton noter', () => noter(item.id), { 'data-noter': item.id }));
      }
      if (saisie) li.append(construireZoneSaisie({ intervention, item, auSaisie: () => majSaisie(item.id) }));
    }
    return li;
  };

  const liste = (items) => {
    const ul = creer('ul', 'checklist-liste');
    let phase = null;
    for (const item of items) {
      const p = plein(item.etape.phase) ? item.etape.phase.trim() : null;
      if (p !== null && p !== phase) { ul.append(creer('li', 'phase', p)); phase = p; }
      ul.append(ligne(item));
    }
    return ul;
  };

  // ───── les sections ─────
  /** Une sous-étape dans Sources (revue R1, M3) : son libellé et ses marques complètes en titre, puis — repliés — son détail, ses sources, son statut (DÉDUIT, A_VALIDER…), ses acronymes, et ses propres sous-étapes. */
  const sousEtape = (c) => {
    const d = creer('details', 'sources-sous-etape', '', { 'data-etape': c.id });
    const titre = creer('summary', 'sources-sous-titre');
    titre.append(creer('span', 'etape-texte', c.etape.texte_court), marques(c, { complet: true }));
    d.append(titre, detail(c));
    if (c.enfants.length > 0) { const sous = creer('div', 'sources-sous'); for (const e of c.enfants) sous.append(sousEtape(e)); d.append(sous); }
    return d;
  };

  const sectionSources = () => {
    const bloc = creer('section', 'bloc-section sources', '', { id: 's-sources', 'aria-label': 'Sources' });
    bloc.append(creer('h2', null, 'Sources, statut et habilitations'));
    bloc.append(creer('p', 'plan-aide', '✱ sur la liste : contenu provisoire ou à valider (détail de chaque étape ci-dessous).'));
    if (racines.length === 0) bloc.append(creer('p', 'plan-aide', 'Aucune étape dans le protocole.', { role: 'status' }));
    for (const item of racines) {
      const bloc1 = creer('div', 'sources-etape', '', { 'data-etape': item.id });
      bloc1.append(creer('h3', null, item.etape.texte_court), marques(item, { complet: true }), detail(item));
      if (item.enfants.length > 0) {
        const sous = creer('div', 'sources-sous');
        for (const c of item.enfants) sous.append(sousEtape(c));
        bloc1.append(sous);
      }
      bloc.append(bloc1);
    }
    return bloc;
  };

  const sectionMateriel = () => {
    const bloc = creer('section', 'bloc-section', '', { id: 's-materiel' });
    afficherMateriel(bloc, { modele: construireMateriel({ protocole, structure }), avecArticles: true, integre: true });
    return bloc;
  };

  // ───── assemblage ─────
  if (etat.section === 'conduite' || etat.section === 'reprise') for (const x of avantEcran) page.append(x);   // équipe et annulation : seulement sur la conduite à tenir
  const pastilles = creer('div', 'pastilles', '', { role: 'group', 'aria-label': 'Sections' });
  for (const s of sections) {
    pastilles.append(bouton(s.libelle, 'bouton pastille', () => { etat.section = s.id; rendre(); conteneur.scrollTop = 0; }, { 'data-section': s.id, 'aria-pressed': String(etat.section === s.id) }));
  }
  page.append(pastilles);
  if (illisibles) page.append(illisibles);
  if (zoneCycle) page.append(zoneCycle);   // la carte du cycle reste visible quelle que soit la pastille
  if (etat.section === 'conduite') page.append(liste(enConduite));
  else if (etat.section === 'reprise') page.append(liste(enReprise));
  else if (etat.section === 'materiel') page.append(sectionMateriel());
  else page.append(sectionSources());
  conteneur.replaceChildren(page);
}
