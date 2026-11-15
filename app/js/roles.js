// Rôles d'équipe (cahier des charges 4.4, 3.3) : fonctions PURES sur le tableau `fiche.roles` = [{ role, personne, depuis }].
// Les cinq rôles sont ceux de SPEC.md (déroulé d'une intervention, point 2) ; AUCUNE répartition n'est recommandée par l'appli
// (la répartition à 1-3 soignants est A_VALIDER, fiche ACR V7 et V19). Le cumul est permis : une même personne peut tenir plusieurs rôles.
// Un rôle sans personne s'affiche « — ». Rien ici ne bloque jamais une action vitale.

export const ROLES = Object.freeze([
  { id: 'chef', libelle: "Chef d'intervention", court: 'Chef' },
  { id: 'compressions', libelle: 'Compressions', court: 'Compressions' },
  { id: 'dae', libelle: 'DAE / matériel', court: 'DAE' },
  { id: 'appel', libelle: 'Appel', court: 'Appel' },
  { id: 'scribe', libelle: 'Scribe', court: 'Scribe' },
]);
export const AUCUN = '—';
const MAX_PERSONNES = 12;
const MAX_LONGUEUR = 40;

const nettoyer = (t) => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ').slice(0, MAX_LONGUEUR) : '');

/**
 * Attribue (ou retire, si `personne` est vide) un rôle. Renvoie { roles, changement } sans modifier l'entrée ; `changement` est null si rien
 * ne change (même personne). Un rôle a au plus une personne ; le cumul (une personne, plusieurs rôles) est permis.
 * @returns {{roles: object[], changement: null | {role: string, de: string|null, vers: string|null}}}
 */
export function attribuerRole(roles, role, personne, maintenant = Date.now()) {
  if (!ROLES.some((r) => r.id === role)) throw new Error(`rôle inconnu : ${role}`);
  const nom = nettoyer(personne);
  const avant = roles.find((r) => r.role === role)?.personne ?? null;
  const vers = nom === '' ? null : nom;
  if (avant === vers) return { roles: roles.map((r) => ({ ...r })), changement: null };
  const sans = roles.filter((r) => r.role !== role).map((r) => ({ ...r }));
  const suivant = vers === null ? sans : [...sans, { role, personne: vers, depuis: maintenant }];
  // même ordre que la liste des rôles : l'affichage et le journal restent prévisibles
  suivant.sort((a, b) => ROLES.findIndex((r) => r.id === a.role) - ROLES.findIndex((r) => r.id === b.role));
  return { roles: suivant, changement: { role, de: avant, vers } };
}

/** Une entrée par rôle, dans l'ordre de SPEC.md ; « — » quand personne n'est attribué. */
export function resumeRoles(roles) {
  return ROLES.map((r) => ({ ...r, personne: roles.find((x) => x.role === r.id)?.personne ?? null, affiche: roles.find((x) => x.role === r.id)?.personne ?? AUCUN }));
}

/** Une ligne pour le bandeau : « Chef : Dr A · Compressions : — · … ». */
export function texteBandeau(roles) { return resumeRoles(roles).map((r) => `${r.court} : ${r.affiche}`).join(' · '); }

/** Seulement les rôles ATTRIBUÉS (« Chef : Dr A · DAE : Marie ») : la ligne ne montre plus des tirets pour les rôles vides (relecture design D1). */
export function texteBandeauRempli(roles) { return resumeRoles(roles).filter((r) => r.personne !== null).map((r) => `${r.court} : ${r.personne}`).join(' · '); }

/** Version courte (paysage, texte agrandi) : « Rôles 2/5 ». */
export function texteBandeauCourt(roles) { return `Rôles ${roles.filter((r) => ROLES.some((x) => x.id === r.role)).length}/${ROLES.length}`; }

/**
 * Identité et fonction de l'APPELANT de la transmission (4.8) : tirée du rôle « appel » — aucun champ supplémentaire (minimisation, Q-24).
 * @returns {{personne: string, fonction: string}|null}
 */
export function appelant(roles) {
  const r = roles.find((x) => x.role === 'appel');
  return r ? { personne: r.personne, fonction: ROLES.find((x) => x.id === 'appel').libelle } : null;
}

/** Liste des personnes connues de l'appareil (prénoms ou fonctions, saisis une fois et réutilisables) : nettoyée, sans doublon, bornée. */
export function normaliserPersonnes(liste) {
  const vues = new Set(); const propre = [];
  for (const x of Array.isArray(liste) ? liste : []) {
    const n = nettoyer(x);
    if (n !== '' && !vues.has(n.toLowerCase())) { vues.add(n.toLowerCase()); propre.push(n); }
  }
  return propre.slice(0, MAX_PERSONNES);
}

/** Ajoute une personne à la liste de l'appareil (en tête : la plus récente d'abord). */
export function ajouterPersonne(liste, nom) {
  const n = nettoyer(nom);
  return n === '' ? normaliserPersonnes(liste) : normaliserPersonnes([n, ...liste]);
}
