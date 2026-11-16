// Modification sur place des informations du MODE TRANSMISSION (D-65, d) : modèle PUR, sans DOM ni stockage. Une ligne modifiable de la transmission porte `edit` = où l'écrire :
//  - `victime`        : un champ de LA victime de la ligne (pas forcément l'onglet ouvert) : { cible, victime, bloc (ou null), cle, initial } ;
//  - `lieu-champ`     : un champ du lieu d'un domicile (`fiche.lieu.adresse`, `etage`, `code_acces`, `acces`) ;
//  - `lieu-surcharge` : au cabinet, une valeur propre à CETTE intervention qui prime sur la structure (`fiche.lieu.surcharges[chemin]`) — jamais le fichier de configuration `config/structure.json` ;
//    une valeur vide retire la surcharge (on revient à la structure).
// Tout reste dans la fiche, donc sur l'appareil, effacé avec elle ; aucun accès réseau ni stockage externe ici.

/** Clé unique d'une ligne modifiable (identifie la ligne en cours de modification). */
export const cleEdition = (e) => [e.cible, e.victime ?? '', e.bloc ?? '', e.cle].join(':');

const victimeDe = (fiche, id) => (fiche?.victimes ?? []).find((v) => v.id === id);

/** Valeur actuelle à proposer dans le champ : celle de la fiche ; pour une surcharge absente, la valeur affichée (`initial`, celle de la structure). */
export function lireEdition(fiche, e) {
  if (e.cible === 'victime') {
    const v = victimeDe(fiche, e.victime);
    const source = e.bloc ? v?.[e.bloc] : v;
    return String(source?.[e.cle] ?? '');
  }
  if (e.cible === 'lieu-champ') return String(fiche?.lieu?.[e.cle] ?? '');
  if (e.cible === 'lieu-surcharge') return fiche?.lieu?.surcharges?.[e.cle] ?? (e.initial ?? '');
  return '';
}

/** Écrit la valeur. Modifie `fiche`. @returns {{ok: boolean, raison?: string}} */
export function ecrireEdition(fiche, e, valeur) {
  const texte = typeof valeur === 'string' ? valeur : String(valeur ?? '');
  if (e.cible === 'victime') {
    const v = victimeDe(fiche, e.victime);
    if (!v) return { ok: false, raison: 'victime inconnue' };
    if (e.bloc) v[e.bloc] = { ...(v[e.bloc] ?? {}), [e.cle]: texte }; else v[e.cle] = texte;
    return { ok: true };
  }
  if (e.cible === 'lieu-champ') { fiche.lieu = { ...(fiche.lieu ?? {}), [e.cle]: texte }; return { ok: true }; }
  if (e.cible === 'lieu-surcharge') {
    const surcharges = { ...(fiche.lieu?.surcharges ?? {}) };
    if (texte.trim() === '') delete surcharges[e.cle]; else surcharges[e.cle] = texte.trim();
    fiche.lieu = { ...(fiche.lieu ?? { type: 'cabinet' }), surcharges };
    return { ok: true };
  }
  return { ok: false, raison: 'cible inconnue' };
}
