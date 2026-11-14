// Ligne d'état de préparation (cahier des charges 4.1) : en bas de l'accueil, au lieu d'une pile de bandeaux.
// « Prêt » (pictogramme + texte) ou « n points à vérifier » ; un toucher ouvre la liste. Chaque lot ajoute ses points :
// L2 en pose trois (fichiers hors ligne, structure, version) ; le son, l'écran, la profession… arrivent avec leurs lots.

const points = new Map(); // identifiant → { texte, ok }
let ouvert = false;

function racine() { return document.getElementById('etat-preparation'); }

/** Déclare ou met à jour un point de la liste. `ok: true` = rien à signaler (le point reste dans la liste, coché). */
export function definirPoint(id, { texte, ok }) {
  points.set(id, { texte, ok });
  rendre();
}

export function retirerPoint(id) { points.delete(id); rendre(); }

export function pointsAVerifier() { return [...points.values()].filter((p) => !p.ok); }

export function rendre() {
  const zone = racine();
  if (!zone) return;
  const aVerifier = pointsAVerifier();
  zone.replaceChildren();

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.setAttribute('aria-expanded', String(ouvert));
  bouton.dataset.etat = aVerifier.length === 0 ? 'pret' : 'a-verifier';
  // le pictogramme DOUBLE le texte : l'information ne passe jamais par la couleur seule
  bouton.textContent = aVerifier.length === 0 ? '✓ Prêt' : `⚠ ${aVerifier.length} point${aVerifier.length > 1 ? 's' : ''} à vérifier`;
  bouton.addEventListener('click', () => { ouvert = !ouvert; rendre(); });
  zone.append(bouton);

  if (ouvert) {
    const liste = document.createElement('ul');
    for (const { texte, ok } of points.values()) {
      const li = document.createElement('li');
      li.textContent = `${ok ? '✓' : '⚠'} ${texte}`;
      liste.append(li);
    }
    zone.append(liste);
  }
}
