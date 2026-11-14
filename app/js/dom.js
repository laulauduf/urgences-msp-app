// Petites aides DOM communes aux écrans. Jamais d'innerHTML avec du texte venu d'un fichier ou de la fiche : textContent seulement.

export function creer(balise, classe, texte, attributs) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined && texte !== null) e.textContent = texte;
  if (attributs) for (const [k, v] of Object.entries(attributs)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  return e;
}

/** Bouton (type="button") avec gestionnaire de clic. */
export function bouton(texte, classe, auClic, attributs) {
  const b = creer('button', classe ?? 'bouton', texte, { type: 'button', ...attributs });
  if (auClic) b.addEventListener('click', auClic);
  return b;
}

/** « hh:mm » en heure locale (jamais utilisé seul : le « T+ » accompagne toujours l'heure dans le journal et l'export). */
export function heureLocale(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
