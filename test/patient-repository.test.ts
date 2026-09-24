import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test, vi } from 'vitest';
import { isPatientSortableField, makePatientRepository, PatientSortUnavailableError } from '../src/data/patients';

describe('repository patient', () => {
  test('ne retente pas une lecture refusee par RLS', async () => {
    class DeniedPatientListQuery {
      eq(_column: string, _value: unknown) { return this; }
      is(_column: string, _value: unknown) { return this; }
      order(_column: string, _options: unknown) { return this; }
      async range(_from: number, _to: number) {
        return { data: null, count: null, error: { code: '42501', message: 'permission denied' } };
      }
    }

    const select = vi.fn(() => new DeniedPatientListQuery());
    const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;

    await expect(makePatientRepository(client).listPatientsPage('base-interdite', 20, 0))
      .rejects.toMatchObject({ code: '42501' });
    expect(select).toHaveBeenCalledTimes(1);
  });

  test('retente la liste sans row_version uniquement si la colonne manque', async () => {
    const patientRow = {
      id: '00000000-0000-0000-0000-000000000001',
      patient_code: 'PAT-FICTIF',
      template_version_id: '00000000-0000-0000-0000-000000000002',
      data: { statut: 'test' },
      validation_status: 'draft',
      updated_at: '2026-07-13T00:00:00.000Z',
    };

    class PatientListQuery {
      constructor(private readonly columns: string) {}
      eq(_column: string, _value: unknown) { return this; }
      is(_column: string, _value: unknown) { return this; }
      order(_column: string, _options: unknown) { return this; }
      async range(_from: number, _to: number) {
        if (this.columns.includes('row_version')) {
          return {
            data: null,
            count: null,
            error: { code: '42703', message: 'column patient.row_version does not exist' },
          };
        }
        return { data: [patientRow], count: 1, error: null };
      }
    }

    const select = vi.fn((columns: string) => new PatientListQuery(columns));
    const client = {
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient;

    const page = await makePatientRepository(client).listPatientsPage(
      '00000000-0000-0000-0000-000000000003',
      20,
      0,
    );

    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0][0]).toContain('row_version');
    expect(select.mock.calls[1][0]).not.toContain('row_version');
    expect(page).toEqual({
      rows: [expect.objectContaining({ id: patientRow.id, code: 'PAT-FICTIF', version: null })],
      total: 1,
    });
  });

  test('getPatient conserve la version optimiste chargee avec la fiche', async () => {
    const patientRow = {
      id: '00000000-0000-0000-0000-000000000001',
      patient_code: 'PAT-FICTIF',
      template_version_id: '00000000-0000-0000-0000-000000000002',
      data: { statut: 'test' },
      validation_status: 'draft',
      row_version: 7,
      updated_at: '2026-07-13T00:00:00.000Z',
    };

    class PatientQuery {
      select(_columns: string) { return this; }
      eq(_column: string, _value: unknown) { return this; }
      is(_column: string, _value: unknown) { return this; }
      async maybeSingle() { return { data: patientRow, error: null }; }
    }

    const client = {
      from: vi.fn(() => new PatientQuery()),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as SupabaseClient;

    const patient = await makePatientRepository(client).getPatient(
      '00000000-0000-0000-0000-000000000003',
      patientRow.id,
    );

    expect(patient).toMatchObject({
      id: patientRow.id,
      code: 'PAT-FICTIF',
      version: 7,
      updatedAt: '2026-07-13T00:00:00.000Z',
      identity: null,
    });
  });
});

describe('repository patient — L62 tri par variable', () => {
  const row = {
    id: '00000000-0000-0000-0000-000000000001',
    patient_code: 'PAT-FICTIF',
    template_version_id: '00000000-0000-0000-0000-000000000002',
    data: { score: 5 },
    validation_status: 'draft',
    row_version: 3,
    updated_at: '2026-09-24T00:00:00.000Z',
  };

  test('delegue filtre, ordre, total et page a la RPC, avec la seule cle', async () => {
    const rpc = vi.fn(async () => ({ data: { total: '41', rows: [row] }, error: null }));
    const from = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient;

    const page = await makePatientRepository(client).listPatientsPage('base-1', 20, 40, {
      codeQuery: '  NCH ', ids: ['p-1', 'p-2'], sort: { variable: 'score', direction: 'desc' },
    });

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('list_patients_by_field', {
      p_base_id: 'base-1', p_field_key: 'score', p_direction: 'desc', p_limit: 20, p_offset: 40,
      p_code_query: 'NCH', p_ids: ['p-1', 'p-2'],
    });
    expect(page).toEqual({
      total: 41,
      rows: [expect.objectContaining({ id: row.id, code: 'PAT-FICTIF', version: 3, identity: null })],
    });
  });

  test('un refus serveur ou une RPC absente deviennent une erreur typee, sans la cle', async () => {
    for (const error of [
      { code: 'P0001', message: 'PATIENT_SORT_UNAVAILABLE : tri indisponible', details: '{"code":"PATIENT_SORT_UNAVAILABLE"}' },
      { code: 'PGRST202', message: 'Could not find the function public.list_patients_by_field' },
    ]) {
      const client = { rpc: vi.fn(async () => ({ data: null, error })) } as unknown as SupabaseClient;
      const failure = makePatientRepository(client).listPatientsPage('base-1', 20, 0, {
        sort: { variable: 'cle_forgee', direction: 'asc' },
      });
      await expect(failure).rejects.toBeInstanceOf(PatientSortUnavailableError);
      await expect(failure).rejects.not.toThrow(/cle_forgee/);
    }
  });

  test('une autre erreur (droits, reseau, requete invalide) remonte telle quelle', async () => {
    for (const error of [
      { code: '42501', message: 'permission denied' },
      { code: 'P0001', message: 'PATIENT_SORT_INVALID_REQUEST : requete de tri invalide' },
    ]) {
      const client = { rpc: vi.fn(async () => ({ data: null, error })) } as unknown as SupabaseClient;
      await expect(makePatientRepository(client).listPatientsPage('base-1', 20, 0, {
        sort: { variable: 'score', direction: 'asc' },
      })).rejects.toBe(error);
    }
  });

  test('les tris techniques gardent la lecture existante : champ puis id, sans RPC', async () => {
    const orders: Array<[string, unknown]> = [];
    class PatientListQuery {
      eq() { return this; }
      is() { return this; }
      ilike() { return this; }
      order(column: string, options: unknown) { orders.push([column, options]); return this; }
      async range() { return { data: [row], count: 1, error: null }; }
    }
    const rpc = vi.fn();
    const client = { rpc, from: vi.fn(() => ({ select: () => new PatientListQuery() })) } as unknown as SupabaseClient;

    await makePatientRepository(client).listPatientsPage('base-1', 20, 0, {
      sort: { field: 'patient_code', direction: 'desc' },
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(orders).toEqual([['patient_code', { ascending: false }], ['id', { ascending: true }]]);
  });

  test('seules les variables patient a ordre defini sont proposables', () => {
    const sortable = (type: string, scope = 'patient', isMultiple = false) =>
      isPatientSortableField({ type, scope, isMultiple } as Parameters<typeof isPatientSortableField>[0]);
    expect(['number', 'integer', 'date', 'boolean', 'select', 'text'].map((type) => sortable(type)))
      .toEqual([true, true, true, true, true, true]);
    expect(['multiselect', 'terminology', 'datetime'].map((type) => sortable(type)))
      .toEqual([false, false, false]);
    expect(sortable('number', 'encounter')).toBe(false);
    expect(sortable('terminology', 'patient', true)).toBe(false);
  });
});
