import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { EXPORT_LIMITS, type GenerateExportDeps, handleGenerateExport } from './handler.ts';
import {
  type DbResult,
  errorResult,
  fakeSupabaseClient,
  type FromCall,
  makeRequest,
  okResult,
  readResponse,
  type Responder,
} from '../_shared/testing.ts';

const COHORT = '123e4567-e89b-42d3-a456-426614174000';
const BASE = '223e4567-e89b-42d3-a456-426614174000';
const TV = '323e4567-e89b-42d3-a456-426614174000';
const SERVICE_KEY = 'sb_secret_service_role_key_value';

const ENCOUNTER = {
  id: 'e1',
  patient_id: 'p1',
  template_version_id: TV,
  encounter_date: '2020-01-01',
  encounter_type: 'visit',
  age_value: 3,
  age_unit: 'y',
  // Trois cas metier : nombre negatif legitime, formule CSV dangereuse, valeur manquante codifiee.
  data: { sbp: -5, danger: '=SUM(A1)', miss: { __missing__: 'inconnu' } },
};
const FIELDS = [
  {
    id: 'f1',
    template_version_id: TV,
    field_key: 'sbp',
    label: 'SBP',
    scope: 'encounter',
    section: 'vitals',
    type: 'number',
    unit: 'mmHg',
    allowed_values: null,
    display_order: 1,
  },
  {
    id: 'f2',
    template_version_id: TV,
    field_key: 'danger',
    label: 'D',
    scope: 'encounter',
    section: 'x',
    type: 'text',
    unit: null,
    allowed_values: null,
    display_order: 2,
  },
  {
    id: 'f3',
    template_version_id: TV,
    field_key: 'miss',
    label: 'M',
    scope: 'encounter',
    section: 'x',
    type: 'text',
    unit: null,
    allowed_values: null,
    display_order: 3,
  },
];

interface Opts {
  user?: { data: { user: { id: string } | null }; error?: unknown };
  cohort?: unknown;
  canExport?: unknown;
  uploadError?: unknown;
  insertError?: unknown;
  throwBuild?: boolean;
  onStorage?: (method: string, args: unknown[]) => void;
  memberRows?: Array<{ patient_id: string }>;
  patientRows?: unknown[];
  encounterMemberRows?: Array<{ encounter_id: string }>;
  encounterRows?: unknown[];
  fromResponder?: (call: FromCall) => DbResult | undefined;
}

function queriedRows<T extends Record<string, unknown>>(
  call: FromCall,
  input: T[],
  orderKey: keyof T,
): DbResult {
  let rows = [...input];
  for (const op of call.ops.filter((candidate) => candidate.m === 'in')) {
    const [column, rawValues] = op.a as [string, unknown[]];
    const values = new Set(rawValues);
    rows = rows.filter((row) => values.has(row[column]));
  }
  rows.sort((left, right) => String(left[orderKey]).localeCompare(String(right[orderKey])));
  const total = rows.length;
  const range = call.ops.findLast((op) => op.m === 'range');
  if (range) {
    const [from, to] = range.a as [number, number];
    rows = rows.slice(from, to + 1);
  }
  return okResult(rows, total);
}

function deps(opts: Opts = {}): GenerateExportDeps {
  const cohort = 'cohort' in opts ? opts.cohort : { id: COHORT, base_id: BASE, cohort_type: 'snapshot' };
  const userResponder: Responder = (call) =>
    call.kind === 'rpc' && call.rpc === 'can_export_data' ? okResult(opts.canExport ?? true) : okResult(null);
  const adminResponder: Responder = (call) => {
    if (call.kind === 'storage') {
      opts.onStorage?.(call.method, call.args);
      if (call.method === 'upload') return opts.uploadError ? errorResult(opts.uploadError) : okResult({ path: 'p' });
      return okResult([{}]);
    }
    if (call.kind === 'from') {
      const override = opts.fromResponder?.(call);
      if (override) return override;
      switch (call.table) {
        case 'cohort':
          return okResult(cohort);
        case 'cohort_member':
          return queriedRows(call, opts.memberRows ?? [{ patient_id: 'p1' }], 'patient_id');
        case 'patient':
          return queriedRows(
            call,
            (opts.patientRows ?? [{ id: 'p1', patient_code: 'P001', template_version_id: TV, data: {} }]) as Array<
              Record<string, unknown>
            >,
            'id',
          );
        case 'cohort_encounter_member':
          return queriedRows(call, opts.encounterMemberRows ?? [{ encounter_id: 'e1' }], 'encounter_id');
        case 'encounter':
          return queriedRows(call, (opts.encounterRows ?? [ENCOUNTER]) as Array<Record<string, unknown>>, 'id');
        case 'template_field':
          return queriedRows(call, FIELDS, 'id');
        case 'export_log':
          return opts.insertError ? errorResult(opts.insertError) : okResult({
            id: 'exp1',
            format: 'csv',
            patient_count: 1,
            encounter_count: 1,
            stored_file_path: 'x',
            generation_mode: 'server',
          });
      }
    }
    return okResult(null);
  };
  const asUser = fakeSupabaseClient({
    role: 'user',
    user: opts.user ?? { data: { user: { id: 'u1' } } },
    responder: userResponder,
  });
  const admin = fakeSupabaseClient({ role: 'admin', responder: adminResponder });
  return {
    buildClients: () => {
      if (opts.throwBuild) throw new Error(`Configuration serveur manquante: ${SERVICE_KEY}`);
      return { asUser, admin };
    },
    newId: () => 'fixed-uuid',
    now: () => 1_700_000_000_000,
    nowIso: () => '2026-07-12T00:00:00.000Z',
  };
}

