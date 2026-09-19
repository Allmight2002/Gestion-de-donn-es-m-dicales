// E5 — dispense de justification du propriétaire (spécification §4.5 et §7.4).
//
// Le serveur est seul à accorder la dispense : `form_justification_status(base_id, reason)`
// n'accepte un motif absent qu'après avoir vérifié le propriétaire réel de la base et son rôle
// de médecin, puis journalise `justification_status = owner_exempt`. Un autre compte qui
// enverrait un motif vide reçoit `JUSTIFICATION_REQUIRED`.
//
// Ce module ne fait donc que REFLÉTER ce contrat, pour ne pas réclamer un texte que le serveur
// n'exige pas. Il ne l'accorde pas, il n'élargit aucun droit, et la confirmation, la
// concurrence, les transitions de statut et l'audit restent inchangés.

import type { BaseListing } from '../data/bases';
import type { Profile } from '../auth/types';

/**
 * L'opération autorisée peut-elle être enregistrée sans motif rédigé ?
 *
 * Le rôle vient de la lecture serveur de la base (`getBase`), pas d'une déclaration du
 * navigateur. Hors de ces deux conditions, l'exigence actuelle est conservée telle quelle.
 */
export function ownerJustificationExempt(
  base: Pick<BaseListing, 'role'> | null | undefined,
  profile: Pick<Profile, 'globalRole'> | null | undefined,
): boolean {
  return base?.role === 'owner' && profile?.globalRole === 'medecin';
}
