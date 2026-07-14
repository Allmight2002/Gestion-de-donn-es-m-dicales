export type GuardedWriteOutcome =
  | 'updated'
  | 'not_found'
  | 'forbidden'
  | 'stale'
  | 'invalid_state'
  | 'invalid_input';

const TOKENS: Record<Exclude<GuardedWriteOutcome, 'updated'>, string> = {
  not_found: 'WRITE_NOT_FOUND',
  forbidden: 'WRITE_FORBIDDEN',
  stale: 'WRITE_STALE',
  invalid_state: 'WRITE_INVALID_STATE',
  invalid_input: 'WRITE_INVALID_INPUT',
};

/** Transforme le resultat stable d'une RPC d'ecriture en succes confirme ou erreur applicative. */
export function requireUpdatedRow<T extends { outcome: GuardedWriteOutcome }>(data: unknown): T {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== 'object') throw new Error('WRITE_FAILED');
  const outcome = (candidate as { outcome?: unknown }).outcome;
  if (outcome === 'updated') return candidate as T;
  if (typeof outcome === 'string' && outcome in TOKENS) {
    throw new Error(TOKENS[outcome as Exclude<GuardedWriteOutcome, 'updated'>]);
  }
  throw new Error('WRITE_FAILED');
}