const body = (format: 'csv' | 'xlsx' = 'csv') => ({ cohortId: COHORT, format });

Deno.test('generate-export: auth absente -> 401', async () => {
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ auth: null, body: body() }), deps()));
  assertEquals(status, 401);
});

Deno.test('generate-export: config indisponible -> 500', async () => {
  const { status } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), deps({ throwBuild: true })),
  );
  assertEquals(status, 500);
});

Deno.test('generate-export: permission insuffisante -> 403', async () => {
  const { status, body: b } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), deps({ canExport: false })),
  );
  assertEquals(status, 403);
  assertEquals(b.error, 'Acces export refuse');
});

Deno.test('generate-export: cohorte inexistante -> 404', async () => {
  const { status } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), deps({ cohort: null })),
  );
  assertEquals(status, 404);
});

Deno.test('generate-export: cohorte non figee -> 409', async () => {
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: body() }),
      deps({ cohort: { id: COHORT, base_id: BASE, cohort_type: 'live' } }),
    ),
  );
  assertEquals(status, 409);
});

Deno.test('generate-export: patient historique hors perimetre ou masque -> export complet refuse', async () => {
  const { status, body: b, text } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: body() }),
      deps({ memberRows: [{ patient_id: 'p-other-base' }], patientRows: [] }),
    ),
  );
  assertEquals(status, 409);
  assertEquals(b.code, 'EXPORT_INCOMPLETE');
  assertEquals(b.resource, 'patients');
  assert(!text.includes('p-other-base'));
});

Deno.test('generate-export: rencontre historique absente ou hors base -> aucun sous-ensemble silencieux', async () => {
  const { status, body: b, text } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: body() }),
      deps({ encounterMemberRows: [{ encounter_id: 'e-other-base' }], encounterRows: [] }),
    ),
  );
  assertEquals(status, 409);
  assertEquals(b.code, 'EXPORT_INCOMPLETE');
  assertEquals(b.resource, 'encounters');
  assert(!text.includes('e-other-base'));
});

Deno.test('generate-export: rencontre valide sans cohort_member charge son parent dans la meme base', async () => {
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: { ...body(), options: { scope: 'matching' } } }),
      deps({
        memberRows: [],
        patientRows: [{ id: 'p2', patient_code: 'P002' }],
        encounterRows: [{ ...ENCOUNTER, patient_id: 'p2' }],
      }),
    ),
  );
  assertEquals(status, 200);
});

Deno.test('generate-export: plus de 1000 patients sont pagines sans doublon et les filtres sont segmentes', async () => {
  const patientRows = Array.from({ length: 1_205 }, (_, index) => ({
    id: `p${String(index).padStart(4, '0')}`,
    patient_code: `P${String(index).padStart(4, '0')}`,
    template_version_id: TV,
    data: {},
  }));
  const memberRows = patientRows.map((patient) => ({ patient_id: patient.id }));
  let memberPages = 0;
  let largestIn = 0;
  let uploaded: Blob | null = null;
  const d = deps({
    memberRows,
    patientRows,
    encounterMemberRows: [],
    fromResponder: (call) => {
      if (call.table === 'cohort_member' && call.ops.some((op) => op.m === 'range')) memberPages += 1;
      for (const op of call.ops.filter((candidate) => candidate.m === 'in')) {
        largestIn = Math.max(largestIn, (op.a[1] as unknown[]).length);
      }
      return undefined;
    },
    onStorage: (method, args) => {
      if (method === 'upload') uploaded = args[1] as Blob;
    },
  });

  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: { ...body(), options: { mode: 'patient', scope: 'matching' } } }),
      d,
    ),
  );
  assertEquals(status, 200);
  assert(memberPages >= 3);
  assert(largestIn <= 200);
  const uploadedBlob = uploaded as Blob | null;
  assert(uploadedBlob !== null);
  const lines = (await uploadedBlob.text()).split('\n');
  assertEquals(lines.length, patientRows.length + 1);
  assertEquals(new Set(lines.slice(1).map((line) => line.split(',')[0])).size, patientRows.length);
});

