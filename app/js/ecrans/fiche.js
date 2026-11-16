// Volet « Fiche bilan » (D-64, maquette specs/maquette/maquette-fiche-volet-2026-11-15.html) : il monte du bas sur ~55 % de la hauteur, la conduite à tenir et la barre
// Masser / Appeler / DAE / Fiche restent visibles et actives. Un ONGLET PAR VICTIME (« + » ajoute une fiche, sans limite) ; champs en un toucher quand c'est possible ;
// AUCUN champ obligatoire ; enregistrement à chaque frappe (2.8) ; rien ne sort de l'appareil ; aucune dictée vocale.
// RÈGLES : constantes en valeurs BRUTES horodatées, sans aucun jugement (D-19 : ni couleur, ni icône, ni seuil) ; pas de saisie automatique, de correction ni de majuscule automatique.
// LE VOLET N'EST JAMAIS RECONSTRUIT sur l'événement « changement » (on perdrait la frappe) : il vit HORS de #contenu, créé une fois par l'interface ; seuls les champs de la victime
// ouverte sont redessinés quand on change d'onglet, et le tableau des constantes / la liste des gestes quand on en ajoute (aucune saisie de texte n'y vit).
import { creer, bouton, heureLocale } from '../dom.js';
import { TYPES_CONSTANTE, tableauConstantes, texteAge, hhmm, correctionDeEntree, idJournalGeste } from '../bilan.js';
import { avecUnite } from '../unites.js';
import { PUCES_ANTECEDENTS, PUCES_TRAITEMENTS, TRANCHES_AGE, NIVEAUX_AVPU, victimeActive, contenuVictime, libelleVictime, numeroVictime } from '../victimes.js';

const SANS_AUTO = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' };
const maintenantHHMM = () => heureLocale(Date.now());

/**
 * Construit le volet (une seule fois par intervention). Rien n'est affiché tant que l'interface ne l'ouvre pas.
 * @param {{intervention: object, auFermer: () => void, auChangement: () => void}} options  `auChangement` : le résumé de l'en-tête doit être relu
 * @returns {{element: HTMLElement, prise: HTMLElement, titre: HTMLElement, redessiner: () => void}}
 */
