// Zone de saisie dépliée sous une étape de RECUEIL (lot G, G1 ; décisions D-66 et D-69 variante A, maquette `specs/maquette/maquette-saisie-transmission-2026-11-16.html`).
// Ce qui est touché ou tapé ici s'écrit DIRECTEMENT dans la fiche de la victime prise en charge — les MÊMES champs que le volet « Fiche » (jamais une seconde copie) — puis dans la
// transmission (qui relit la fiche). L'étape se coche quand quelque chose est saisi (`Intervention.etapeSaisie`) ; l'écran n'est PAS redessiné pendant la frappe : `auSaisie` ne met à jour que
// la ligne de l'étape (valeur sous le libellé, case, marque « fait à T+ »). Aucun texte médical ici : les puces d'un champ texte viennent du protocole (`saisie.puces`), celles des antécédents
// et des traitements de la fiche (victimes.js) ; aucune dictée vocale, aucune saisie automatique ni correction (comme le volet).
// RÈGLE : cette zone n'existe que pour une étape qui porte `saisie` dans les DONNÉES (le contrôle R20 garantit : jamais vitale, jamais avant l'alerte) ; textes via textContent seulement.
import { creer, bouton, heureLocale } from '../dom.js';
import { champDe, pucesDe, typesProposes, aJeton, basculerJeton, poserHeure, lireTexte, serieConstantes, cibleSaisie } from '../saisie-etape.js';
import { PUCES_ANTECEDENTS, PUCES_TRAITEMENTS, victimePriseEnCharge } from '../victimes.js';

const SANS_AUTO = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' };
/** E-2 : durée pendant laquelle un second « Maintenant » corrige l'heure que le premier a posée (double toucher) ; passé ce délai, les deux heures sont gardées. */
const FENETRE_CORRECTION_MS = 2 * 60 * 1000;

/**
 * @param {{intervention: object, item: object, auSaisie: () => void}} options  `auSaisie` : à appeler après chaque écriture dans la fiche
 * @returns {HTMLElement}
 */