Deno.test('generate-export: plus de 1000 rencontres sont paginees exhaustivement', async () => {
  const encounterRows = Array.from({ length: 1_205 }, (_, index) => ({
    ...ENCOUNTER,
    id: `e${String(index).padStart(4, '0')}`,
  }));
  const encounterMemberRows = encounterRows.map((encounter) => ({ encounter_id: encounter.id }));
  let encounterMemberPages = 0;
  let largestIn = 0;
  const d = deps({
    encounterRows,
    encounterMemberRows,
    fromResponder: (call) => {
      if (call.table === 'cohort_encounter_member' && call.ops.some((op) => op.m === 'range')) {
        encounterMemberPages += 1;
      }
      for (const op of call.ops.filter((candidate) => candidate.m === 'in')) {
        largestIn = Math.max(largestIn, (op.a[1] as unknown[]).length);
      }
      return undefined;
    },
  });
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body() }), d));
  assertEquals(status, 200);
  assert(encounterMemberPages >= 3);
  assert(largestIn <= 200);
});

Deno.test('generate-export: erreur sur une page intermediaire -> export refuse', async () => {
  const members = Array.from({ length: 1_001 }, (_, index) => ({ patient_id: `p${index}` }));
  let uploads = 0;
  const d = deps({
    fromResponder: (call) => {
      if (call.table !== 'cohort_member') return undefined;
      const range = call.ops.findLast((op) => op.m === 'range');
      if (!range) return undefined;
      const [from, to] = range.a as [number, number];
      return from === 500
        ? errorResult({ message: 'page unavailable' })
        : okResult(members.slice(from, to + 1), members.length);
    },
    onStorage: (method) => {
      if (method === 'upload') uploads += 1;
    },
  });
  const { status, body: responseBody, text } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), d),
  );
  assertEquals(status, 500);
  assertEquals(responseBody.code, 'EXPORT_READ_FAILED');
  assertEquals(responseBody.resource, 'patients');
  assertEquals(uploads, 0);
  assert(!text.includes('page unavailable'));
});

Deno.test('generate-export: page tronquee malgre le compte exact -> export refuse', async () => {
  const members = Array.from({ length: 1_001 }, (_, index) => ({ patient_id: `p${index}` }));
  const d = deps({
    fromResponder: (call) => {
      if (call.table !== 'cohort_member') return undefined;
      const range = call.ops.findLast((op) => op.m === 'range');
      if (!range) return undefined;
      const [from, to] = range.a as [number, number];
      if (from >= 900) return okResult([], members.length);
      const rows = from === 500 ? members.slice(500, 900) : members.slice(from, to + 1);
      return okResult(rows, members.length);
    },
  });
  const { status, body: responseBody } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), d),
  );
  assertEquals(status, 409);
  assertEquals(responseBody.code, 'EXPORT_INCOMPLETE');
});

Deno.test('generate-export: doublon entre deux pages -> export refuse', async () => {
  const members = Array.from({ length: 1_000 }, (_, index) => ({ patient_id: `p${index}` }));
  const d = deps({
    fromResponder: (call) => {
      if (call.table !== 'cohort_member') return undefined;
      const range = call.ops.findLast((op) => op.m === 'range');
      if (!range) return undefined;
      const [from, to] = range.a as [number, number];
      if (from === 500) return okResult([members[499], ...members.slice(500, 999)], members.length);
      return okResult(members.slice(from, to + 1), members.length);
    },
  });
  const { status, body: responseBody } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), d),
  );
  assertEquals(status, 409);
  assertEquals(responseBody.code, 'EXPORT_INCOMPLETE');
});

Deno.test('generate-export: limite produit depassee -> 413 explicite avant chargement complet', async () => {
  const d = deps({
    fromResponder: (call) => {
      if (call.table !== 'cohort_member') return undefined;
      return okResult([{ patient_id: 'p0' }], EXPORT_LIMITS.patients + 1);
    },
  });
  const { status, body: responseBody } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), d),
  );
  assertEquals(status, 413);
  assertEquals(responseBody.code, 'EXPORT_LIMIT_EXCEEDED');
  assertEquals(responseBody.resource, 'patients');
  assertEquals(responseBody.limit, EXPORT_LIMITS.patients);
  assertEquals(responseBody.observed, EXPORT_LIMITS.patients + 1);
});

