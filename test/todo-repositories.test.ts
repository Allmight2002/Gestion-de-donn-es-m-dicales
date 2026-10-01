// Audit UI mobile, lot 8 : lectures client de la page « A faire ». Elles n'appellent que leur
// RPC, ne transmettent aucun parametre forgeable et ne remontent jamais une erreur brute.
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test, vi } from 'vitest';
import { createWorkDraftRepository, WorkDraftError } from '../src/data/workDrafts';
import { makeBaseRepository } from '../src/data/bases';

describe('lot 8 : lectures de la page « A faire »', () => {
  test('listMine lit list_my_work_drafts sans parametre : le serveur choisit la personne', async () => {
    const summary = {
      id: 'd1', baseId: 'b1', kind: 'patient_update', targetId: 'p1', patientId: 'p1', patientCode: 'P-FICTIF',
      updatedAt: '2026-09-28T08:00:00Z', expiresAt: '2026-09-29T08:00:00Z',
    };
    const rpc = vi.fn(async () => ({ data: [summary], error: null }));
    const repository = createWorkDraftRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.listMine!()).resolves.toEqual([summary]);
    expect(rpc).toHaveBeenCalledWith('list_my_work_drafts', {});
  });

  test('listMine ne remonte jamais le message brut du serveur', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.list_my_work_drafts' } }));
    const repository = createWorkDraftRepository({ rpc } as unknown as SupabaseClient);

    const failure = await repository.listMine!().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkDraftError);
    expect((failure as Error).message).not.toMatch(/PGRST|function/i);
  });

  test('getTodoCounts lit my_todo_counts et ne garde que des nombres', async () => {
    const rpc = vi.fn(async () => ({ data: [{ baseId: 'b1', incomplete: '3', clarifications: null }], error: null }));
    const repository = makeBaseRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.getTodoCounts!()).resolves.toEqual([{ baseId: 'b1', incomplete: 3, clarifications: 0, pendingCodings: 0 }]);
    expect(rpc).toHaveBeenCalledWith('my_todo_counts');

    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } } as never);
    await expect(repository.getTodoCounts!()).rejects.toMatchObject({ code: '42501' });
  });

  test('listPendingCodings lit list_pending_codings et ne garde que les champs attendus', async () => {
    const row = {
      patientId: 'p1', patientCode: 'P-FICTIF', encounterId: null, encounterType: null, encounterDate: null,
      fieldKey: 'diag', fieldLabel: 'Diagnostic', position: null, raw: 'Texte fictif', proposedLabel: null,
      status: 'unmatched', updatedAt: '2026-09-28T08:00:00Z',
    };
    const rpc = vi.fn(async () => ({
      data: { items: [{ ...row, extra: 'ignore' }, { ...row, status: 'confirmed' }], hasMore: true }, error: null,
    }));
    const repository = makeBaseRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.listPendingCodings!('b1', 20)).resolves.toEqual({ items: [row], hasMore: true });
    expect(rpc).toHaveBeenCalledWith('list_pending_codings', { p_base_id: 'b1', p_limit: 20 });

    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Acces refuse' } } as never);
    await expect(repository.listPendingCodings!('b1')).rejects.toMatchObject({ code: '42501' });
  });
});
