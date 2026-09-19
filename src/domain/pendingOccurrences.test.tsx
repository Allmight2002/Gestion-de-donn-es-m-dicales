// L69 — les trois proprietes du rejeu ordonne, prises isolement (spec §8.3).
import { describe, expect, test, vi } from 'vitest';
import {
  hasUnsavedOccurrences, replayPendingOccurrences, unsavedOccurrences, type PendingOccurrence,
} from './pendingOccurrences';

const row = (localId: string, over: Partial<PendingOccurrence> = {}): PendingOccurrence => ({
  localId, sectionKey: 'lesions', data: { niveau: localId }, validationStatus: 'complete',
  savedId: null, deliveryState: 'not_attempted', error: null, ...over,
});

const describeError = (error: unknown) => (error as Error).message;

describe('rejeu ordonne du tampon', () => {
  test('ecrit chaque ligne dans l’ordre de saisie', async () => {
    const written: string[] = [];
    const outcome = await replayPendingOccurrences(
      [row('a'), row('b'), row('c')],
      async (entry) => { written.push(entry.localId); return { id: `server-${entry.localId}` }; },
      { describeError },
    );

    expect(written).toEqual(['a', 'b', 'c']);
    expect(outcome.failed).toBeNull();
    expect(outcome.written).toBe(3);
    expect(outcome.rows.map((entry) => entry.savedId)).toEqual(['server-a', 'server-b', 'server-c']);
    expect(hasUnsavedOccurrences(outcome.rows)).toBe(false);
  });

  test('s’arrete a la premiere ligne en echec : la suivante ne double jamais celle qui manque', async () => {
    const written: string[] = [];
    const outcome = await replayPendingOccurrences(
      [row('a'), row('b'), row('c')],
      async (entry) => {
        if (entry.localId === 'b') throw new Error('refus serveur');
        written.push(entry.localId);
        return { id: `server-${entry.localId}` };
      },
      { describeError },
    );

    expect(written).toEqual(['a']);
    expect(outcome.failed?.localId).toBe('b');
    // Aucune ligne perdue : le tampon revient complet, dans le meme ordre.
    expect(outcome.rows.map((entry) => entry.localId)).toEqual(['a', 'b', 'c']);
    expect(outcome.rows[1].error).toBe('refus serveur');
    expect(unsavedOccurrences(outcome.rows).map((entry) => entry.localId)).toEqual(['b', 'c']);
  });

  test('une ligne deja ecrite n’est jamais renvoyee, quel que soit le nombre de reprises', async () => {
    const write = vi.fn(async (entry: PendingOccurrence) => ({ id: `server-${entry.localId}` }));
    const rows = [row('a', { savedId: 'server-a' }), row('b'), row('c', { savedId: 'server-c' })];

    const first = await replayPendingOccurrences(rows, write, { describeError });
    const second = await replayPendingOccurrences(first.rows, write, { describeError });

    expect(write.mock.calls.map(([entry]) => entry.localId)).toEqual(['b']);
    expect(second.written).toBe(0);
    expect(second.rows.map((entry) => entry.savedId)).toEqual(['server-a', 'server-b', 'server-c']);
  });

  test('la reprise ligne par ligne ne tente qu’une occurrence', async () => {
    const write = vi.fn(async (entry: PendingOccurrence) => ({ id: `server-${entry.localId}` }));
    const outcome = await replayPendingOccurrences([row('a'), row('b')], write, { limit: 1, describeError });

    expect(write.mock.calls.map(([entry]) => entry.localId)).toEqual(['a']);
    expect(outcome.rows[0].savedId).toBe('server-a');
    expect(outcome.rows[1].savedId).toBeNull();
    // Rien n'a echoue : la seconde ligne attend simplement son tour, sans message d'erreur.
    expect(outcome.failed).toBeNull();
    expect(outcome.rows[1].error).toBeNull();
  });

  test('une ligne reussie efface le message de son echec precedent', async () => {
    const outcome = await replayPendingOccurrences(
      [row('a', { error: 'refus serveur' })],
      async (entry) => ({ id: `server-${entry.localId}` }),
      { describeError },
    );

    expect(outcome.rows[0]).toMatchObject({ savedId: 'server-a', error: null });
  });

  test('une panne réseau garde la ligne à confirmer pour un rejeu avec la même clé', async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'server-a' });
    const first = await replayPendingOccurrences([row('a')], write, { describeError });
    expect(first.rows[0]).toMatchObject({ savedId: null, deliveryState: 'unknown' });

    const second = await replayPendingOccurrences(first.rows, write, { describeError });
    expect(write.mock.calls.map(([entry]) => `l69-occurrence:${entry.localId}`)).toEqual([
      'l69-occurrence:a', 'l69-occurrence:a',
    ]);
    expect(second.rows[0]).toMatchObject({ savedId: 'server-a', deliveryState: 'not_attempted' });
  });

  test.each([
    ['gateway 502', { status: 502, message: 'Bad Gateway' }],
    ['gateway 503', { status: 503, message: 'Service Unavailable' }],
    ['gateway 504', { status: 504, message: 'Gateway Timeout' }],
    ['request timeout', { status: 408, message: 'Request Timeout' }],
    ['Safari network failure', new TypeError('Load failed')],
  ])('%s garde le résultat incertain', async (_label, error) => {
    const outcome = await replayPendingOccurrences(
      [row('a')],
      async () => { throw error; },
      { describeError },
    );
    expect(outcome.failed).toMatchObject({ localId: 'a', savedId: null, deliveryState: 'unknown' });
  });
});
