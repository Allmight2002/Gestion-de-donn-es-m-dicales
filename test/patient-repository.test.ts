import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test, vi } from 'vitest';
import { makePatientRepository } from '../src/data/patients';

describe('repository patient', () => {
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
