import { describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeTemplateRepository } from './templates';
import type { NewField } from './types';

const source: NewField = {
  fieldKey: 'diagnostic',
  label: 'Diagnostic',
  scope: 'encounter',
  section: 'clinique',
  type: 'select',
  required: true,
  encounterTypes: null,
  allowedValues: ['Paludisme'],
  minValue: null,
  maxValue: null,
  unit: null,
  allowMissingCodes: false,
};

const companion: NewField = {
  ...source,
  fieldKey: 'diagnostic_autre',
  label: 'Diagnostic — valeur proposée',
  type: 'text',
  required: false,
  allowedValues: null,
};

describe('TemplateRepository.addField', () => {
  test('insere le champ source et son compagnon dans une seule requete ordonnee', async () => {
    const lastQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    lastQuery.select = vi.fn(() => lastQuery);
    lastQuery.eq = vi.fn(() => lastQuery);
    lastQuery.order = vi.fn(() => lastQuery);
    lastQuery.limit = vi.fn(() => lastQuery);
    lastQuery.maybeSingle = vi.fn(async () => ({ data: { display_order: 4 }, error: null }));

    let insertedPayload: Array<Record<string, unknown>> = [];
    const insertQuery = {
      insert: vi.fn((payload: Array<Record<string, unknown>>) => {
        insertedPayload = payload;
        return {
          select: vi.fn(async () => ({
            data: payload.map((row, index) => ({
              id: `field-${index}`,
              field_key: row.field_key,
              label: row.label,
              scope: row.scope,
              section: row.section,
              type: row.type,
              unit: row.unit,
              allowed_values: row.allowed_values,
              required: row.required,
              min_value: row.min_value,
              max_value: row.max_value,
              allow_missing_codes: row.allow_missing_codes,
              display_order: row.display_order,
              encounter_types: row.encounter_types,
            })),
            error: null,
          })),
        };
      }),
    };
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(lastQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    const created = await makeTemplateRepository(client).addField('version-1', source, companion);

    expect(insertQuery.insert).toHaveBeenCalledOnce();
    expect(insertedPayload).toHaveLength(2);
    expect(insertedPayload.map((row) => [row.field_key, row.display_order])).toEqual([
      ['diagnostic', 5],
      ['diagnostic_autre', 6],
    ]);
    expect(created.fieldKey).toBe('diagnostic');
  });
});