export function construireZoneSaisie({ intervention, item, auSaisie }) {
  const e = item.etape; const s = e.saisie; const def = champDe(s);
  const zone = creer('div', 'etape-saisie', '', { 'data-saisie': item.id, role: 'group', 'aria-label': `Saisie : ${e.texte_court}` });
  if (!def) return zone;
  const fiche = () => intervention.fiche;
  // M2 — VICTIME-SAISIE ouverte (registre) : choix PROVISOIRE du pilote. La saisie dans l'étape va TOUJOURS à la victime PRISE EN CHARGE par la checklist (la première, D-64 : « la checklist, le
  // chronomètre et le métronome restent ceux de la victime prise en charge »), JAMAIS à l'onglet ouvert du volet ; dès 2 victimes, une ligne dit laquelle (« → Victime 1 · H adulte »).
  const PEC = { priseEnCharge: true };
  const synchros = [];   // remettent les contrôles (puces, champs, liste) d'accord avec la fiche
  const apres = () => { auSaisie(); for (const f of synchros) f(); };
  const cible = creer('p', 'saisie-cible', '', { 'data-saisie-cible': item.id }); cible.hidden = true; zone.append(cible);
  synchros.push(() => { const t = cibleSaisie(fiche()); cible.textContent = t; cible.hidden = t === ''; });
  // M1 : la fiche est la SEULE source de vérité. Quand le volet « Fiche » (ou un changement de victime) a modifié la fiche pendant que cette zone restait dépliée, l'interface envoie `recaler` :
  // tous les champs, puces et la ligne de l'étape se remettent d'accord avec la fiche, même un champ qui a encore le focus (il ne peut pas être en cours de frappe : le volet était ouvert).
  zone.addEventListener('recaler', () => { for (const f of synchros) f(true); auSaisie(); });

  /** Une rangée de puces : `actives(o)` dit si la puce est enfoncée, `auToucher(o)` écrit dans la fiche. Couleur jamais seule : « ✓ » ajouté par la feuille de style. */
  const rangeePuces = (libelle, options, actives, auToucher, nom) => {
    const bloc = creer('div', 'saisie-bloc');
    if (libelle) bloc.append(creer('p', 'saisie-etiquette', libelle));
    const g = creer('div', 'choix-rapides', '', { role: 'group', 'aria-label': libelle ?? `${e.texte_court} : choix rapides` });
    const boutons = options.map((o) => {
      const b = bouton('', 'bouton', () => { auToucher(o); apres(); }, { 'aria-pressed': 'false', 'data-puce': o.id, ...(nom ? { 'data-groupe': nom } : {}) });
      b.append(creer('span', null, o.libelle));
      g.append(b);
      return [o, b];
    });
    bloc.append(g); zone.append(bloc);
    synchros.push(() => { for (const [o, b] of boutons) b.setAttribute('aria-pressed', String(actives(o))); });
  };

  /** Champ texte de la fiche : enregistré à chaque frappe, sans redessin ; la valeur affichée par la fiche (autres écrans) remet le champ à jour sauf quand il a le focus. */
  const champTexte = (libelle, lire, ecrire, { long = false, clavier = 'text', nom = '' } = {}) => {
    const l = creer('label', 'champ-fiche saisie-champ');
    l.append(creer('span', 'saisie-etiquette', libelle));
    const el = creer(long ? 'textarea' : 'input', null, '', { ...(long ? { rows: 1 } : { type: 'text', inputmode: clavier }), ...SANS_AUTO, 'data-saisie-champ': nom || item.id, 'aria-label': libelle });
    el.value = lire();
    el.addEventListener('input', () => { ecrire(el.value); auSaisie(); for (const f of synchros) f(); });
    // M1 (a) : au focus, avant toute frappe, le champ reprend la valeur de la fiche (jamais une valeur périmée écrasant une correction faite ailleurs)
    el.addEventListener('focus', () => { if (el.value !== lire()) el.value = lire(); });
    l.append(el); zone.append(l);
    synchros.push((force) => { if ((force || document.activeElement !== el) && el.value !== lire()) el.value = lire(); });
    return el;
  };

  // ───── champ texte (heure de début, notes) : puces du protocole, « Maintenant » pour une heure, texte libre ─────
  if (def.genre === 'texte') {
    const lire = () => lireTexte(fiche(), s);
    const ecrire = (valeur) => { intervention.definirChamp(def.bloc, def.cle, valeur, PEC); intervention.etapeSaisie(item.id); };
    if (def.heure) {
      // M3 : « Maintenant » n'ajoute qu'en tête ; il ne remplace que l'heure qu'il a posée lui-même (gardée ici), jamais une heure écrite à la main
      // m-5 : `poserHeure` n'ajoute jamais une heure déjà en tête. H-2 : l'heure posée n'est PAS gardée hors de la zone (replier puis redéplier plus tard ne doit jamais effacer une heure enregistrée)
      // E-2 : le remplacement ne sert qu'à corriger un double toucher : au-delà de FENETRE_CORRECTION_MS, l'heure posée est gardée et la nouvelle s'ajoute en tête (zone restée dépliée longtemps)
      let posee = null; let poseeA = 0;
      const b = bouton('Maintenant', 'bouton saisie-maintenant', () => {
        const maintenant = Date.now(); const h = heureLocale(maintenant);
        ecrire(poserHeure(lire(), h, posee !== null && maintenant - poseeA < FENETRE_CORRECTION_MS ? posee : null)); posee = h; poseeA = maintenant; apres();
      }, { 'data-maintenant': item.id });
      const rang = creer('div', 'saisie-bloc'); rang.append(b); zone.append(rang);
    }
    const puces = pucesDe(s);
    if (puces.length > 0) rangeePuces(null, puces.map((p) => ({ id: p, libelle: p.charAt(0).toUpperCase() + p.slice(1) })), (o) => aJeton(lire(), o.id), (o) => ecrire(basculerJeton(lire(), o.id)));
    champTexte(def.heure ? 'Heure ou précision, en clair' : `${def.libelle}, en clair`, lire, ecrire, { long: !def.heure });
  }

  // ───── antécédents, traitements : les puces et le texte libre du volet « Fiche » (mêmes champs) ─────
  if (def.genre === 'antecedents') {
    const v = () => victimePriseEnCharge(fiche());
    const ecrireListe = (cle, id) => {
      const avant = v()[cle] ?? [];
      intervention.definirChamp(null, cle, avant.includes(id) ? avant.filter((x) => x !== id) : [...avant, id], PEC);
      intervention.etapeSaisie(item.id);
    };
    rangeePuces('Antécédents', PUCES_ANTECEDENTS, (o) => (v().antecedents_puces ?? []).includes(o.id), (o) => ecrireListe('antecedents_puces', o.id), 'antecedents');
    champTexte('Autre antécédent', () => v().antecedents ?? '', (x) => { intervention.definirChamp(null, 'antecedents', x, PEC); intervention.etapeSaisie(item.id); }, { nom: `${item.id}:antecedents` });
    rangeePuces('Traitements', PUCES_TRAITEMENTS, (o) => (v().traitements_puces ?? []).includes(o.id), (o) => ecrireListe('traitements_puces', o.id), 'traitements');
    champTexte('Autre traitement', () => v().traitements ?? '', (x) => { intervention.definirChamp(null, 'traitements', x, PEC); intervention.etapeSaisie(item.id); }, { nom: `${item.id}:traitements` });
  }

  // ───── constantes : valeurs brutes horodatées « maintenant », série qui reste ouverte, aucune interprétation (D-19) ─────
  if (def.genre === 'constantes') {
    let choisi = null;
    const types = typesProposes(s);
    rangeePuces('Type', types.map((t) => ({ id: t.id, libelle: t.libelle })), (o) => choisi === o.id, (o) => { choisi = choisi === o.id ? null : o.id; majFormulaire(); if (choisi) champ.focus({ preventScroll: true }); }, 'type-constante');
    const formulaire = creer('div', 'saisie-formulaire'); formulaire.hidden = true;
    const lib = creer('label', 'saisie-etiquette', '', { for: `saisie-valeur-${item.id}` });
    const champ = creer('input', null, '', { id: `saisie-valeur-${item.id}`, type: 'text', 'data-saisie-champ': item.id, ...SANS_AUTO });
    const erreur = creer('p', 'noter-erreur', '', { role: 'alert' }); erreur.hidden = true;
    const ajouter = () => {
      if (choisi === null) return;
      const r = intervention.ajouterConstante(choisi, champ.value, heureLocale(Date.now()), PEC);
      if (!r.ok) { erreur.textContent = r.raison; erreur.hidden = false; champ.focus({ preventScroll: true }); return; }
      erreur.hidden = true; champ.value = '';
      intervention.etapeSaisie(item.id); apres();
      champ.focus({ preventScroll: true });   // la série reste ouverte : la valeur suivante se tape sans rien retoucher
    };
    champ.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ajouter(); } });
    const rang = creer('div', 'saisie-valeur-rang'); rang.append(champ, bouton('Ajouter', 'bouton bouton-accent', ajouter, { 'data-ajouter-constante': item.id }));
    formulaire.append(lib, rang, erreur); zone.append(formulaire);
    const liste = creer('ul', 'saisie-serie', '', { 'aria-label': 'Valeurs saisies' });
    zone.append(liste);
    function majFormulaire() {
      formulaire.hidden = choisi === null;
      const t = types.find((x) => x.id === choisi);
      if (t) { lib.textContent = `Valeur : ${t.libelle}`; champ.setAttribute('inputmode', t.clavier === 'text' ? 'text' : 'decimal'); champ.setAttribute('aria-label', `Valeur : ${t.libelle}`); }
      for (const b of zone.querySelectorAll('[data-groupe="type-constante"]')) b.setAttribute('aria-pressed', String(b.dataset.puce === choisi));
    }
    synchros.push(() => {
      majFormulaire();
      liste.replaceChildren();
      for (const c of serieConstantes(fiche(), s)) liste.append(creer('li', null, `${heureLocale(c.t)} ${c.libelle} : ${c.texte}`));
      liste.hidden = liste.childElementCount === 0;
    });
  }

  for (const f of synchros) f();
  return zone;
}
