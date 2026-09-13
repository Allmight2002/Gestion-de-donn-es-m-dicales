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

// ---------------------------------------------------------------------------
// L55 — un serveur ANTERIEUR a la migration ne connait pas
// `template_version.diagnosis_configuration`. Un gabarit historique doit rester
// consultable : la lecture se replie, et l'absence de colonne se distingue d'une
// configuration vide pour que l'ecran ne propose pas ce que le serveur refuserait.
// ---------------------------------------------------------------------------
type QueryResult = { data: unknown; error: unknown };

/** Requete Supabase minimale : chainable ET thenable, comme le vrai constructeur. */
function fakeQuery(result: QueryResult) {
  const query: Record<string, unknown> = {};
  const same = () => query;
  query.select = vi.fn(same);
  query.eq = vi.fn(same);
  query.order = vi.fn(same);
  query.single = vi.fn(async () => result);
  query.then = (ok: (v: QueryResult) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, ko);
  return query;
}

function makeVersionClient(onVersionSelect: (columns: string) => QueryResult) {
  const selectedColumns: string[] = [];
  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'template_version') return fakeQuery({ data: [], error: null });
      return {
        select: vi.fn((columns: string) => {
          selectedColumns.push(columns);
          return fakeQuery(onVersionSelect(columns));
        }),
      };
    }),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  } as unknown as SupabaseClient;
  return { client, selectedColumns };
}

