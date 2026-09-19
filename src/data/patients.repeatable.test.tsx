import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test, vi } from 'vitest';
import { makePatientRepository } from './patients';

describe('PatientRepository — occurrences de groupes répétables', () => {
  test('transmet le groupe et la date nulle à create_encounter', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: 'occ-1' }], error: null }));
    const repository = makePatientRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.createEncounter('patient-1', {
      encounterType: 'autre',
      encounterDate: null,
      validationStatus: 'draft',
      ageUnit: 'years',
      data: { niveau: 'C5' },
      groupSectionKey: 'lesions',
    })).resolves.toEqual({ id: 'occ-1' });

    expect(rpc).toHaveBeenCalledWith('create_encounter', {
      p_patient_id: 'patient-1',
      p_encounter_type: 'autre',
      p_encounter_date: null,
      p_validation_status: 'draft',
      p_data: { niveau: 'C5' },
      p_age_unit: 'years',
      p_group_section_key: 'lesions',
    });
  });

  test('transmet le jeton updated_at attendu pour la correction optimiste', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: 'occ-1' }], error: null }));
    const repository = makePatientRepository({ rpc } as unknown as SupabaseClient);
    const expectedUpdatedAt = '2026-09-18T10:00:00.000Z';

    await expect(repository.updateEncounter(
      'occ-1', { niveau: 'T3' }, 'complete', 'Correction contrôlée', expectedUpdatedAt,
    )).resolves.toEqual({ id: 'occ-1' });

    expect(rpc).toHaveBeenCalledWith('update_encounter', {
      p_encounter_id: 'occ-1',
      p_data: { niveau: 'T3' },
      p_validation_status: 'complete',
      p_reason: 'Correction contrôlée',
      p_expected_updated_at: expectedUpdatedAt,
    });
  });

  test('mappe les dates et groupes nuls et demande un ordre stable de la liste', async () => {
    const response = {
      data: [
        {
          id: 'ordinary-undated', encounter_type: 'suivi', encounter_date: null, validation_status: 'draft',
          age_value: null, age_unit: null, data: { note: 'sans date' }, updated_at: null,
          template_version_id: null, group_section_key: null,
        },
        {
          id: 'group-undated', encounter_type: 'autre', encounter_date: null, validation_status: 'complete',
          age_value: null, age_unit: 'years', data: { niveau: 'C5' }, updated_at: '2026-09-18T10:00:00.000Z',
          template_version_id: 'version-1', group_section_key: 'lesions',
        },
      ],
      error: null,
    };
    const query: Record<string, unknown> = {};
    const order = vi.fn((_column: string, _options: { ascending: boolean }) => query);
    query.select = vi.fn((_columns: string) => query);
    query.eq = vi.fn((_column: string, _value: unknown) => query);
    query.is = vi.fn((_column: string, _value: unknown) => query);
    query.order = order;
    query.then = (
      fulfilled: (value: typeof response) => unknown,
      rejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(fulfilled, rejected);
    const from = vi.fn((_table: string) => query);
    const repository = makePatientRepository({ from } as unknown as SupabaseClient);

    const encounters = await repository.listEncounters('patient-1');

    expect(from).toHaveBeenCalledWith('encounter');
    expect(order.mock.calls).toEqual([
      ['encounter_date', { ascending: true }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(encounters.map((encounter) => ({
      id: encounter.id,
      encounterDate: encounter.encounterDate,
      groupSectionKey: encounter.groupSectionKey,
    }))).toEqual([
      { id: 'ordinary-undated', encounterDate: null, groupSectionKey: null },
      { id: 'group-undated', encounterDate: null, groupSectionKey: 'lesions' },
    ]);
  });
});
