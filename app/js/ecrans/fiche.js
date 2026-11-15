// Écran « Fiche bilan » (cahier des charges 4.6) : saisie à tout moment, AUCUN champ obligatoire, enregistrement à chaque frappe (2.8).
// RÈGLES : pas de saisie automatique, de correction ni de majuscules automatiques sur les champs d'identité et de texte libre ; date de naissance en trois
// champs numériques ; constantes en valeurs BRUTES horodatées, sans aucun jugement (D-19 : ni couleur, ni icône, ni seuil) ; champs limités à ceux de SPEC.md.
// L'écran de saisie n'est JAMAIS redessiné sur l'événement « changement » (on perdrait la frappe) : seuls le tableau des constantes et la liste des gestes sont refaits.
import { creer, bouton, heureLocale } from '../dom.js';
import { TYPES_CONSTANTE, tableauConstantes, texteAge, hhmm, correctionDeEntree, idJournalGeste } from '../bilan.js';
import { avecUnite } from '../unites.js';

const SANS_AUTO = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' };
const maintenantHHMM = () => heureLocale(Date.now());

/** @param {HTMLElement} conteneur @param {{intervention: object, etat: {ajout: object|null}}} options */
export function afficherFiche(conteneur, { intervention, etat }) {
  const fiche = intervention.fiche;
  const page = creer('section', 'ecran-fiche', '', { 'aria-label': 'Fiche bilan' });
  // ───── rangée d'ajout rapide, EN TÊTE de l'écran (avant le titre et l'aide : à 200 % elle était hors écran, revue L7 M4) et fixée quand la place le permet (4.0, fonctions 13 et 14) ─────
  // Le formulaire d'ajout est DANS le bloc fixé, et il remplace la rangée tant qu'il est ouvert : la case de saisie n'est jamais cachée dessous (revue L7 M3).
  const zoneAjout = creer('div', 'zone-ajout', '', { id: 'zone-ajout' });
  const rangee = creer('div', 'rangee-ajout', '', { id: 'rangee-ajout' });
  const formulaire = creer('div', 'ajout-formulaire', '', { id: 'ajout-formulaire' });
  formulaire.hidden = true;
  const ouvrirAjout = (genre, type) => {
    etat.ajout = { genre, type, valeur: '', heure: null };
    montrerAjout();
  };
  for (const t of TYPES_CONSTANTE) rangee.append(bouton(`+ ${t.libelle}`, 'bouton', () => ouvrirAjout('constante', t.id), { 'data-ajout': t.id }));
  rangee.append(bouton('+ Geste', 'bouton', () => ouvrirAjout('geste', null), { 'data-ajout': 'geste' }));
  zoneAjout.append(rangee, formulaire);
  page.append(zoneAjout, creer('h1', null, 'Fiche bilan'), creer('p', 'plan-aide', "Rien n'est obligatoire : remplissez ce que vous savez, quand vous pouvez. Tout est enregistré à chaque frappe, sur cet appareil seulement."));

  function montrerAjout() {
    formulaire.replaceChildren();
    rangee.hidden = Boolean(etat.ajout);
    if (!etat.ajout) { formulaire.hidden = true; return; }
    formulaire.hidden = false;
    const { genre, type } = etat.ajout;
    const def = TYPES_CONSTANTE.find((t) => t.id === type);
    formulaire.append(creer('p', 'ajout-titre', genre === 'geste' ? 'Geste ou produit (texte libre)' : def.libelle));
    const valeur = creer('input', null, '', { id: 'ajout-valeur', type: 'text', inputmode: genre === 'geste' ? 'text' : def.clavier, 'aria-label': genre === 'geste' ? 'Geste ou produit' : `Valeur : ${def.libelle}`, ...SANS_AUTO });
    // brouillon gardé : la valeur et l'heure tapées survivent à un changement d'écran (revue L7, mineur 1)
    valeur.value = etat.ajout.valeur ?? '';
    valeur.addEventListener('input', () => { if (etat.ajout) etat.ajout.valeur = valeur.value; });
    const heure = creer('input', null, '', { id: 'ajout-heure', type: 'time', value: etat.ajout.heure ?? maintenantHHMM(), 'aria-label': 'Heure' });
    heure.addEventListener('input', () => { if (etat.ajout) etat.ajout.heure = heure.value; });
    const erreur = creer('p', 'noter-erreur', '', { id: 'ajout-erreur', role: 'alert' });
    erreur.hidden = true;
    const valider = () => {
      const r = genre === 'geste' ? intervention.ajouterGeste(valeur.value, heure.value) : intervention.ajouterConstante(type, valeur.value, heure.value);
      if (!r.ok) { erreur.textContent = r.raison; erreur.hidden = false; return; }
      etat.ajout = null; montrerAjout(); majTableaux();
    };
    valeur.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
    // unité usuelle (D-26) à côté de la case : texte simple, même couleur que le reste, aucun état (D-19) ; aucune unité pour un geste ni pour un type sans unité
    const unite = genre === 'geste' ? '' : intervention.uniteDe(type);
    formulaire.append(valeur);
    if (unite !== '') formulaire.append(creer('span', 'ajout-unite', unite, { id: 'ajout-unite' }));
    formulaire.append(creer('label', null, 'Heure : ', { for: 'ajout-heure' }), heure, erreur,
      bouton('Ajouter', 'bouton bouton-accent', valider, { id: 'ajout-valider' }), bouton('Annuler', 'bouton', () => { etat.ajout = null; montrerAjout(); }, { id: 'ajout-annuler' }));
    valeur.focus();
  }

  // ───── constantes et gestes : valeurs brutes, ordre chronologique, aucune interprétation ─────
  const blocConstantes = creer('section', 'bloc-constantes', '', { 'aria-label': 'Constantes' });
  const blocGestes = creer('section', 'bloc-gestes', '', { 'aria-label': 'Gestes et produits' });
  function majTableaux() {
    blocConstantes.replaceChildren(creer('h2', null, 'Constantes'));
    const tableau = tableauConstantes(fiche.constantes, fiche);
    if (tableau.length === 0) blocConstantes.append(creer('p', 'plan-aide', 'Aucune constante notée. Touchez « + » ci-dessus.'));
    for (const l of tableau) {
      const p = creer('p', 'constante-ligne', '', { 'data-constante': l.type });
      p.append(creer('strong', null, `${l.libelle} : `));
      l.valeurs.forEach((v, i) => {
        if (i > 0) p.append(document.createTextNode('  ·  '));
        p.append(document.createTextNode(`${hhmm(v.t)} `));
        ajouterValeur(p, avecUnite(v.valeur, v.unite), v.corrige);
      });
      blocConstantes.append(p);
    }
    blocGestes.replaceChildren(creer('h2', null, 'Gestes et produits'));
    const gestes = [...(fiche.gestes_produits ?? [])].sort((a, b) => a.t - b.t);
    if (gestes.length === 0) blocGestes.append(creer('p', 'plan-aide', 'Aucun geste noté. Touchez « + Geste » ci-dessus.'));
    for (const g of gestes) {
      const p = creer('p', 'geste-ligne', `${hhmm(g.t)} — `);
      ajouterValeur(p, g.texte, correctionDeEntree(fiche, idJournalGeste(fiche, g)));
      blocGestes.append(p);
    }
  }
  /** Une valeur corrigée au journal : l'original BARRÉ, puis « corrigé à hh:mm : … » (revue L7 C1) ; jamais la valeur d'origine seule. */
  function ajouterValeur(parent, valeur, corrige) {
    if (!corrige) { parent.append(document.createTextNode(valeur)); return; }
    parent.append(creer('s', null, valeur), document.createTextNode(` corrigé à ${corrige.heure} : ${corrige.texte}`));
  }
  majTableaux();
  page.append(blocConstantes, blocGestes);

  // ───── champs ─────
  const champ = (parent, { libelle, bloc, cle, valeur, long = false, clavier = 'text', aide = null }) => {
    const l = creer('label', 'champ-fiche');
    l.append(creer('span', 'champ-libelle', libelle));
    const e = creer(long ? 'textarea' : 'input', null, '', { ...(long ? { rows: 3 } : { type: 'text', inputmode: clavier }), ...SANS_AUTO, 'data-champ': `${bloc ?? 'fiche'}.${cle}` });
    e.value = valeur ?? '';
    e.addEventListener('input', () => intervention.definirChamp(bloc, cle, e.value));
    e.addEventListener('change', () => intervention.ecrire());   // à la sortie du champ : écriture immédiate, sans attendre le regroupement d'une seconde (revue L7, mineur 10)
    l.append(e);
    if (aide) l.append(creer('span', 'plan-aide', aide));
    parent.append(l);
  };
  const section = (titre) => { const s = creer('fieldset', 'section-fiche'); s.append(creer('legend', null, titre)); page.append(s); return s; };

  const id = fiche.identite ?? {};
  const s1 = section('Identité');
  champ(s1, { libelle: 'Nom', bloc: 'identite', cle: 'nom', valeur: id.nom });
  champ(s1, { libelle: 'Prénom', bloc: 'identite', cle: 'prenom', valeur: id.prenom });
  const sexe = creer('div', 'choix-rapides', '', { role: 'group', 'aria-label': 'Sexe' });
  for (const [v, lib] of [['homme', 'Homme'], ['femme', 'Femme']]) {
    const b = bouton(lib, 'bouton', () => {
      const nouveau = (fiche.identite?.sexe === v) ? '' : v;
      intervention.definirChamp('identite', 'sexe', nouveau);
      for (const x of sexe.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.valeur === nouveau));
    }, { 'data-valeur': v, 'aria-pressed': String(id.sexe === v) });
    sexe.append(b);
  }
  s1.append(creer('span', 'champ-libelle', 'Sexe'), sexe);
  // date de naissance : trois champs numériques (clavier numérique, pas de sélecteur de date)
  const naissance = creer('div', 'naissance', '', { role: 'group', 'aria-label': 'Date de naissance' });
  const age = creer('span', 'plan-aide', '', { id: 'age-calcule', role: 'status' });
  const majAge = () => { age.textContent = texteAge(fiche.identite, Date.now()) ? `Âge : ${texteAge(fiche.identite, Date.now())}` : ''; };
  for (const [partie, libelle, max] of [['jour', 'Jour', 2], ['mois', 'Mois', 2], ['annee', 'Année', 4]]) {
    const e = creer('input', 'naissance-champ', '', { type: 'text', inputmode: 'numeric', maxlength: max, placeholder: libelle, 'aria-label': `Date de naissance : ${libelle.toLowerCase()}`, 'data-naissance': partie, ...SANS_AUTO });
    e.value = id.date_naissance?.[partie] ?? '';
    e.addEventListener('input', () => { e.value = e.value.replace(/[^0-9]/g, ''); intervention.definirNaissance(partie, e.value); majAge(); });
    e.addEventListener('change', () => intervention.ecrire());
    naissance.append(e);
  }
  s1.append(creer('span', 'champ-libelle', 'Date de naissance (jour, mois, année)'), naissance, age);
  majAge();
  champ(s1, { libelle: 'Âge estimé (si la date est inconnue)', bloc: 'identite', cle: 'age_estime', valeur: id.age_estime, clavier: 'numeric' });
  champ(s1, { libelle: 'Poids estimé (information à transmettre, jamais utilisé dans un calcul)', bloc: 'identite', cle: 'poids_estime', valeur: id.poids_estime, clavier: 'decimal' });

  const c = fiche.circonstances ?? {};
  const s2 = section('Circonstances');
  champ(s2, { libelle: 'Heure de début des signes', bloc: 'circonstances', cle: 'heure_debut', valeur: c.heure_debut });
  champ(s2, { libelle: 'Où dans la structure', bloc: 'circonstances', cle: 'lieu_dans_structure', valeur: c.lieu_dans_structure });
  champ(s2, { libelle: 'Témoin', bloc: 'circonstances', cle: 'temoin', valeur: c.temoin });
  champ(s2, { libelle: 'Gestes déjà faits avant votre arrivée', bloc: 'circonstances', cle: 'gestes_deja_faits', valeur: c.gestes_deja_faits, long: true });

  const bv = fiche.bilan_vital ?? {};
  const s3 = section('Bilan vital');
  // conscience : choix AVPU (sigle sourcé du glossaire) + texte libre ; la forme définitive est une décision du médecin (Q-8)
  const avpu = creer('div', 'choix-rapides', '', { role: 'group', 'aria-label': 'Conscience : AVPU' });
  for (const lettre of ['A', 'V', 'P', 'U']) {
    avpu.append(bouton(lettre, 'bouton', () => {
      const nouveau = (fiche.bilan_vital?.avpu === lettre) ? '' : lettre;
      intervention.definirChamp('bilan_vital', 'avpu', nouveau);
      for (const x of avpu.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.valeur === nouveau));
    }, { 'data-valeur': lettre, 'aria-pressed': String(bv.avpu === lettre), 'aria-label': `AVPU : ${lettre}` }));
  }
  s3.append(creer('span', 'champ-libelle', 'Conscience : AVPU (voir « Glossaire »)'), avpu);
  champ(s3, { libelle: 'Conscience (texte libre)', bloc: 'bilan_vital', cle: 'conscience', valeur: bv.conscience });
  champ(s3, { libelle: 'Respiration', bloc: 'bilan_vital', cle: 'respiration', valeur: bv.respiration });
  champ(s3, { libelle: 'Circulation', bloc: 'bilan_vital', cle: 'circulation', valeur: bv.circulation });

  const s4 = section('Antécédents, traitements, allergies');
  champ(s4, { libelle: 'Antécédents', bloc: null, cle: 'antecedents', valeur: fiche.antecedents, long: true });
  champ(s4, { libelle: 'Traitements', bloc: null, cle: 'traitements', valeur: fiche.traitements, long: true });
  champ(s4, { libelle: 'Allergies', bloc: null, cle: 'allergies', valeur: fiche.allergies, long: true });
  champ(s4, { libelle: 'Médecin traitant', bloc: null, cle: 'medecin_traitant', valeur: fiche.medecin_traitant });

  const s5 = section('Pour la transmission (E et D)');
  champ(s5, { libelle: 'Mon évaluation', bloc: null, cle: 'evaluation', valeur: fiche.evaluation, long: true });
  champ(s5, { libelle: 'Ma demande', bloc: null, cle: 'demande', valeur: fiche.demande, long: true });

  if (etat.ajout) montrerAjout();
  conteneur.replaceChildren(page);
}
