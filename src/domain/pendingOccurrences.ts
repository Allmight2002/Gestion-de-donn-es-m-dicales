// L69 — occurrences TAMPONNEES a la creation d'une fiche (spec §8.3).
//
// Une rencontre exige un patient existant. Plutot que de couper la saisie en deux seances —
// inacceptable pour une collecte retrospective menee d'un trait — les occurrences saisies dans
// l'ecran de creation restent EN MEMOIRE, marquees « non enregistree », et sont ecrites apres
// `create_patient` par une RPC de rencontre idempotente par ligne, DANS L'ORDRE DE SAISIE.
//
// Le motif est celui du mode hors-ligne (`replay_patient_create` puis `replay_encounter_create`,
// rejeu ordonne) : creer le parent, puis rejouer ses enfants dans l'ordre, en s'arretant a la
// premiere ligne qui echoue. Il n'est pas reinvente ici, seulement applique sans file locale :
// le tampon vit le temps de l'ecran, et la fiche est creee dans la foulee.
//
// L'enregistrement transactionnel unique de la fiche ET de ses occurrences est HORS PERIMETRE
// (§12) : il n'y a donc pas de verdict global, et chaque ligne porte son propre sort.

/** Une ligne du tampon. `savedId` non nul = ecrite cote serveur, definitivement. */
export type PendingOccurrence = {
  /** Cle locale stable ; sa valeur sert à former la clé d'opération envoyée au serveur. */
  localId: string;
  /** Bloc repetable qui porte la ligne. */
  sectionKey: string;
  data: Record<string, unknown>;
  validationStatus: 'draft' | 'complete';
  /**
   * Identifiant SERVEUR une fois la ligne ecrite, `null` tant qu'elle ne l'est pas.
   *
   * Confirme la création côté serveur et évite les appels inutiles. Une réponse incertaine est
   * rejouée avec la clé d'opération stable, protégée par la RPC idempotente.
   */
  savedId: string | null;
  /** Dernier résultat du transport : une erreur réseau peut masquer une écriture déjà validée. */
  deliveryState: 'not_attempted' | 'rejected' | 'unknown';
  /** Message du dernier echec SUR CETTE LIGNE. `null` = jamais tentee, ou reussie. */
  error: string | null;
};

export const isSavedOccurrence = (row: PendingOccurrence): boolean => row.savedId !== null;

/** Lignes sans identifiant serveur confirmé ; le résultat peut rester incertain après une panne réseau. */
export const unsavedOccurrences = (rows: readonly PendingOccurrence[]): PendingOccurrence[] =>
  rows.filter((row) => !isSavedOccurrence(row));

/** Une erreur de transport ne prouve pas que la transaction serveur a échoué. */
export function isUncertainOccurrenceFailure(error: unknown): boolean {
  const object = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const status = object?.status;
  // Un 5xx ou un timeout HTTP peut venir d'un proxy qui a perdu la reponse apres
  // le commit. La ligne doit alors etre rejouee avec la meme cle, jamais abandonnee.
  if (typeof status === 'number') return status === 0 || status === 408 || (status >= 500 && status <= 599);
  const message = error instanceof Error ? error.message
    : typeof object?.message === 'string' ? object.message : String(error ?? '');
  return /failed to fetch|load failed|network|timeout|timed out|connection|socket|econn|enotfound|eai_again|abort/i.test(message);
}

/** Quitter l'ecran avec une seule de ces lignes demande confirmation (§8.3). */
export const hasUnsavedOccurrences = (rows: readonly PendingOccurrence[]): boolean =>
  rows.some((row) => !isSavedOccurrence(row));

/** Prochaine ligne a ecrire : la premiere non enregistree, dans l'ordre de saisie. */
export const nextUnsavedOccurrence = (rows: readonly PendingOccurrence[]): PendingOccurrence | null =>
  rows.find((row) => !isSavedOccurrence(row)) ?? null;

/** Ecriture d'UNE ligne. C'est `create_encounter` dans l'ecran ; une promesse ici. */
export type OccurrenceWriter = (row: PendingOccurrence) => Promise<{ id: string }>;

export type ReplayOutcome = {
  /** Le tampon MIS A JOUR : meme ordre, meme longueur, jamais une ligne perdue. */
  rows: PendingOccurrence[];
  /** La ligne qui a interrompu le rejeu, ou `null` si tout est passe. */
  failed: PendingOccurrence | null;
  /** Nombre de lignes ecrites PENDANT ce rejeu. */
  written: number;
};

/**
 * Rejoue le tampon DANS L'ORDRE, une ligne a la fois.
 *
 * Trois proprietes, et ce sont elles que le lot doit tenir :
 *
 *  - **Aucune ligne ecrite deux fois.** Une ligne deja porteuse d'un `savedId` est sautee, y
 *    compris apres dix reprises.
 *  - **Aucune ligne perdue.** Le tampon revient complet ; une ligne qui echoue reste dans le
 *    tampon avec son message, et celles qui la suivent restent intactes.
 *  - **L'ordre de saisie est preserve.** Le rejeu s'ARRETE a la premiere ligne qui echoue :
 *    ecrire la suivante la placerait avant elle, et l'ordre affiche ne serait plus l'ordre saisi.
 *
 * `limit` borne le nombre de lignes TENTEES : `1` reprend exactement une ligne, ce qui donne la
 * reprise ligne par ligne. Sans borne, le rejeu va jusqu'au bout ou jusqu'au premier echec.
 */
export async function replayPendingOccurrences(
  rows: readonly PendingOccurrence[],
  write: OccurrenceWriter,
  options: { limit?: number; describeError: (error: unknown) => string } = {
    describeError: () => 'error',
  },
): Promise<ReplayOutcome> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const next = [...rows];
  let attempted = 0;
  let written = 0;

  for (let index = 0; index < next.length; index += 1) {
    const row = next[index];
    if (isSavedOccurrence(row)) continue;
    if (attempted >= limit) break;
    attempted += 1;
    try {
      const created = await write(row);
      // L'etat affiche est l'etat REEL : une ligne ne passe a « enregistree » qu'une fois
      // l'identifiant serveur recu. Jamais un optimisme pose avant l'appel.
      next[index] = { ...row, savedId: created.id, deliveryState: 'not_attempted', error: null };
      written += 1;
    } catch (error) {
      const failed = {
        ...row,
        deliveryState: isUncertainOccurrenceFailure(error) ? 'unknown' as const : 'rejected' as const,
        error: options.describeError(error),
      };
      next[index] = failed;
      return { rows: next, failed, written };
    }
  }

  return { rows: next, failed: null, written };
}
