import { describe, expect, test, vi } from 'vitest';
import { WorkDraftSession } from './workDraftSession';
import { WorkDraftError, type WorkDraftContext, type WorkDraftReceipt, type WorkDraftRepository } from './workDrafts';

const context: WorkDraftContext = { baseId: 'base', kind: 'patient_create', targetId: null, templateVersionId: 'v1', entityRevision: null };
const receipt = (revision: number): WorkDraftReceipt => ({ id: 'draft', revision, updatedAt: '2026-09-11T01:00:00Z', expiresAt: '2026-09-12T01:00:00Z' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function repository() {
  return { available: true, list: vi.fn(async () => []), save: vi.fn(async (...args: Parameters<WorkDraftRepository['save']>) => receipt(args[2] + 1)),
    discard: vi.fn(async () => undefined), commit: vi.fn(async () => ({ id: 'patient' })) } satisfies WorkDraftRepository;
}

describe('work draft session ordering and recovery', () => {
  test('a late acknowledgement does not certify newer keystrokes; they are sent at the next revision', async () => {
    const repo = repository();
    const first = deferred<WorkDraftReceipt>();
    repo.save.mockImplementationOnce(() => first.promise);
    const session = new WorkDraftSession(repo, context);
    const old = { values: { score: 1 } }; const next = { values: { score: 2 } };
    const sending = session.flush(old);
    const sendingNext = session.flush(next);
    expect(repo.save).toHaveBeenCalledTimes(1);
    first.resolve(receipt(1));
    await Promise.all([sending, sendingNext]);
    expect(repo.save.mock.calls.map((args) => [args[2], args[4]])).toEqual([[0, old], [1, next]]);
    expect(session.state.acknowledgedFingerprint).toBe(JSON.stringify(next));
  });

  test('an uncertain save retries its original operation and snapshot before sending changed input', async () => {
    const repo = repository(); repo.save.mockRejectedValueOnce(new WorkDraftError('DRAFT_UNAVAILABLE'));
    const session = new WorkDraftSession(repo, context);
    await expect(session.flush({ values: { score: 1 } })).rejects.toThrow();
    const firstCall = repo.save.mock.calls[0];
    await session.flush({ values: { score: 2 } });
    expect(repo.save.mock.calls[1]).toEqual(firstCall);
    expect(repo.save.mock.calls[2][2]).toBe(1);
    expect(repo.save.mock.calls[2][3]).not.toBe(firstCall[3]);
    expect(session.state.status).toBe('saved');
  });

  test('a conflicting second tab preserves the form snapshot and stops automatic writes', async () => {
    const repo = repository(); repo.save.mockRejectedValueOnce(new WorkDraftError('DRAFT_CONFLICT'));
    const session = new WorkDraftSession(repo, context); const input = { values: { score: 7 } };
    await expect(session.flush(input)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(session.flush(input)).rejects.toThrow();
    expect(input.values.score).toBe(7);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({ status: 'conflict', locked: false });
  });

  test('a lost commit response locks edits and a double click retries one stable business operation', async () => {
    const repo = repository(); repo.commit.mockRejectedValueOnce(new WorkDraftError('DRAFT_UNAVAILABLE'));
    const session = new WorkDraftSession(repo, context); const input = { values: { score: 3 } };
    await expect(session.commit(input)).rejects.toThrow();
    expect(session.state.locked).toBe(true);
    await expect(session.flush({ values: { score: 9 } })).rejects.toThrow();
    const firstCall = repo.commit.mock.calls[0];
    const pending = deferred<{ id: string }>(); repo.commit.mockImplementationOnce(() => pending.promise);
    const a = session.commit(input); const b = session.commit(input);
    expect(a).toBe(b);
    pending.resolve({ id: 'patient' }); await a;
    expect(repo.commit.mock.calls[1]).toEqual(firstCall);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({ status: 'consumed', locked: true });
    await expect(session.flush(input)).rejects.toThrow();
  });

  test('a definitive validation refusal unlocks the form and the corrected payload uses a fresh operation', async () => {
    const repo = repository(); repo.commit.mockRejectedValueOnce(new WorkDraftError('DRAFT_VALIDATION'));
    const session = new WorkDraftSession(repo, context);
    await expect(session.commit({ values: { score: 'invalid' } })).rejects.toThrow();
    expect(session.state.locked).toBe(false);
    await session.commit({ values: { score: 4 } });
    expect(repo.save.mock.calls[1][4]).toEqual({ values: { score: 4 } });
    expect(repo.commit.mock.calls[1]).not.toEqual(repo.commit.mock.calls[0]);
  });
});
