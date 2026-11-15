// Écran « Checklist » (cahier des charges 4.5) : mode expert (liste compacte, critiques épinglées, case = cochée et horodatée) et mode guidé
// (une consigne à la fois, « Vue d'ensemble » permanent). Même objet que les tuiles : `fiche.checklist[id]`.
// RÈGLES : aucun libellé, ordre ni habilitation médicale ici (tout vient du protocole et de professions.json) ; textes via textContent seulement ;
// l'information ne passe jamais par la couleur seule (icône + texte) ; l'état d'affichage (étapes dépliées, saisie de l'heure) vit dans `etat`,
// fourni par l'interface, pour survivre au redessin de l'écran — et la saisie de l'heure n'est jamais perdue.
import { creer, bouton, heureLocale } from '../dom.js';
import { formaterDuree, MARQUE_PROVISOIRE } from '../horloge.js';
import { etapeGuidee, texteSource } from '../checklist.js';
import { construireDefinition } from './glossaire.js';

/** État d'affichage de la checklist, conservé par l'interface entre deux dessins. */
export function etatChecklistInitial() { return { deplies: new Set(), acronymes: new Set(), notation: null, courante: null }; }

const STATUTS = { CITE: 'CITÉ', DEDUIT: 'DÉDUIT', A_VALIDER: 'A_VALIDER' };
const heureCourante = () => heureLocale(Date.now());

/**
 * @param {HTMLElement} conteneur
 * @param {{intervention: object, etat: ReturnType<typeof etatChecklistInitial>, auAlerte: () => void, auRendre: () => void}} options
 */
