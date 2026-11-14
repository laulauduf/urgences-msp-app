// Effacement automatique à l'expiration (cahier des charges 2.9). Fonctions PURES : décision, bornes du délai, surveillance de l'horloge.
// L'exécution (lecture, effacement vérifié) est dans stockage.js. Ce fichier ne contient aucune donnée de fiche.

export const DELAI_DEFAUT_H = 24;       // SPEC.md, règle absolue 3
export const PLANCHER_DEFAUT_H = 8;     // PROVISOIRE (Q-28), lu de config/structure.json quand il existe
export const MAXIMUM_H = 24;            // le délai se règle entre le plancher et 24 h (Q-13 : au-delà, question ouverte)

/** Borne un délai demandé entre le plancher et le maximum ; une valeur absurde redonne le défaut. */
export function delaiEffectif(demandeH, { plancherH = PLANCHER_DEFAUT_H, maximumH = MAXIMUM_H } = {}) {
  if (!Number.isFinite(demandeH)) return Math.min(maximumH, Math.max(plancherH, DELAI_DEFAUT_H));
  return Math.min(maximumH, Math.max(plancherH, demandeH));
}

/**
 * Que faire d'une fiche à ce passage ?
 *  - 'garder'    : délai non atteint ;
 *  - 'effacer'   : délai atteint, rien ne s'y oppose ;
 *  - 'reporter'  : délai atteint MAIS la fiche est affichée ou non terminée alors que l'appli est ouverte : bandeau, pas d'effacement
 *                  silencieux ; l'effacement aura lieu à la fermeture de l'écran ou à l'ouverture suivante ;
 *  - 'horloge'   : l'heure du téléphone est incohérente (antérieure à la création, ou saut détecté) : on ne purge pas en silence.
 * @param {object} resume résumé de fiche (cree_le, expire_le, etat, id)
 * @param {{maintenant: number, delaiH: number, passage: 'ouverture'|'retour'|'periodique', afficheeId?: string|null, horlogeSuspecte?: boolean}} contexte
 */
export function decisionPurge(resume, { maintenant, delaiH, passage, afficheeId = null, horlogeSuspecte = false }) {
  if (horlogeSuspecte || maintenant < resume.cree_le) return 'horloge';
  // le délai est compté depuis la CRÉATION (Q-13) ; si l'utilisateur l'a raccourci depuis, le plus court gagne
  const echeance = Math.min(resume.expire_le ?? Infinity, resume.cree_le + delaiH * 3600 * 1000);
  if (maintenant < echeance) return 'garder';
  if (resume.id === afficheeId) return 'reporter';
  if (passage !== 'ouverture' && resume.etat === 'en_cours') return 'reporter'; // appli ouverte : quelqu'un s'en sert peut-être
  return 'effacer';
}

/**
 * Surveille l'horloge du téléphone tant que la page est VISIBLE (2.7) : `Date.now()` et `performance.now()` avancent d'un même pas ;
 * un écart qui varie de plus de `seuilMs` entre deux échantillons = l'heure a été changée (ou le réseau l'a remise à l'heure).
 * Un saut pendant l'arrière-plan n'est pas détectable (limite connue) : `repartir()` à chaque retour au premier plan.
 */
export class SurveillanceHorloge {
  constructor({ date = () => Date.now(), perf = () => performance.now(), seuilMs = 500 } = {}) {
    this.date = date; this.perf = perf; this.seuilMs = seuilMs;
    this.suspecte = false;
    this.dernierSaut = 0;
    this.repartir();
  }

  /** Nouveau point de référence (lancement, retour au premier plan). Ne lève pas l'alerte déjà posée. */
  repartir() { this.ecart = this.date() - this.perf(); }

  /** À appeler à chaque passage de purge ; renvoie true si l'horloge paraît modifiée. */
  echantillonner() {
    const ecart = this.date() - this.perf();
    const variation = ecart - this.ecart;
    if (Math.abs(variation) > this.seuilMs) { this.suspecte = true; this.dernierSaut = variation; }
    this.ecart = ecart;
    return this.suspecte;
  }

  /** L'utilisateur a vérifié l'heure : on lève l'alerte (la purge reprend). */
  acquitter() { this.suspecte = false; this.dernierSaut = 0; this.repartir(); }
}
