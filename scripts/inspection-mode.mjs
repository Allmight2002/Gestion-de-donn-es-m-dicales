// Interrupteur unique du parcours d'inspection antivirus (decision du 12 aout 2026,
// docs/decision-pause-inspection-2026-08-12.md). Deux valeurs, jamais davantage :
//
//   strict : scanner ClamAV joignable EXIGE. Verdict serveur obligatoire avant toute
//            lecture ; c'est le mode a retablir avant la moindre donnee reelle.
//   paused : parcours suspendu. Aucun scanner, aucun tunnel ephemere, ni pour les
//            preuves staging ni pour la production interne a donnees fictives.
//
// Le defaut reste 'strict' : une variable oubliee ne doit JAMAIS desactiver l'antivirus
// en silence. C'est le pipeline (ou l'operateur) qui declare la pause, explicitement.
// La suspension est ecrite dans les journaux a chaque execution : une derogation muette
// est pire qu'un controle absent, parce qu'elle donne l'illusion d'un controle.

export const INSPECTION_STRICT = 'strict';
export const INSPECTION_PAUSED = 'paused';

export const INSPECTION_MODE_ERROR = "INSPECTION_MODE doit valoir 'strict' ou 'paused'.";

/** Mode declare, ou null si la valeur fournie est invalide (jamais un repli silencieux). */
export function readInspectionMode(env = process.env) {
  const raw = String(env.INSPECTION_MODE ?? '').trim().toLowerCase();
  if (raw === '') return INSPECTION_STRICT;
  if (raw === INSPECTION_STRICT || raw === INSPECTION_PAUSED) return raw;
  return null;
}

export function isInspectionPaused(env = process.env) {
  return readInspectionMode(env) === INSPECTION_PAUSED;
}

/**
 * Valeur attendue des drapeaux d'inspection (frontend, Edge, base) pour un mode donne.
 * Les trois doivent bouger ENSEMBLE : un frontend permissif devant une base stricte
 * laisse les documents bloques en `pending`, l'inverse ouvre une lecture non verifiee.
 */
export function expectedInspectionFlag(mode) {
  return mode === INSPECTION_PAUSED ? 'false' : 'true';
}

export function inspectionPauseBanner(target) {
  return [
    `DEROGATION SCANNER — inspection antivirus SUSPENDUE (${target}).`,
    '  Les fichiers deposes ne sont PAS analyses : aucun verdict ClamAV, aucune quarantaine.',
    '  Ils redeviennent lisibles sur le seul controle navigateur (statut accepted_client).',
    '  Cette release ne demontre donc NI detection virale, NI isolement d un fichier infecte.',
    '  Admissible uniquement sur des donnees ENTIEREMENT FICTIVES, sans utilisateur tiers.',
    '  A LEVER avant toute donnee reelle : INSPECTION_MODE=strict (docs/derogations-readiness.md).',
  ].join('\n');
}
