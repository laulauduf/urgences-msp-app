// Journal (cahier des charges 4.10) : frise chronologique de toutes les entrées, chacune avec son heure ET son « T+mm:ss » depuis URGENCE.
// Toucher « Corriger » : saisie de la correction ; l'entrée d'origine reste visible, BARRÉE, l'heure de la correction est conservée (3.3).
// Écran de saisie : jamais redessiné sur « changement » (l'interface le garde à l'écart) ; seules ses propres actions le redessinent.
import { creer, bouton } from '../dom.js';
import { frise } from '../bilan.js';

/** @param {HTMLElement} conteneur @param {{intervention: object, etat: {corrige: string|null, texte: string, erreur: string|null}, auFermer: () => void, auRendre: () => void}} options */
export function afficherJournal(conteneur, { intervention, etat, auFermer, auRendre }) {
  const page = creer('section', 'ecran-journal', '', { 'aria-label': 'Journal' });
  const titre = creer('div', 'panneau-titre');
  titre.append(bouton('Fermer', 'bouton', auFermer, { id: 'fermer-journal' }));
  page.append(titre, creer('h1', null, 'Journal'));
  const liste = creer('ol', 'journal-liste');
  for (const l of frise(intervention.fiche)) {
    const li = creer('li', 'journal-ligne', '', { 'data-entree': l.id, 'data-type': l.type });
    li.append(creer('span', 'journal-heure', `${l.heure} · ${l.tPlus}`));
    const texte = creer('span', 'journal-texte');
    if (l.barree) texte.append(creer('s', null, l.texte)); else texte.append(document.createTextNode(l.texte));
    li.append(texte);
    // A10 : le crayon ✎ (48 × 48) est sur la MÊME rangée que l'heure et le texte (plus un bouton « Corriger » dessous) ; il porte le texte de l'entrée dans son nom accessible
    if (etat.corrige !== l.id && l.corrigeable) li.append(bouton('✎', 'bouton journal-corriger', () => { etat.corrige = l.id; etat.texte = ''; etat.erreur = null; auRendre(); }, { 'data-corriger': l.id, 'aria-label': `Corriger : ${l.texte}` }));
    for (const c of l.corrections) li.append(creer('span', 'journal-correction', `correction à ${c.heure} (${c.tPlus}) : ${c.texte}`));
    if (etat.corrige === l.id) {
      const t = creer('textarea', 'journal-saisie', '', { id: 'correction-texte', rows: 2, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': `Correction de : ${l.texte}` });
      t.value = etat.texte ?? '';
      t.addEventListener('input', () => { etat.texte = t.value; });
      li.append(t);
      if (etat.erreur) li.append(creer('p', 'noter-erreur', etat.erreur, { role: 'alert' }));
      li.append(bouton('Enregistrer la correction', 'bouton bouton-accent', () => {
        const r = intervention.corrigerEntree(l.id, etat.texte);
        if (r.ok) { etat.corrige = null; etat.texte = ''; etat.erreur = null; } else etat.erreur = r.raison;
        auRendre();
      }, { id: 'correction-valider' }), bouton('Annuler', 'bouton', () => { etat.corrige = null; etat.erreur = null; auRendre(); }, { id: 'correction-annuler' }));
    }
    liste.append(li);
  }
  page.append(liste);
  conteneur.replaceChildren(page);
}