describe('TemplateRepository.getVersion — compatibilite serveur anterieur a L55', () => {
  const row = { id: 'v1', template_id: 't1', version_number: 1, status: 'draft' as const };
  const missingColumn = {
    code: '42703',
    message: 'column template_version.diagnosis_configuration does not exist',
  };

  test('colonne absente : le gabarit se charge, et l ecran sait que le serveur l ignore', async () => {
    const { client, selectedColumns } = makeVersionClient((columns) =>
      (columns.includes('diagnosis_configuration')
        ? { data: null, error: missingColumn }
        : { data: row, error: null }));

    const result = await makeTemplateRepository(client).getVersion('v1');

    expect(result.version.id).toBe('v1');
    expect(result.version.versionNumber).toBe(1);
    // `undefined`, et surtout PAS `[]` : l'editeur doit pouvoir se retirer.
    expect(result.version.diagnosisConfiguration).toBeUndefined();
    expect(result.version.diagnosisContext).toBeUndefined();
    // Exactement une relecture, sans la colonne inconnue.
    expect(selectedColumns).toHaveLength(2);
    expect(selectedColumns[1]).not.toContain('diagnosis_configuration');
  });

  test('serveur L55 sans configuration : tableau vide, aucune seconde lecture', async () => {
    const { client, selectedColumns } = makeVersionClient(() =>
      ({ data: { ...row, diagnosis_configuration: [] }, error: null }));

    const result = await makeTemplateRepository(client).getVersion('v1');

    expect(result.version.diagnosisConfiguration).toEqual([]);
    expect(selectedColumns).toHaveLength(1);
  });

  test('une AUTRE erreur ne declenche jamais le repli : elle remonte telle quelle', async () => {
    for (const error of [
      { code: '42501', message: 'permission denied for table template_version' },
      // Meme code, autre colonne : ce n'est pas l'absence que l'on tolere.
      { code: '42703', message: 'column template_version.autre_colonne does not exist' },
      { code: 'PGRST301', message: 'JWT expired' },
    ]) {
      const { client, selectedColumns } = makeVersionClient(() => ({ data: null, error }));
      await expect(makeTemplateRepository(client).getVersion('v1'))
        .rejects.toMatchObject({ code: error.code });
      expect(selectedColumns).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// L59 — l'import d'un bloc est une ECRITURE de gabarit comme une autre : il ajoute une
// section, des variables et des regles a la version cible. Le cache de session doit donc
// tomber, sinon l'editeur reafficherait la version d'avant l'import et le bloc paraitrait
// perdu. Verifie, pas suppose.
// ---------------------------------------------------------------------------

describe('TemplateRepository.importSection — cache de version', () => {
  const row = { id: 'v1', template_id: 't1', version_number: 1, status: 'draft' as const };
  const report = {
    sectionKey: 'tuberculose', subsections: [], importedFields: ['bk'], reusedFields: [],
    copiedRules: 0, activationRule: null, conflicts: [],
  };

  function makeClient() {
    const versionReads: string[] = [];
    const rpcCalls: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'template_version') return fakeQuery({ data: [], error: null });
        return {
          select: vi.fn((columns: string) => {
            versionReads.push(columns);
            return fakeQuery({ data: row, error: null });
          }),
        };
      }),
      rpc: vi.fn(async (name: string) => {
        rpcCalls.push(name);
        return { data: name === 'import_template_section' ? report : [], error: null };
      }),
    } as unknown as SupabaseClient;
    return { client, versionReads, rpcCalls };
  }

  test('vide le cache apres un import, comme toute autre ecriture de gabarit', async () => {
    const { client, versionReads, rpcCalls } = makeClient();
    const repo = makeTemplateRepository(client);

    await repo.getVersion('v1');
    await repo.getVersion('v1');
    // La seconde lecture est servie par le cache : c'est bien lui que l'import doit vider.
    expect(versionReads).toHaveLength(1);

    await repo.importSection!('source', 'tuberculose', 'v1');
    expect(rpcCalls).toContain('import_template_section');

    await repo.getVersion('v1');
    expect(versionReads).toHaveLength(2);
  });

  test('la previsualisation ne vide rien : elle n ecrit pas', async () => {
    const { client, versionReads } = makeClient();
    const repo = makeTemplateRepository(client);

    await repo.getVersion('v1');
    await repo.previewSectionImport!('source', 'tuberculose', 'v1');
    await repo.getVersion('v1');

    expect(versionReads).toHaveLength(1);
  });
});

describe('TemplateRepository.getFields — lecture allegee, jamais tronquee', () => {
  // L59 a introduit cette lecture pour eviter de charger la version entiere. Elle omettait
  // `is_multiple`, que `mapField` lit : toute variable multivaluee revenait unitaire. L60 s'en
  // sert pour comparer le pilote de la source a celui de la cible, et refusait donc a tort.
  test('rend `isMultiple` : une lecture allegee ne doit pas changer la valeur lue', async () => {
    const columns: string[] = [];
    const client = {
      from: vi.fn((table: string) => ({
        select: vi.fn((cols: string) => {
          columns.push(`${table}:${cols}`);
          return fakeQuery({
            data: table === 'template_field'
              ? [{
                id: 'f1', field_key: 'diagnostics', label: 'Diagnostics', description: null,
                default_value: null, scope: 'encounter', section: null, type: 'terminology',
                is_multiple: true, unit: null, allowed_values: null, allowed_options: null,
                required: false, min_value: null, max_value: null, allow_missing_codes: false,
                missing_reasons: null, formula: null, display_order: 0, encounter_types: null,
              }]
              : [],
            error: null,
          });
        }),
      })),
    } as unknown as SupabaseClient;

    const fields = await makeTemplateRepository(client).getFields!('v1');

    expect(columns.some((entry) => entry.startsWith('template_field:') && entry.includes('is_multiple'))).toBe(true);
    expect(fields[0].isMultiple).toBe(true);
  });
});

describe('TemplateRepository.setCommonLayout — UX-16', () => {
  test('transmet l operation complete et renvoie seulement le recu serveur', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'set_common_layout' ? {
        fingerprint: 'after', locked: false, inUse: false, defaultKey: 'contexte',
        sections: [{ key: 'clinique', label: 'Clinique' }],
        groups: [{ key: 'contexte', label: 'Contexte', anchor: 0, isDefault: true, fields: ['motif'] }],
        unassigned: [],
      } : null,
      error: null,
    }));
    const repo = makeTemplateRepository({ rpc } as unknown as SupabaseClient);
    const receipt = await repo.setCommonLayout!('v1', 'operation-1', {
      defaultKey: 'contexte', groups: [{ key: 'contexte', label: 'Contexte', anchor: 0, fields: ['motif'] }],
    }, 'before');

    expect(rpc).toHaveBeenCalledWith('set_common_layout', {
      p_version_id: 'v1', p_operation_id: 'operation-1', p_expected_fingerprint: 'before',
      p_payload: { defaultKey: 'contexte', groups: [{ key: 'contexte', label: 'Contexte', anchor: 0, fields: ['motif'] }] },
    });
    expect(receipt).toMatchObject({ fingerprint: 'after', defaultKey: 'contexte', unassigned: [] });
  });
});
