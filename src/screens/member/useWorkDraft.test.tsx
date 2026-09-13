import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { WorkDraft, WorkDraftContext, WorkDraftRepository } from '../../data/workDrafts';
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
});
