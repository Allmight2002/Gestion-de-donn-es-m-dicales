import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { WorkDraftError, type WorkDraft, type WorkDraftContext, type WorkDraftRepository } from '../../data/workDrafts';
import { useWorkDraft } from './useWorkDraft';

const context: WorkDraftContext = { baseId: 'base-a', kind: 'patient_create', targetId: null, templateVersionId: 'v1', entityRevision: null };
const draft: WorkDraft = { id: 'draft-a', context, revision: 1, state: 'active', payload: { code: 'P-FICTIF', values: { score: 8 } },
  updatedAt: '2026-09-13T10:00:00Z', expiresAt: '2026-09-20T10:00:00Z' };

describe('work draft entry context', () => {
  test('a deletion response from the previous base cannot reset the newly opened form', async () => {
    let acknowledge!: () => void;
    const other = { ...draft, id: 'draft-b', context: { ...context, baseId: 'base-b' } };
    const repository = { available: true,
      list: vi.fn(async (ctx: WorkDraftContext) => [ctx.baseId === 'base-a' ? draft : other]),
      discard: vi.fn(() => new Promise<void>((resolve) => { acknowledge = resolve; })),
      save: vi.fn(), commit: vi.fn(),
    } satisfies WorkDraftRepository;
    const reset = vi.fn(); const restore = vi.fn();
    const { result, rerender } = renderHook(({ baseId }) => useWorkDraft({ context: { ...context, baseId }, ownerId: 'owner',
      payload: { values: {} }, dirty: false, online: true, repository, onRestore: restore }), { initialProps: { baseId: 'base-a' } });
    await waitFor(() => expect(result.current.candidates[0]?.id).toBe('draft-a'));
    let deletion!: Promise<boolean>;
    act(() => { deletion = result.current.discardAllAndStartNew(reset); });
    expect(result.current.discarding).toBe(true);
    rerender({ baseId: 'base-b' });
    await waitFor(() => expect(result.current.candidates[0]?.id).toBe('draft-b'));
    await act(async () => { acknowledge(); await deletion; });
    expect(reset).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    expect(result.current.candidates[0]?.id).toBe('draft-b');
    expect(result.current.discarding).toBe(false);
    expect(repository.discard).toHaveBeenCalledOnce();
  });

  test('ignores a draft list arriving after the authenticated owner changes', async () => {
    let resolveOld!: (drafts: WorkDraft[]) => void;
    const repository = { available: true,
      list: vi.fn<WorkDraftRepository['list']>().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue([]),
      discard: vi.fn(), save: vi.fn(), commit: vi.fn(),
    } satisfies WorkDraftRepository;
    const { result, rerender } = renderHook(({ ownerId }) => useWorkDraft({ context, ownerId,
      payload: { values: {} }, dirty: false, online: true, repository, onRestore: vi.fn() }), { initialProps: { ownerId: 'first-owner' } });
    expect(result.current.loading).toBe(true);
    rerender({ ownerId: 'second-owner' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => resolveOld([draft]));
    expect(result.current.candidates).toEqual([]);
    expect(repository.discard).not.toHaveBeenCalled();
  });

  // Un enregistrement demande pendant la recherche de brouillons ne doit pas etre refuse : la
  // fiche, elle, n'a pas ete ecrite, et le refus se lisait comme une indisponibilite du seul
  // brouillon. Regression observee en e2e staging, ou le clic precede la reponse de la liste.
  test('honours a save clicked before the draft list answers', async () => {
    let resolveList!: (drafts: WorkDraft[]) => void;
    const repository = { available: true,
      list: vi.fn(() => new Promise<WorkDraft[]>((resolve) => { resolveList = resolve; })),
      save: vi.fn<WorkDraftRepository['save']>(async (_context, id, expectedRevision) => ({ id, revision: expectedRevision + 1,
        updatedAt: '2026-09-17T10:16:00Z', expiresAt: '2026-09-24T10:16:00Z' })),
      commit: vi.fn<WorkDraftRepository['commit']>(async () => ({ id: 'patient-a' })),
      discard: vi.fn(),
    } satisfies WorkDraftRepository;
    const { result } = renderHook(() => useWorkDraft({ context, ownerId: 'owner',
      payload: { values: { score: 8 }, reason: 'Passage complete' }, dirty: true, online: true, repository, onRestore: vi.fn() }));
    expect(result.current.loading).toBe(true);

    let receipt: { id: string } | undefined;
    await act(async () => {
      const saving = result.current.commit();
      resolveList([]);
      receipt = await saving;
    });
    expect(receipt).toEqual({ id: 'patient-a' });
    expect(repository.commit).toHaveBeenCalledOnce();
    expect(repository.save.mock.calls[0]?.[4]).toEqual({ values: { score: 8 }, reason: 'Passage complete' });
  });

  test('still refuses a save when the draft list fails, without touching the record', async () => {
    let rejectList!: (error: unknown) => void;
    const repository = { available: true,
      list: vi.fn(() => new Promise<WorkDraft[]>((_resolve, reject) => { rejectList = reject; })),
      save: vi.fn(), commit: vi.fn(), discard: vi.fn(),
    } satisfies WorkDraftRepository;
    const { result } = renderHook(() => useWorkDraft({ context, ownerId: 'owner',
      payload: { values: { score: 8 } }, dirty: true, online: true, repository, onRestore: vi.fn() }));

    await act(async () => {
      const saving = result.current.commit();
      rejectList(new WorkDraftError('DRAFT_UNAVAILABLE'));
      await expect(saving).rejects.toThrow(/brouillons serveur sont indisponibles/);
    });
    expect(repository.commit).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