Deno.test('generate-export: les colonnes de code de terminologie comptent dans la limite CSV', async () => {
  const terminologyFields = Array.from({ length: 498 }, (_, index) => ({
    id: `terminology-${index.toString().padStart(3, '0')}`,
    template_version_id: TV,
    field_key: `diagnostic_${index}`,
    label: `Diagnostic ${index}`,
    scope: 'encounter' as const,
    section: 'clinique',
    type: 'terminology',
    unit: null,
    allowed_values: null,
    display_order: index,
  }));
  const d = deps({
    fromResponder: (call) => call.table === 'template_field' ? queriedRows(call, terminologyFields, 'id') : undefined,
  });
  const { status, body: responseBody } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body('csv') }), d),
  );
  assertEquals(status, 413);
  assertEquals(responseBody.code, 'EXPORT_LIMIT_EXCEEDED');
  assertEquals(responseBody.resource, 'columns');
  assertEquals(responseBody.limit, EXPORT_LIMITS.csvColumns);
  assertEquals(responseBody.observed, 6 + terminologyFields.length * 2);
});

Deno.test('generate-export: CSV genere respecte le contrat anti-formule/negatifs/manquants', async () => {
  let uploaded: Uint8Array | null = null;
  // On intercepte l'upload via un responder qui capture les octets reellement ecrits.
  const adminResponder: Responder = (call) => {
    if (call.kind === 'storage' && call.method === 'upload') {
      const blob = call.args[1] as Blob;
      return blob.arrayBuffer().then((buf) => {
        uploaded = new Uint8Array(buf);
        return okResult({ path: 'p' });
      });
    }
    if (call.kind === 'storage') return okResult([{}]);
    if (call.kind === 'from') {
      switch (call.table) {
        case 'cohort':
          return okResult({ id: COHORT, base_id: BASE, cohort_type: 'snapshot' });
        case 'cohort_member':
          return okResult([{ patient_id: 'p1' }]);
        case 'patient':
          return okResult([{ id: 'p1', patient_code: 'P001', template_version_id: TV, data: {} }]);
        case 'cohort_encounter_member':
          return okResult([{ encounter_id: 'e1' }]);
        case 'encounter':
          return okResult([ENCOUNTER]);
        case 'template_field':
          return okResult(FIELDS);
        case 'export_log':
          return okResult({ id: 'exp1', format: 'csv' });
      }
    }
    return okResult(null);
  };
  const admin = fakeSupabaseClient({ role: 'admin', responder: adminResponder });
  const asUser = fakeSupabaseClient({
    role: 'user',
    user: { data: { user: { id: 'u1' } } },
    responder: (c) => c.kind === 'rpc' ? okResult(true) : okResult(null),
  });
  const custom: GenerateExportDeps = {
    buildClients: () => ({ asUser, admin }),
    newId: () => 'fixed-uuid',
    now: () => 1_700_000_000_000,
    nowIso: () => '2026-07-12T00:00:00.000Z',
  };
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body('csv') }), custom));
  assertEquals(status, 200);
  assert(uploaded !== null);
  const csv = new TextDecoder().decode(uploaded!);
  assertStringIncludes(csv, 'inconnu'); // valeur manquante codifiee
  assertStringIncludes(csv, '-5'); // nombre negatif legitime preserve
  assertStringIncludes(csv, "'=SUM(A1)"); // formule CSV neutralisee par apostrophe
});

Deno.test('generate-export: XLSX -> 200', async () => {
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body('xlsx') }), deps()));
  assertEquals(status, 200);
});

Deno.test('generate-export: echec upload -> 500', async () => {
  const { status, body: b } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), deps({ uploadError: { message: 'storage down' } })),
  );
  assertEquals(status, 500);
  assertEquals(b.error, 'Ecriture de l export impossible');
});

Deno.test('generate-export: echec insert export_log -> rollback fichier + 500', async () => {
  const removed: string[] = [];
  const d = deps({
    insertError: { message: 'insert failed' },
    onStorage: (method, args) => {
      if (method === 'remove') removed.push(...(args[0] as string[]));
    },
  });
  const { status, body: b, text } = await readResponse(await handleGenerateExport(makeRequest({ body: body() }), d));
  assertEquals(status, 500);
  assertEquals(b.error, 'Journalisation de l export impossible');
  assertEquals(removed.length, 1); // le fichier uploade est bien supprime (rollback)
  assert(!text.includes('insert failed')); // aucun detail interne dans la reponse
});
