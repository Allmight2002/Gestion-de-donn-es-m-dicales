import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test, vi } from 'vitest';
import { makePatientRepository } from '../src/data/patients';

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