export function afficherChecklist(conteneur, { intervention, etat, auAlerte, auRendre }) {
  const mode = intervention.modeChecklist === 'guide' ? 'guide' : 'expert';
  const vue = intervention.vueChecklist;
  const page = creer('section', 'ecran-checklist', '', { 'data-mode': mode, 'aria-label': 'Checklist' });
  const debut = intervention.fiche.journal[0].t;
  const tPlus = (t) => `T+${formaterDuree(t - debut)}`;

  // ───── actions communes ─────
  const rendre = () => auRendre();
  // changer de mode repart du haut de l'écran : on ne reste pas au milieu d'une liste qu'on ne voit plus
  const basculer = (vers) => { intervention.definirModeChecklist(vers); etat.courante = null; rendre(); conteneur.scrollTop = 0; };
  const cocher = (id) => {
    const r = intervention.cocherDepuisChecklist(id);
    etat.courante = null;
    if (r.ouvrirAlerte) auAlerte(); else rendre();
  };
  const noter = (id) => { etat.notation = { id, valeur: heureCourante(), erreur: null }; rendre(); };
  const valider = () => {
    const n = etat.notation;
    const r = intervention.noterGeste(n.id, n.valeur);
    if (r.ok) { etat.notation = null; etat.courante = null; rendre(); } else { n.erreur = r.raison; rendre(); }
  };

  // ───── en-tête : bascule en un toucher (fonction 11) ─────
  const entete = creer('div', 'checklist-entete');
  // mode guidé : pas de titre (la progression « Étape k sur n » prend sa place) pour garder « Fait » et « Passer » à l'écran sur un petit téléphone
  if (mode === 'expert') entete.append(creer('h1', null, 'Checklist'));
  entete.append(mode === 'expert'
    ? bouton('Mode guidé', 'bouton', () => basculer('guide'), { id: 'bascule-mode' })
    : bouton("Vue d'ensemble", 'bouton', () => basculer('expert'), { id: 'vue-ensemble' }));
  page.append(entete);

  // ───── pièces communes ─────
  const marques = (item) => {
    const e = item.etape;
    const m = creer('div', 'etape-marques');
    if (item.cochee) m.append(creer('span', 'etape-fait', `fait à ${tPlus(item.coche_le)}`));
    if (item.notee) m.append(creer('span', 'etape-notee', `noté fait à ${heureLocale(item.notee.t)} (${tPlus(item.notee.t)})`));
    if (item.nonFaite) m.append(creer('span', 'marque-non-faite', '⚠ non faite'));
    if (e.statut === 'A_VALIDER') m.append(creer('span', 'marque marque-a-valider', '⚠ A_VALIDER'));
    if (typeof e.provisoire === 'string') m.append(creer('span', 'marque marque-provisoire', MARQUE_PROVISOIRE));   // « provisoire » seulement si le protocole le porte (R15)
    if (item.habilitation !== 'oui') {
      const reglee = intervention.profession !== null;
      const texte = item.habilitation === 'non' ? 'non proposé comme action pour votre profession' : 'habilitation non établie pour votre profession';
      m.append(creer('span', 'marque marque-habilitation', `⚠ ${texte}${reglee ? '' : ' (profession non réglée)'}`));
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

  /** Détail déplié : texte, référence, sources, statut (CITÉ / DÉDUIT / A_VALIDER) et, si besoin, ce qui manque ou le raisonnement. */
  const detail = (item) => {
    const e = item.etape;
    const d = creer('div', 'etape-detail');
    if (typeof e.detail === 'string' && e.detail !== '') d.append(creer('p', null, e.detail));
    if (typeof e.ref_fiche === 'string' && e.ref_fiche !== '') d.append(creer('p', null, `Référence : ${e.ref_fiche}`));
    if (Array.isArray(e.sources) && e.sources.length > 0) {
      const ul = creer('ul', 'definition-sources');
      for (const s of e.sources) ul.append(creer('li', null, texteSource(s)));
      d.append(creer('p', 'definition-etiquette', 'Sources :'), ul);
    }
    d.append(creer('p', null, `Statut : ${STATUTS[e.statut] ?? String(e.statut ?? 'non indiqué')}`));
    if (e.statut === 'DEDUIT' && typeof e.raisonnement === 'string') d.append(creer('p', null, `Raisonnement : ${e.raisonnement}`));
    if (typeof e.a_valider === 'string' && e.a_valider !== '') d.append(creer('p', null, `À valider : ${e.a_valider}`));
    const ac = acronymes(item);
    if (ac) d.append(ac);
    return d;
  };

  // ───── mode expert ─────
  const ligneExpert = (item) => {
    const epingle = new Set(vue.critiques.map((c) => c.id));
    const ouverte = etat.deplies.has(item.id);
    const etatLigne = item.nonFaite ? 'non_faite' : item.cochee ? 'faite' : item.notee ? 'notee' : item.cochable ? 'a_faire' : 'info';
    const li = creer('li', 'etape', '', { 'data-etape': item.id, 'data-etat': etatLigne });
    const rang = creer('div', 'etape-ligne');
    if (item.cochable || item.cochee) {
      // une étape déjà cochée garde sa case (pour pouvoir la décocher) même si la profession a changé ; sinon elle ne se coche que si elle est cochable
      const c = bouton(item.cochee ? '✓' : '○', 'bouton case', () => cocher(item.id), {
        'data-case': item.id, 'aria-pressed': String(item.cochee), 'aria-label': `${item.etape.texte_court} : ${item.cochee ? 'cochée' : 'non cochée'}`,
      });
      if (!item.cochable) { c.disabled = true; }
      rang.append(c);
    } else rang.append(creer('span', 'etape-info', item.notee ? '✎' : 'ℹ', { 'aria-hidden': 'true' }));
    const titre = bouton('', 'bouton etape-titre', () => {
      if (etat.deplies.has(item.id)) etat.deplies.delete(item.id); else etat.deplies.add(item.id);
      rendre();
    }, { 'data-deplier': item.id, 'aria-expanded': String(ouverte) });
    titre.append(creer('span', 'etape-texte', item.etape.texte_court), creer('span', 'etape-fleche', ouverte ? ' ▾' : ' ▸', { 'aria-hidden': 'true' }));
    rang.append(titre);
    li.append(rang, marques(item));
    if (item.restreint && !item.cochee) {
      if (etat.notation?.id === item.id) li.append(formulaireNotation(item));
      else li.append(bouton('Noter : fait à hh:mm', 'bouton noter', () => noter(item.id), { 'data-noter': item.id }));
    }
    if (ouverte) {
      li.append(detail(item));
      const enfants = item.enfants.filter((c) => !epingle.has(c.id));
      if (enfants.length > 0) {
        const ul = creer('ul', 'etape-enfants');
        for (const c of enfants) ul.append(ligneExpert(c));
        li.append(ul);
      }
    }
    return li;
  };

  const afficherExpert = () => {
    const epingle = new Set(vue.critiques.map((c) => c.id));
    if (vue.critiques.length > 0) {
      const bloc = creer('section', 'checklist-critiques', '', { 'aria-label': 'Étapes critiques' });
      bloc.append(creer('h2', null, 'Étapes critiques'));
      const ul = creer('ul', 'checklist-liste');
      for (const c of vue.critiques) ul.append(ligneExpert(c));
      bloc.append(ul);
      page.append(bloc);
    }
    const ul = creer('ul', 'checklist-liste');
    for (const r of vue.racines.filter((x) => !epingle.has(x.id))) ul.append(ligneExpert(r));
    page.append(ul);
  };

  // ───── mode guidé ─────
  const afficherGuide = () => {
    const courante = etapeGuidee(vue, intervention.passees, etat.courante);
    if (vue.nonFaites.length > 0) {
      const b = creer('div', 'guide-nonfaites', '', { id: 'guide-nonfaites', role: 'status' });
      b.append(creer('span', null, `⚠ Étape critique non faite : `));
      for (const i of vue.nonFaites) b.append(bouton(i.etape.texte_court, 'bouton', () => { intervention.passees.delete(i.id); etat.courante = i.id; rendre(); }, { 'data-aller': i.id }));
      page.append(b);
    }
    if (!courante) {
      page.append(creer('p', 'guide-termine', 'Toutes les étapes sont faites, notées ou passées. « Vue d\'ensemble » montre la liste complète.', { id: 'guide-termine' }));
      return;
    }
    const item = courante;
    const carte = creer('div', 'guide-carte', '', { 'data-etape': item.id });
    const rang = vue.sequenceGuidee.indexOf(item) + 1;
    entete.prepend(creer('span', 'guide-progression', `Étape ${rang} sur ${vue.sequenceGuidee.length}`));
    carte.append(creer('p', 'guide-consigne', typeof item.etape.consigne_guidee === 'string' && item.etape.consigne_guidee !== '' ? item.etape.consigne_guidee : item.etape.texte_court, { id: 'guide-consigne' }));
    // une étape non cochable pour ce profil : la mention qui l'explique passe AVANT les actions ; sinon les actions (Fait, Passer) passent en premier, toujours visibles
    if (!item.cochable) carte.append(marques(item));
    const actions = creer('div', 'guide-actions');
    if (item.cochable) {
      actions.append(bouton('Fait', 'bouton bouton-accent bouton-grand', () => cocher(item.id), { id: 'guide-fait' }));
      actions.append(bouton('Passer', 'bouton bouton-grand', () => { intervention.passerEtape(item.id); etat.courante = null; }, { id: 'guide-passer' }));
    } else {
      // action que ce profil ne peut pas cocher : information, « Noter », « Suivant » — jamais « Fait »
      if (etat.notation?.id === item.id) actions.append(formulaireNotation(item));
      else actions.append(bouton('Noter : fait à hh:mm', 'bouton bouton-grand', () => noter(item.id), { id: 'guide-noter' }));
      actions.append(bouton('Suivant', 'bouton bouton-grand', () => { intervention.passerEtape(item.id); etat.courante = null; }, { id: 'guide-suivant' }));
    }
    carte.append(actions);
    if (item.cochable) carte.append(marques(item));
    const ac = acronymes(item);
    if (ac) carte.append(ac);
    const ouverte = etat.deplies.has(item.id);
    carte.append(bouton(ouverte ? 'Masquer le détail' : 'Détail', 'bouton', () => { if (ouverte) etat.deplies.delete(item.id); else etat.deplies.add(item.id); rendre(); }, { id: 'guide-detail', 'aria-expanded': String(ouverte) }));
    if (ouverte) carte.append(detail(item));
    page.append(carte);
  };

  if (mode === 'guide') afficherGuide(); else afficherExpert();
  conteneur.replaceChildren(page);
}
