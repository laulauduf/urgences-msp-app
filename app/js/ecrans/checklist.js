// Écran « Checklist » (cahier des charges 4.5) : mode expert (liste compacte, critiques épinglées, case = cochée et horodatée) et mode guidé
// (une consigne à la fois, « Vue d'ensemble » permanent). Même objet que les tuiles : `fiche.checklist[id]`.
// RÈGLES : aucun libellé, ordre ni habilitation médicale ici (tout vient du protocole et de professions.json) ; textes via textContent seulement ;
// l'information ne passe jamais par la couleur seule (icône + texte) ; l'état d'affichage (étapes dépliées, saisie de l'heure) vit dans `etat`,
// fourni par l'interface, pour survivre au redessin de l'écran — et la saisie de l'heure n'est jamais perdue.
import { creer, bouton, heureLocale } from '../dom.js';
import { formaterDuree, MARQUE_PROVISOIRE } from '../horloge.js';
import { etapeGuidee, texteSource } from '../checklist.js';
import { detailHabilitation } from '../habilitations.js';
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
  const illisibles = avertissementHabilitations();
  if (illisibles) page.append(illisibles);

  // habilitations illisibles : on le DIT (sinon « habilitation non établie » semble une décision), avec la conséquence (revue L6 m2)
  function avertissementHabilitations() { return (intervention.habilitationsEtat === 'absent'
    ? creer('p', 'avertissement-checklist', 'Habilitations par profession illisibles : seules les étapes vitales et les étapes ouvertes à tous sont cochables. Vérifiez l\'installation de l\'appli.', { id: 'habilitations-illisibles', role: 'status' })
    : null); }

  // ───── pièces communes ─────
  const marques = (item) => {
    const e = item.etape;
    const m = creer('div', 'etape-marques');
    if (item.cochee) m.append(creer('span', 'etape-fait', `fait à ${tPlus(item.coche_le)}`));
    if (item.notee) {
      // un geste noté avant le début de l'intervention (cas courant : on agit avant de sortir le téléphone) le dit, au lieu d'afficher « T+00:00 » (revue L6 m6)
      const avantDebut = item.notee.t < debut;
      const rel = avantDebut ? `avant le début, T−${formaterDuree(debut - item.notee.t)}` : tPlus(item.notee.t);
      m.append(creer('span', 'etape-notee', `noté fait à ${heureLocale(item.notee.t)} (${rel})`));
    }
    if (item.nonFaite) m.append(creer('span', 'marque-non-faite', '⚠ non faite'));
    if (e.statut === 'A_VALIDER') m.append(creer('span', 'marque marque-a-valider', '⚠ A_VALIDER'));
    if (typeof e.provisoire === 'string') m.append(creer('span', 'marque marque-provisoire', MARQUE_PROVISOIRE));   // « provisoire » seulement si le protocole le porte (R15)
    // pas de mention sur une étape VITALE : elle reste cochable pour tous (règle absolue 5), la mention contredirait la case active (revue L6 m1)
    if (item.habilitation !== 'oui' && !item.exempte) {
      const texte = item.habilitation === 'non' ? 'non proposé comme action pour votre profession' : 'habilitation non établie pour votre profession';
      const cause = intervention.profession === null ? ' (profession non réglée)' : intervention.professionReconnue ? '' : ' (profession non reconnue : groupe le plus restreint appliqué)';
      m.append(creer('span', 'marque marque-habilitation', `⚠ ${texte}${cause}`));
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
      if (!item.cochable && !item.cochee) c.disabled = true;   // une case cochée reste décochable même si la profession a changé (revue L6 m5)
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
      for (const i of vue.nonFaites) b.append(bouton(i.etape.texte_court, 'bouton', () => { intervention.passees.delete(i.id); etat.courante = i.id; rendre(); conteneur.scrollTop = 0; }, { 'data-aller': i.id }));
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
    // les marques (A_VALIDER, « provisoire », habilitation) sont TOUJOURS sous la consigne, avant les boutons : le mode guidé est celui qu'on lit sans dérouler (revue L6 M2)
    carte.append(marques(item));
    const actions = creer('div', 'guide-actions');
    if (item.cochable) {
      actions.append(bouton('Fait', 'bouton bouton-accent bouton-grand', () => { cocher(item.id); conteneur.scrollTop = 0; }, { id: 'guide-fait' }));
      actions.append(bouton('Passer', 'bouton bouton-grand', () => { intervention.passerEtape(item.id); etat.courante = null; conteneur.scrollTop = 0; }, { id: 'guide-passer' }));
    } else {
      // action que ce profil ne peut pas cocher : information, « Noter », « Suivant » — jamais « Fait »
      if (etat.notation?.id === item.id) actions.append(formulaireNotation(item));
      else actions.append(bouton('Noter : fait à hh:mm', 'bouton bouton-grand', () => noter(item.id), { id: 'guide-noter' }));
      actions.append(bouton('Suivant', 'bouton bouton-grand', () => { intervention.passerEtape(item.id); etat.courante = null; conteneur.scrollTop = 0; }, { id: 'guide-suivant' }));
    }
    carte.append(actions);
    const ac = acronymes(item);
    if (ac) carte.append(ac);
    const ouverte = etat.deplies.has(item.id);
    carte.append(bouton(ouverte ? 'Masquer le détail' : 'Détail', 'bouton', () => { if (ouverte) etat.deplies.delete(item.id); else etat.deplies.add(item.id); rendre(); }, { id: 'guide-detail', 'aria-expanded': String(ouverte) }));
    if (ouverte) {
      carte.append(detail(item));
      const epingle = new Set(vue.critiques.map((c) => c.id));
      const sous = item.enfants.filter((c) => !epingle.has(c.id));
      if (sous.length > 0) {
        const ul = creer('ul', 'guide-sousetapes');
        for (const c of sous) { const li = creer('li', 'etape', '', { 'data-etape': c.id }); li.append(creer('span', 'etape-texte', c.etape.texte_court), marques(c)); ul.append(li); }
        carte.append(creer('p', 'definition-etiquette', 'Sous-étapes :'), ul);
      }
    }
    page.append(carte);
  };

  if (mode === 'guide') afficherGuide(); else afficherExpert();
  conteneur.replaceChildren(page);
}