export function construireVolet({ intervention, auFermer, auChangement }) {
  const fiche = () => intervention.fiche;
  /** État qui survit aux changements d'onglet : formulaire d'ajout (brouillon), demande de retrait en cours. */
  const etat = { ajout: null, retrait: false };

  const volet = creer('section', 'volet volet-fiche', '', { id: 'volet-fiche', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'volet-titre', hidden: '' });
  // poignée + titre + « Fermer » : zone de glissement (pas les onglets, qui défilent à l'horizontale)
  const prise = creer('div', 'volet-prise', '', { id: 'volet-prise' });
  const titre = creer('h2', 'volet-titre', 'Fiche bilan', { id: 'volet-titre', tabindex: '-1' });
  titre.append(creer('small', null, " Rien n'est obligatoire"));
  prise.append(creer('span', 'volet-poignee', '', { 'aria-hidden': 'true' }), creer('div', 'volet-tete'));
  prise.querySelector('.volet-tete').append(titre, bouton('Fermer', 'bouton bouton-accent volet-fermer', () => auFermer(), { id: 'volet-fermer' }));
  const onglets = creer('div', 'volet-onglets', '', { id: 'victimes-onglets', role: 'tablist', 'aria-label': 'Victimes' });
  const liste = creer('div', 'volet-onglets-liste');   // A9 : la rangée DÉFILANTE des onglets ; le « + » est HORS de cette rangée (il la recouvrait : l'onglet ouvert passait dessous à partir de 3 ou 4 victimes)
  const champs = creer('div', 'volet-champs ecran-fiche', '', { id: 'volet-champs' });
  volet.append(prise, onglets, champs);

  // ───── onglets ─────
  function dessinerOnglets() {
    const f = fiche();
    onglets.replaceChildren(liste); liste.replaceChildren();
    for (const v of f.victimes) {
      const actif = v.id === f.victime_active;
      // « Victime 2 » : le mot est masqué par la feuille de style quand la place manque (paysage bas, texte agrandi : « 1 », « 2 »), le nom accessible reste complet
      const onglet = bouton('', `bouton onglet${actif ? ' onglet-actif' : ''}`, () => choisir(v.id), { id: `onglet-${v.id}`, role: 'tab', 'aria-selected': String(actif), 'data-victime': v.id, 'aria-label': libelleVictime(f, v.id) });
      onglet.append(creer('span', 'onglet-mot', 'Victime '), creer('span', null, String(numeroVictime(f, v.id))));
      // la checklist, le cycle et le métronome suivent la PREMIÈRE victime (la victime prise en charge) : repère visible dès qu'il y en a plusieurs (D-64b, design)
      if (f.victimes.length > 1 && v.id === f.victimes[0].id) { onglet.append(creer('span', 'onglet-suivi', '', { 'aria-hidden': 'true' })); onglet.setAttribute('aria-label', `${libelleVictime(f, v.id)}, suivie par la checklist`); }
      liste.append(onglet);
    }
    onglets.append(bouton(f.victimes.length > 1 ? '+' : '+ Victime', `bouton onglet onglet-plus${f.victimes.length > 1 ? '' : ' onglet-plus-mot'}`, () => { etat.retrait = false; etat.ajout = null; intervention.ajouterVictime(); redessiner(); auChangement(); }, { id: 'victime-ajouter', 'aria-label': 'Ajouter une victime' }));
    // l'onglet ouvert reste visible dans la rangée (qui défile quand il y a beaucoup de victimes) ; le « + » est collé à droite par la feuille de style
    requestAnimationFrame(() => liste.querySelector(".onglet-actif")?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
  }
  function choisir(id) {
    if (id === fiche().victime_active) return;
    etat.retrait = false; etat.ajout = null;   // une demande de retrait ou un formulaire ouvert ne suit jamais dans l'autre onglet
    intervention.choisirVictime(id);
    redessiner(); auChangement();
    onglets.querySelector(`[data-victime="${id}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // ───── petits composants ─────
  /** Un champ texte : enregistré à chaque frappe (sans redessiner), écriture immédiate à la sortie du champ. */
  const champTexte = (parent, { libelle, bloc = null, cle, valeur, long = false, clavier = 'text', placeholder = '', libelleCache = false, suite = false }) => {
    const l = creer('label', `champ-fiche${suite ? ' champ-suite' : ''}`);
    l.append(creer('span', libelleCache ? 'champ-libelle cache-visuel' : 'champ-libelle', libelle));
    const e = creer(long ? 'textarea' : 'input', null, '', { ...(long ? { rows: 1 } : { type: 'text', inputmode: clavier }), ...SANS_AUTO, placeholder, 'data-champ': `${bloc ?? 'fiche'}.${cle}` });
    e.value = valeur ?? '';
    e.addEventListener('input', () => { intervention.definirChamp(bloc, cle, e.value); auChangement(); });
    e.addEventListener('change', () => intervention.ecrire());
    l.append(e);
    parent.append(l);
    return e;
  };
  /** Groupe de puces : une seule (sexe, tranche, AVPU) ou plusieurs (antécédents, traitements) ; un second toucher décoche. Couleur jamais seule : « ✓ » ajouté par la feuille de style. */
  const groupe = (parent, { id, libelle, nomAccessible, options, choisies, multiple, auToucher }) => {
    const bloc = creer('div', 'champ');
    bloc.append(creer('p', 'champ-etiquette', libelle, { id: `etiq-${id}` }));
    const g = creer('div', 'choix-rapides', '', { role: 'group', 'aria-label': nomAccessible ?? libelle, id: `groupe-${id}` });
    for (const o of options) {
      const b = bouton('', 'bouton', () => auToucher(o.id, b), { id: `chip-${id}-${o.id}`, 'aria-pressed': String(choisies.includes(o.id)), 'data-valeur': o.id });
      b.append(creer('span', null, o.libelle));
      if (o.sens) { b.classList.add('avec-sens'); b.append(creer('span', 'puce-sens', o.sens)); }
      g.append(b);
    }
    bloc.append(g); parent.append(bloc);
    return { bloc, g };
  };
  const pressees = (g) => [...g.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.valeur);
  const marquer = (g, ids) => { for (const b of g.querySelectorAll('button')) b.setAttribute('aria-pressed', String(ids.includes(b.dataset.valeur))); };

  // ───── constantes et gestes de la victime ouverte : valeurs brutes, ordre chronologique, aucune interprétation ─────
  const rangee = creer('div', 'rangee-ajout', '', { id: 'rangee-ajout' });
  const boutonGeste = bouton('+ Geste', 'bouton bouton-geste', () => ouvrirAjout('geste', null), { 'data-ajout': 'geste' });
  const formulaire = creer('div', 'ajout-formulaire', '', { id: 'ajout-formulaire' });
  formulaire.hidden = true;
  const emplacementC = creer('div', 'emplacement-ajout'); const emplacementG = creer('div', 'emplacement-ajout');
  const listeC = creer('div', 'liste-constantes'); const listeG = creer('div', 'liste-gestes');
  const blocConstantes = creer('section', 'bloc-constantes', '', { 'aria-label': 'Constantes' });
  const blocGestes = creer('section', 'bloc-gestes', '', { 'aria-label': 'Gestes et produits' });
  blocConstantes.append(creer('h3', null, 'Constantes'), rangee, emplacementC, listeC);
  blocGestes.append(creer('h3', null, 'Gestes et produits'), boutonGeste, emplacementG, listeG);
  const ouvrirAjout = (genre, type) => { etat.ajout = { genre, type, valeur: '', heure: null }; montrerAjout(); };
  // libellés EN TOUTES LETTRES (D-10) ; le nom accessible est le texte visible (WCAG 2.5.3, commande vocale)
  for (const t of TYPES_CONSTANTE) rangee.append(bouton(t.libelle, 'bouton', () => ouvrirAjout('constante', t.id), { 'data-ajout': t.id }));

  function montrerAjout() {
    formulaire.replaceChildren();
    rangee.hidden = etat.ajout?.genre === 'constante'; boutonGeste.hidden = etat.ajout?.genre === 'geste';   // le formulaire prend la place du bouton touché
    if (!etat.ajout) { formulaire.hidden = true; return; }
    (etat.ajout.genre === 'geste' ? emplacementG : emplacementC).append(formulaire);
    formulaire.hidden = false;
    const { genre, type } = etat.ajout;
    const def = TYPES_CONSTANTE.find((t) => t.id === type);
    formulaire.append(creer('p', 'ajout-titre', genre === 'geste' ? 'Geste ou produit (texte libre)' : def.libelle));
    const valeur = creer('input', null, '', { id: 'ajout-valeur', type: 'text', placeholder: genre === 'geste' ? 'Geste ou produit' : def.libelle, inputmode: genre === 'geste' ? 'text' : def.clavier, 'aria-label': genre === 'geste' ? 'Geste ou produit' : `Valeur : ${def.libelle}`, ...SANS_AUTO });
    valeur.value = etat.ajout.valeur ?? '';   // brouillon gardé : il survit à un changement d'onglet ou de fermeture du volet
    valeur.addEventListener('input', () => { if (etat.ajout) etat.ajout.valeur = valeur.value; });
    const heure = creer('input', null, '', { id: 'ajout-heure', type: 'time', value: etat.ajout.heure ?? maintenantHHMM(), 'aria-label': 'Heure' });
    heure.addEventListener('input', () => { if (etat.ajout) etat.ajout.heure = heure.value; });
    const erreur = creer('p', 'noter-erreur', '', { id: 'ajout-erreur', role: 'alert' });
    erreur.hidden = true;
    const valider = () => {
      const r = genre === 'geste' ? intervention.ajouterGeste(valeur.value, heure.value) : intervention.ajouterConstante(type, valeur.value, heure.value);
      if (!r.ok) { erreur.textContent = r.raison; erreur.hidden = false; return; }
      etat.ajout = null; montrerAjout(); majTableaux(); auChangement();
    };
    valeur.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
    const unite = genre === 'geste' ? '' : intervention.uniteDe(type);   // D-26 : texte simple, aucun état (D-19)
    formulaire.append(valeur);
    if (unite !== '') formulaire.append(creer('span', 'ajout-unite', unite, { id: 'ajout-unite' }));
    formulaire.append(creer('label', null, 'Heure : ', { for: 'ajout-heure' }), heure, erreur,
      bouton('Ajouter', 'bouton bouton-accent', valider, { id: 'ajout-valider' }), bouton('Annuler', 'bouton', () => { etat.ajout = null; montrerAjout(); }, { id: 'ajout-annuler' }));
    formulaire.scrollIntoView?.({ block: 'nearest' });   // le formulaire s'ouvre là où l'on regarde : la place du volet est comptée
    valeur.focus({ preventScroll: true });
  }

  /** Une valeur corrigée au journal : l'original BARRÉ, puis « corrigé à hh:mm : … » ; jamais la valeur d'origine seule. */
  function ajouterValeur(parent, valeur, corrige) {
    if (!corrige) { parent.append(document.createTextNode(valeur)); return; }
    parent.append(creer('s', null, valeur), document.createTextNode(` corrigé à ${corrige.heure} : ${corrige.texte}`));
  }
  function majTableaux() {
    const f = fiche(); const v = victimeActive(f);
    listeC.replaceChildren();
    const propres = { ...f, constantes: (f.constantes ?? []).filter((c) => c.victime === v.id) };
    const tableau = tableauConstantes(propres.constantes, f);
    if (tableau.length === 0) listeC.append(creer('p', 'plan-aide', 'Aucune constante notée. Touchez un bouton ci-dessus.'));
    for (const l of tableau) {
      const p = creer('p', 'constante-ligne', '', { 'data-constante': l.type });
      p.append(creer('strong', null, `${l.libelle} : `));
      l.valeurs.forEach((x, i) => {
        if (i > 0) p.append(document.createTextNode('  ·  '));
        p.append(document.createTextNode(`${hhmm(x.t)} `));
        ajouterValeur(p, avecUnite(x.valeur, x.unite), x.corrige);
      });
      listeC.append(p);
    }
    listeG.replaceChildren();
    const gestes = (f.gestes_produits ?? []).filter((g) => g.victime === v.id).sort((a, b) => a.t - b.t);
    if (gestes.length === 0) listeG.append(creer('p', 'plan-aide', 'Aucun geste noté. Touchez « + Geste » ci-dessus.'));
    for (const g of gestes) {
      const p = creer('p', 'geste-ligne', `${hhmm(g.t)} — `);
      ajouterValeur(p, g.texte, correctionDeEntree(f, idJournalGeste(f, g)));
      listeG.append(p);
    }
  }

  // ───── les champs de la victime ouverte ─────
  function dessinerChamps() {
    const f = fiche(); const v = victimeActive(f);
    const idt = v.identite ?? {}; const c = v.circonstances ?? {}; const bv = v.bilan_vital ?? {};
    const ouvertPlus = champs.querySelector('#plus-de-champs')?.open === true;   // « Plus de champs » reste ouvert d'une victime à l'autre
    champs.replaceChildren();
    // ORDRE DU VOLET (CHOIX PROVISOIRE A, D-15, D-64b ; réversible) : les saisies d'urgence d'abord (sexe, âge, conscience, constantes, gestes), l'identité et les antécédents ensuite
    if (f.victimes.length > 1) champs.append(creer('p', 'plan-aide volet-suivi', '● = la victime suivie par la checklist, le cycle et le métronome (la première).', { id: 'volet-suivi' }));
    const zones = {};
    for (const k of ['sexe', 'age', 'avpu', 'mesures', 'nom', 'atcd', 'trait', 'allergies', 'notes']) { zones[k] = creer('div', `zone-${k}`); champs.append(zones[k]); }

    // sexe (un toucher)
    groupe(zones.sexe, { id: 'sexe', libelle: 'Sexe', options: [{ id: 'homme', libelle: 'H' }, { id: 'femme', libelle: 'F' }], choisies: [idt.sexe].filter(Boolean), multiple: false,
      auToucher: (valeur, b) => { const nouveau = b.getAttribute('aria-pressed') === 'true' ? '' : valeur; intervention.definirChamp('identite', 'sexe', nouveau); marquer(champs.querySelector('#groupe-sexe'), [nouveau]); auChangement(); } });

    // âge : tranche OU âge exact (l'un remplace l'autre)
    const age = groupe(zones.age, { id: 'age', libelle: 'Âge', options: TRANCHES_AGE, choisies: [idt.tranche_age].filter(Boolean), multiple: false, auToucher: () => {} });
    const exact = creer('div', 'age-exact');
    const saisieExact = creer('input', 'age-exact-champ', '', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, 'aria-label': 'Âge exact, en années', placeholder: '—', ...SANS_AUTO, 'data-champ': 'identite.age_exact' });
    saisieExact.value = idt.age_exact ?? '';
    exact.append(creer('span', null, 'ou âge exact'), saisieExact, creer('span', null, 'ans'));
    age.bloc.append(exact);
    for (const b of age.g.querySelectorAll('button')) b.addEventListener('click', () => {
      const nouveau = b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.valeur;   // (l'état visuel est posé juste après)
      intervention.definirChamp('identite', 'tranche_age', nouveau);
      if (nouveau) { intervention.definirChamp('identite', 'age_exact', ''); saisieExact.value = ''; }
      marquer(age.g, [nouveau]); auChangement();
    });
    saisieExact.addEventListener('input', () => {
      saisieExact.value = saisieExact.value.replace(/[^0-9]/g, '');
      intervention.definirChamp('identite', 'age_exact', saisieExact.value);
      if (saisieExact.value) { intervention.definirChamp('identite', 'tranche_age', ''); marquer(age.g, []); }
      auChangement();
    });
    saisieExact.addEventListener('change', () => intervention.ecrire());

    // nom
    const blocNom = creer('div', 'champ'); champTexte(blocNom, { libelle: 'Nom', bloc: 'identite', cle: 'nom', valeur: idt.nom, placeholder: 'Nom, prénom si connu' }); zones.nom.append(blocNom);

    // antécédents, traitements : puces + texte libre
    const puces = (id, libelle, options, cle, libreCle, libreLibelle) => {
      const g = groupe(zones[id], { id, libelle, options, choisies: v[cle] ?? [], multiple: true, auToucher: () => {} });
      for (const b of g.g.querySelectorAll('button')) b.addEventListener('click', () => {
        // (l'état visuel de CE toucher n'est pas encore posé : on lit les puces, puis on inverse celle touchée)
        const avant = pressees(g.g); const nouveau = avant.includes(b.dataset.valeur) ? avant.filter((x) => x !== b.dataset.valeur) : [...avant, b.dataset.valeur];
        intervention.definirChamp(null, cle, nouveau); marquer(g.g, nouveau); intervention.ecrire(); auChangement();
      });
      champTexte(g.bloc, { libelle: libreLibelle, cle: libreCle, valeur: v[libreCle], long: true, placeholder: libreLibelle, libelleCache: true, suite: true });
    };
    puces('atcd', 'Antécédents', PUCES_ANTECEDENTS, 'antecedents_puces', 'antecedents', 'Autre antécédent');
    puces('trait', 'Traitements', PUCES_TRAITEMENTS, 'traitements_puces', 'traitements', 'Autre traitement');

    const blocAllergies = creer('div', 'champ'); champTexte(blocAllergies, { libelle: 'Allergies', cle: 'allergies', valeur: v.allergies, long: true, placeholder: 'Allergie connue ?' }); zones.allergies.append(blocAllergies);

    // conscience : AVPU (le SENS des lettres est un texte provisoire de la maquette : ✱)
    const avpu = groupe(zones.avpu, { id: 'avpu', libelle: 'Conscience', nomAccessible: 'Conscience : AVPU', options: NIVEAUX_AVPU.map((n) => ({ id: n.lettre, libelle: n.lettre, sens: n.sens })), choisies: [bv.avpu].filter(Boolean), multiple: false, auToucher: () => {} });
    for (const b of avpu.g.querySelectorAll('button')) { b.setAttribute('aria-label', `AVPU : ${b.dataset.valeur}, ${NIVEAUX_AVPU.find((n) => n.lettre === b.dataset.valeur).sens}`); b.addEventListener('click', () => {
      const nouveau = b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.valeur;
      intervention.definirChamp('bilan_vital', 'avpu', nouveau); marquer(avpu.g, [nouveau]); intervention.ecrire(); auChangement();
    }); }
    avpu.bloc.append(creer('p', 'plan-aide', '✱ Sens des lettres : texte provisoire, à valider.', { id: 'volet-avpu-provisoire' }));

    const blocNotes = creer('div', 'champ'); champTexte(blocNotes, { libelle: 'Notes', cle: 'notes', valeur: v.notes, long: true, placeholder: 'Circonstances, heure de survenue, autre' }); zones.notes.append(blocNotes);
    blocNotes.querySelector('textarea').rows = 3;

    // constantes et gestes (valeurs brutes, jamais jugées) : la rangée d'ajout puis ce qui est noté pour CETTE victime
    zones.mesures.append(blocConstantes, blocGestes);
    montrerAjout(); majTableaux();

    // plus de champs : tout ce que la fiche d'avant contenait en plus
    const plus = creer('details', 'plus-de-champs', '', { id: 'plus-de-champs' });
    plus.open = ouvertPlus;
    plus.append(creer('summary', null, 'Plus de champs'));
    const dedans = creer('div', 'plus-corps'); plus.append(dedans);
    champTexte(dedans, { libelle: 'Prénom', bloc: 'identite', cle: 'prenom', valeur: idt.prenom });
    const naissance = creer('div', 'naissance', '', { role: 'group', 'aria-label': 'Date de naissance' });
    const ageCalcule = creer('span', 'plan-aide', '', { id: 'age-calcule', role: 'status' });
    const majAge = () => { const t = texteAge(victimeActive(fiche()).identite, Date.now()); ageCalcule.textContent = t ? `Âge : ${t}` : ''; };
    for (const [partie, lib, max] of [['jour', 'Jour', 2], ['mois', 'Mois', 2], ['annee', 'Année', 4]]) {
      const e = creer('input', 'naissance-champ', '', { type: 'text', inputmode: 'numeric', maxlength: max, placeholder: lib, 'aria-label': `Date de naissance : ${lib.toLowerCase()}`, 'data-naissance': partie, ...SANS_AUTO });
      e.value = idt.date_naissance?.[partie] ?? '';
      e.addEventListener('input', () => { e.value = e.value.replace(/[^0-9]/g, ''); intervention.definirNaissance(partie, e.value); majAge(); auChangement(); });
      e.addEventListener('change', () => intervention.ecrire());
      naissance.append(e);
    }
    dedans.append(creer('span', 'champ-libelle', 'Date de naissance (jour, mois, année)'), naissance, ageCalcule);
    majAge();
    champTexte(dedans, { libelle: 'Âge estimé (si la date est inconnue)', bloc: 'identite', cle: 'age_estime', valeur: idt.age_estime, clavier: 'numeric' });
    champTexte(dedans, { libelle: 'Poids estimé (information à transmettre, jamais utilisé dans un calcul)', bloc: 'identite', cle: 'poids_estime', valeur: idt.poids_estime, clavier: 'decimal' });
    champTexte(dedans, { libelle: 'Heure de début des signes', bloc: 'circonstances', cle: 'heure_debut', valeur: c.heure_debut });
    champTexte(dedans, { libelle: 'Où dans la structure', bloc: 'circonstances', cle: 'lieu_dans_structure', valeur: c.lieu_dans_structure });
    champTexte(dedans, { libelle: 'Témoin', bloc: 'circonstances', cle: 'temoin', valeur: c.temoin });
    champTexte(dedans, { libelle: 'Gestes déjà faits avant votre arrivée', bloc: 'circonstances', cle: 'gestes_deja_faits', valeur: c.gestes_deja_faits, long: true });
    champTexte(dedans, { libelle: 'Conscience (texte libre)', bloc: 'bilan_vital', cle: 'conscience', valeur: bv.conscience });
    champTexte(dedans, { libelle: 'Respiration', bloc: 'bilan_vital', cle: 'respiration', valeur: bv.respiration });
    champTexte(dedans, { libelle: 'Circulation', bloc: 'bilan_vital', cle: 'circulation', valeur: bv.circulation });
    champTexte(dedans, { libelle: 'Médecin traitant', cle: 'medecin_traitant', valeur: v.medecin_traitant });
    dedans.append(creer('p', 'plan-aide', 'Message au 15 (le même pour toutes les victimes) :'));
    champTexte(dedans, { libelle: 'Mon évaluation', cle: 'evaluation', valeur: f.evaluation, long: true });
    champTexte(dedans, { libelle: 'Ma demande', cle: 'demande', valeur: f.demande, long: true });
    champs.append(plus);

    // retrait d'une fiche ajoutée par erreur : seulement s'il y en a plusieurs ; confirmation DANS la page, qui annonce ce qui part ; « Annuler » ne supprime rien
    if (f.victimes.length > 1 && v.id !== f.victimes[0].id) champs.append(blocRetrait(v.id));   // jamais la première : c'est la victime prise en charge (D-64b, M3)
  }

  function blocRetrait(id) {
    const f = fiche();
    const bloc = creer('div', 'retrait');
    const libelle = libelleVictime(f, id);
    const confirmation = creer('div', 'retrait-confirmation', '', { id: 'volet-retirer-confirmation', role: 'alert' });
    const ouvrirConfirmation = () => {
      const x = contenuVictime(fiche(), id);
      const emporte = [x.champs ? 'sa fiche' : '', x.constantes > 0 ? `${x.constantes} constante${x.constantes > 1 ? 's' : ''}` : '', x.gestes > 0 ? `${x.gestes} geste${x.gestes > 1 ? 's' : ''}` : ''].filter(Boolean);
      confirmation.replaceChildren(
        creer('p', null, `Retirer ${libelle} ? ${emporte.length > 0 ? `Seront retirés de la fiche : ${emporte.join(', ')} (le journal garde ses entrées).` : 'Sa fiche est vide.'}`),
        bouton(`Confirmer : retirer ${libelle}`, 'bouton bouton-urgence', () => { etat.retrait = false; intervention.retirerVictime(id); redessiner(); auChangement(); onglets.querySelector('.onglet-actif')?.focus({ preventScroll: true }); }, { id: 'volet-retirer-confirme' }),
        bouton('Annuler', 'bouton', () => { etat.retrait = false; confirmation.hidden = true; declencheur.hidden = false; declencheur.focus({ preventScroll: true }); }, { id: 'volet-retirer-annuler' }),
      );
      confirmation.hidden = false; declencheur.hidden = true; etat.retrait = true;
      confirmation.querySelector('#volet-retirer-annuler').focus({ preventScroll: true });   // le focus va sur « Annuler » : un double toucher involontaire ne retire rien
    };
    const declencheur = bouton(`Retirer ${libelle}`, 'bouton retrait-declencheur', ouvrirConfirmation, { id: 'volet-retirer' });
    confirmation.hidden = !etat.retrait; declencheur.hidden = etat.retrait;
    if (etat.retrait) ouvrirConfirmation();
    bloc.append(declencheur, confirmation);
    return bloc;
  }

  function redessiner() { dessinerOnglets(); dessinerChamps(); }
  redessiner();
  return { element: volet, prise, titre, redessiner, remettreEtat: () => { etat.retrait = false; } };
}
