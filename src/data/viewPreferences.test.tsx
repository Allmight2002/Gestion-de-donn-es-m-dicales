import { describe, expect, test, vi } from 'vitest';
import { makeViewPreferenceRepository } from './viewPreferences';

function fakeClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    upsert: vi.fn(async () => ({ error: null })),
  };
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } }, error: null })),
    },
    from: vi.fn(() => query),
  };
  return { client, query };
}

describe('viewPreferenceRepository', () => {
  test('distingue une absence de ligne d un choix vide et normalise les cles', async () => {
    const empty = fakeClient({ data: { visible_patient_field_keys: [] }, error: null });
    const repo = makeViewPreferenceRepository(empty.client as never);
    expect(await repo.getVisiblePatientFieldKeys('b1')).toEqual([]);

    const missing = fakeClient({ data: null, error: null });
    expect(await makeViewPreferenceRepository(missing.client as never).getVisiblePatientFieldKeys('b1')).toBeNull();

    await repo.saveVisiblePatientFieldKeys('b1', ['sexe', 'sexe', '']);
    expect(empty.query.upsert).toHaveBeenCalledWith(
      { base_id: 'b1', user_id: 'u1', visible_patient_field_keys: ['sexe'] },
      { onConflict: 'base_id,user_id' },
    );
  });

  test('propage une erreur de lecture serveur', async () => {
    const client = fakeClient({ data: null, error: new Error('transport') });
    await expect(makeViewPreferenceRepository(client.client as never).getVisiblePatientFieldKeys('b1'))
      .rejects.toThrow('transport');
  });
});
