import { assert, assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import * as XLSX from 'xlsx';
import {
  assertExportShapeWithinLimits,
  buildExportFilename,
  EXPORT_LIMITS,
  exportFilenameSegment,
  type GenerateExportDeps,
  handleGenerateExport,
} from './handler.ts';
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
    description: 'Mesure assise apres cinq minutes de repos',
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

// L31 : les sections de la version. Le dictionnaire les nomme ; sans elles, la lecture
// echoue franchement plutot que de produire un dictionnaire aux sections anonymes.
const SECTIONS = [
  { id: 's1', template_version_id: TV, section_key: 'vitals', label: 'Constantes', display_order: 0 },
  { id: 's2', template_version_id: TV, section_key: 'x', label: 'Divers', display_order: 1 },
];

interface Opts {
  user?: { data: { user: { id: string } | null }; error?: unknown };
  cohort?: unknown;
  base?: unknown;
  canExport?: unknown;
  uploadError?: unknown;
  insertError?: unknown;
  throwBuild?: boolean;
  onStorage?: (method: string, args: unknown[]) => void;
  memberRows?: Array<{ patient_id: string }>;
  patientRows?: unknown[];
  encounterMemberRows?: Array<{ encounter_id: string }>;
  encounterRows?: unknown[];
  incompleteRecords?: Array<{ record_kind: string; record_id: string }>;
  incompleteError?: unknown;
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
  const cohort = 'cohort' in opts
    ? opts.cohort
    : { id: COHORT, base_id: BASE, name: 'Traumatismes craniens', cohort_type: 'snapshot' };
  const base = 'base' in opts ? opts.base : { name: 'Urgences pediatriques' };
  const userResponder: Responder = (call) =>
    call.kind === 'rpc' && call.rpc === 'can_export_data' ? okResult(opts.canExport ?? true) : okResult(null);
  const adminResponder: Responder = (call) => {
    // Filtre de completude : par defaut aucune fiche ecartee.
    if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') {
      return opts.incompleteError ? errorResult(opts.incompleteError) : okResult(opts.incompleteRecords ?? []);
    }
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
        case 'base':
          return okResult(base);
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
        case 'template_section':
          return queriedRows(call, SECTIONS, 'id');
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

Deno.test('nom export : base, cohorte, mode, profil, horodatage et format sont lisibles', () => {
  assertEquals(
    buildExportFilename(
      'Urgences pediatriques',
      'Traumatismes craniens',
      'encounter',
      'analysis',
      '2026-07-28T06:15:09.123Z',
      'xlsx',
    ),
    'meddata_urgences-pediatriques_traumatismes-craniens_rencontres_analyse_2026-07-28_06-15-09Z.xlsx',
  );
  assertEquals(
    buildExportFilename(
      'Base',
      'Cohorte',
      'patient',
      'complete',
      '2026-07-28T06:15:09.123Z',
      'csv',
    ),
    'meddata_base_cohorte_patients_complet_2026-07-28_06-15-09Z.csv',
  );
});

Deno.test('nom export : accents, separateurs et contenu hostile sont neutralises', () => {
  assertEquals(exportFilenameSegment('  Etude / Cœur : ete 2026  ', 'base'), 'etude-coeur-ete-2026');
  assertEquals(exportFilenameSegment('../..\\CON?.xlsx', 'cohorte'), 'con-xlsx');
  assertEquals(exportFilenameSegment('***', 'cohorte'), 'cohorte');
});

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

Deno.test('generate-export: le chemin conserve un identifiant unique et expose un nom lisible', async () => {
  let uploadedPath = '';
  let downloadFilename = '';
  const { status, body: responseBody } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: { ...body('csv'), options: { mode: 'patient' } } }),
      deps({
        cohort: {
          id: COHORT,
          base_id: BASE,
          name: 'Diabete / suivi annuel',
          cohort_type: 'snapshot',
        },
        base: { name: 'Hopital Central de Yaounde' },
        onStorage: (method, args) => {
          if (method === 'upload') uploadedPath = args[0] as string;
        },
        fromResponder: (call) => {
          if (call.table !== 'export_log') return undefined;
          const insert = call.ops.find((operation) => operation.m === 'insert');
          const row = insert?.a[0] as { export_options?: { download_filename?: string } } | undefined;
          downloadFilename = row?.export_options?.download_filename ?? '';
          return undefined;
        },
      }),
    ),
  );
  assertEquals(status, 200);
  assertEquals(
    uploadedPath,
    `${BASE}/${COHORT}/1700000000000-fixed-uuid.csv`,
  );
  assertEquals(
    downloadFilename,
    'meddata_hopital-central-de-yaounde_diabete-suivi-annuel_patients_analyse_2026-07-12_00-00-00Z.csv',
  );
  assertEquals(responseBody.stored_file_path, 'x');
});

Deno.test('generate-export: profil par defaut = analyse, journalise et identifiable dans le nom (L45)', async () => {
  let logged: Record<string, unknown> | undefined;
  const d = deps({
    fromResponder: (call) => {
      if (call.table !== 'export_log') return undefined;
      logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
      return undefined;
    },
  });
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body() }), d));
  assertEquals(status, 200);
  const options = (logged?.export_options ?? {}) as { profile?: unknown; download_filename?: unknown };
  // Un appel sans profil (compatibilite ancienne) est bien un export Analyse.
  assertEquals(options.profile, 'analysis');
  assertStringIncludes(String(options.download_filename), '_analyse_');
});

Deno.test('generate-export: profil explicite complete conserve la structure et le journal (L45)', async () => {
  let logged: Record<string, unknown> | undefined;
  const d = deps({
    fromResponder: (call) => {
      if (call.table !== 'export_log') return undefined;
      logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
      return undefined;
    },
  });
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: { ...body('csv'), options: { profile: 'complete' } } }),
      d,
    ),
  );
  assertEquals(status, 200);
  const options = (logged?.export_options ?? {}) as { profile?: unknown; download_filename?: unknown };
  assertEquals(options.profile, 'complete');
  assertStringIncludes(String(options.download_filename), '_complet_');
});

Deno.test('generate-export: profil inconnu -> 400 (refus explicite, aucun export possible)', async () => {
  const { status, body: b } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: { ...body('csv'), options: { profile: 'cible' } } }),
      deps(),
    ),
  );
  assertEquals(status, 400);
  assertEquals(b.error, 'options invalides');
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

Deno.test('generate-export: les cellules des feuilles multivaluees depassent proprement le plafond', () => {
  const longSheetCells = (Math.ceil(EXPORT_LIMITS.cells / 5) + 1) * 5;
  assertThrows(
    () => assertExportShapeWithinLimits(1, 1, 'xlsx', longSheetCells),
    Error,
  );
});

Deno.test('generate-export: CSV genere respecte le contrat anti-formule/negatifs/manquants', async () => {
  let uploaded: Uint8Array | null = null;
  // On intercepte l'upload via un responder qui capture les octets reellement ecrits.
  const adminResponder: Responder = (call) => {
    if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') return okResult([]);
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
          return okResult({ id: COHORT, base_id: BASE, name: 'Cohorte de test', cohort_type: 'snapshot' });
        case 'base':
          return okResult({ name: 'Base de test' });
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
        case 'template_section':
          return okResult(SECTIONS);
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

Deno.test('generate-export: XLSX -> 200 avec feuilles multivaluees et types natifs', async () => {
  let uploadedBytes: Uint8Array | null = null;
  const multiField = {
    id: 'f_diag',
    template_version_id: TV,
    field_key: 'diagnostics',
    label: 'Diagnostics',
    scope: 'encounter',
    section: 'vitals',
    type: 'terminology',
    is_multiple: true,
    unit: null,
    allowed_values: null,
    display_order: 4,
  };
  const optionMultiField = {
    id: 'f_signes',
    template_version_id: TV,
    field_key: 'signes',
    label: 'Signes',
    scope: 'encounter',
    section: 'vitals',
    type: 'multiselect',
    unit: null,
    allowed_values: ['fievre'],
    allowed_options: [{ value_key: 'fievre', label: 'Fièvre', is_active: true }],
    display_order: 5,
  };
  const encWithMulti = {
    ...ENCOUNTER,
    data: {
      ...ENCOUNTER.data,
      diagnostics: [
        { code: '1A00', label: 'Cholera' },
        { code: 'BA00', label: 'Hypertension' },
      ],
      signes: ['code_historique_inconnu', 'fievre'],
    },
  };

  const adminResponder: Responder = (call) => {
    if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') return okResult([]);
    if (call.kind === 'storage' && call.method === 'upload') {
      const blob = call.args[1] as Blob;
      return blob.arrayBuffer().then((buf) => {
        uploadedBytes = new Uint8Array(buf);
        return okResult({ path: 'p' });
      });
    }
    if (call.kind === 'storage') return okResult([{}]);
    if (call.kind === 'from') {
      switch (call.table) {
        case 'cohort':
          return okResult({ id: COHORT, base_id: BASE, name: 'Cohorte Test', cohort_type: 'snapshot' });
        case 'base':
          return okResult({ name: 'Base Test' });
        case 'cohort_member':
          return okResult([{ patient_id: 'p1' }]);
        case 'patient':
          return okResult([{ id: 'p1', patient_code: 'P0001', template_version_id: TV, data: {} }]);
        case 'cohort_encounter_member':
          return okResult([{ encounter_id: 'e1' }]);
        case 'encounter':
          return okResult([encWithMulti]);
        case 'template_field':
          return okResult([...FIELDS, multiField, optionMultiField]);
        case 'template_section':
          return okResult(SECTIONS);
        case 'export_log':
          return okResult({ id: 'exp1', format: 'xlsx' });
      }
    }
    return okResult(null);
  };
  const admin = fakeSupabaseClient({
    role: 'admin',
    responder: adminResponder,
  });
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

  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body('xlsx') }), custom));
  assertEquals(status, 200);
  assert(uploadedBytes !== null);

  const wb = XLSX.read(uploadedBytes!, { type: 'array' });
  assertEquals(wb.SheetNames.includes('Données'), true);
  assertEquals(wb.SheetNames.includes('Dictionnaire'), true);
  assertEquals(wb.SheetNames.includes('diagnostics'), true);

  const diagSheet = XLSX.utils.sheet_to_json(wb.Sheets['diagnostics']) as Record<string, unknown>[];
  assertEquals(diagSheet.length, 2);
  assertEquals(diagSheet[0].patient_code, 'P0001');
  assertEquals(diagSheet[0].rang, 1);
  assertEquals(diagSheet[0].code, '1A00');
  assertEquals(diagSheet[0].label, 'Cholera');
  assertEquals(diagSheet[1].rang, 2);
  assertEquals(diagSheet[1].code, 'BA00');
  assertEquals(diagSheet[1].label, 'Hypertension');

  // L47 : le profil Analyse n'exprime pas un multiselect par une feuille relationnelle ni par
  // des colonnes concatennees — uniquement par ses indicatrices binaires (0/1 numeriques).
  assertEquals(wb.SheetNames.includes('signes'), false);
  const exportSheet = XLSX.utils.sheet_to_json(wb.Sheets['Données']) as Record<string, unknown>[];
  assertEquals(exportSheet[0]['has__encounter__signes__code_historique_inconnu'], 1);
  assertEquals(exportSheet[0]['has__encounter__signes__fievre'], 1);
  assertEquals(typeof exportSheet[0]['has__encounter__signes__fievre'], 'number');
  assertEquals('nb__encounter__signes' in exportSheet[0], false);
  assertEquals('option_code__encounter__signes' in exportSheet[0], false);

  // L47 : en `complete`, toutes les formes du multiselect restent presentes, sans perte : la
  // feuille relationnelle, le libelle concatenne, le compteur, les codes et les indicatrices.
  uploadedBytes = null;
  const completeRes = await readResponse(
    await handleGenerateExport(makeRequest({ body: { ...body('xlsx'), options: { profile: 'complete' } } }), custom),
  );
  assertEquals(completeRes.status, 200);
  assert(uploadedBytes !== null);
  const wbComplete = XLSX.read(uploadedBytes!, { type: 'array' });

  assertEquals(wbComplete.SheetNames.includes('signes'), true);
  const signsSheet = XLSX.utils.sheet_to_json(wbComplete.Sheets['signes']) as Record<string, unknown>[];
  assertEquals(signsSheet, [
    {
      patient_code: 'P0001',
      encounter_id: 'e1',
      rang: 1,
      code: 'code_historique_inconnu',
      label: 'code_historique_inconnu',
    },
    {
      patient_code: 'P0001',
      encounter_id: 'e1',
      rang: 2,
      code: 'fievre',
      label: 'Fièvre',
    },
  ]);
  const completeMain = XLSX.utils.sheet_to_json(wbComplete.Sheets['Export']) as Record<string, unknown>[];
  assertEquals(completeMain[0]['encounter__signes'], 'code_historique_inconnu; Fièvre');
  assertEquals(completeMain[0]['option_code__encounter__signes'], 'code_historique_inconnu; fievre');
  assertEquals(completeMain[0]['nb__encounter__signes'], 2);
  assertEquals(completeMain[0]['has__encounter__signes__fievre'], 1);
  assertEquals(completeMain[0]['has__encounter__signes__code_historique_inconnu'], 1);
});

Deno.test('generate-export: XLSX -> dates natives (serie + format), date invalide conservee en texte (L48)', async () => {
  let uploadedBytes: Uint8Array | null = null;
  const naissanceField = {
    id: 'f_nai',
    template_version_id: TV,
    field_key: 'naissance',
    label: 'Naissance',
    scope: 'encounter',
    section: 'vitals',
    type: 'date',
    unit: null,
    allowed_values: null,
    display_order: 6,
  } as const;
  const debutVisiteField = {
    id: 'f_dv',
    template_version_id: TV,
    field_key: 'debut_visite',
    label: 'Debut de visite',
    scope: 'encounter',
    section: 'vitals',
    type: 'datetime',
    unit: null,
    allowed_values: null,
    display_order: 7,
  } as const;
  const validEncounter = {
    ...ENCOUNTER,
    id: 'e1',
    data: { ...ENCOUNTER.data, naissance: '2020-01-01', debut_visite: '2020-01-01T12:30:00Z' },
  };
  // Date invalide : elle reste TEXTE lisible dans le classeur, jamais masquee par un zero.
  const invalidEncounter = {
    ...ENCOUNTER,
    id: 'e2',
    encounter_date: '2020-13-01',
    data: { ...ENCOUNTER.data, naissance: '2020-13-01', debut_visite: '2020-01-01T12:30:00Z' },
  };

  const adminResponder: Responder = (call) => {
    if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') return okResult([]);
    if (call.kind === 'storage' && call.method === 'upload') {
      const blob = call.args[1] as Blob;
      return blob.arrayBuffer().then((buf) => {
        uploadedBytes = new Uint8Array(buf);
        return okResult({ path: 'p' });
      });
    }
    if (call.kind === 'storage') return okResult([{}]);
    if (call.kind === 'from') {
      switch (call.table) {
        case 'cohort':
          return okResult({ id: COHORT, base_id: BASE, name: 'Cohorte Test', cohort_type: 'snapshot' });
        case 'base':
          return okResult({ name: 'Base Test' });
        case 'cohort_member':
          return okResult([{ patient_id: 'p1' }]);
        case 'patient':
          return okResult([{ id: 'p1', patient_code: 'P0001', template_version_id: TV, data: {} }]);
        case 'cohort_encounter_member':
          return okResult([{ encounter_id: 'e1' }, { encounter_id: 'e2' }]);
        case 'encounter':
          return okResult([validEncounter, invalidEncounter]);
        case 'template_field':
          return okResult([...FIELDS, naissanceField, debutVisiteField]);
        case 'template_section':
          return okResult(SECTIONS);
        case 'export_log':
          return okResult({ id: 'exp1', format: 'xlsx' });
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

  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body('xlsx') }), custom));
  assertEquals(status, 200);
  assert(uploadedBytes !== null);
  const wb = XLSX.read(uploadedBytes!, { type: 'array' });
  const exportRows = XLSX.utils.sheet_to_json(wb.Sheets['Données']) as Record<string, unknown>[];

  // Valeurs relues : les dates valides sont des NOMBRES natifs (serie Excel), pas des textes.
  assertEquals(exportRows[0]['encounter_date'], 43_831);
  assertEquals(exportRows[0]['encounter__naissance'], 43_831);
  assertAlmostEquals(exportRows[0]['encounter__debut_visite'] as number, 43_831.5208333, 0.000_001);
  // La date invalide reste telle quelle en texte ; la datetime, elle, grandit en serie.
  assertEquals(exportRows[1]['encounter_date'], '2020-13-01');
  assertEquals(exportRows[1]['encounter__naissance'], '2020-13-01');
  assertAlmostEquals(exportRows[1]['encounter__debut_visite'] as number, 43_831.5208333, 0.000_001);

  // Formats de cellule poses (z) : date lisible, datetime lisible avec les secondes.
  const sheetCells = wb.Sheets['Données'] as Record<string, unknown> & { '!ref'?: string };
  const range = XLSX.utils.decode_range(sheetCells['!ref']!);
  const headerIndex = (name: string): number => {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheetCells[XLSX.utils.encode_cell({ r: 0, c })] as { v?: unknown } | undefined;
      if (cell?.v === name) return c;
    }
    throw new Error(`Colonne absente du classeur : ${name}`);
  };
  const cellAt = (name: string, row: number): { t?: string; z?: string } | undefined => {
    const address = XLSX.utils.encode_cell({ r: row, c: headerIndex(name) });
    const cell = sheetCells[address];
    return cell as { t?: string; z?: string } | undefined;
  };
  // Type natif des cellules : nombres (t:n), pas de texte. La plage de serie est le chiffrage.
  assertEquals(cellAt('encounter_date', 1)?.t, 'n');
  // Le classeur contient bien le flux de styles (xl/styles.xml) : SheetJS n'y ecrit les formats
  // de date (cellules `z`) que lorsque cellStyles est actif. C'est lui qui rend lisible les
  // series « yyyy-mm-dd » et « yyyy-mm-dd hh:mm:ss » au lieu d'un entier nu.
  const latin = new TextDecoder('latin1').decode(uploadedBytes!);
  assertStringIncludes(latin, 'xl/styles.xml');
  // La ligne invalide reste du texte (t:s), sans valeur inventeepar la conversion.
  assertEquals(cellAt('encounter__naissance', 2)?.t, 's');
  assertEquals(cellAt('encounter_date', 2)?.t, 's');
});

Deno.test('generate-export: Analyse produit la feuille Modalites, pas Complet (L46)', async () => {
  let uploadedBytes: Uint8Array | null = null;
  const selectField = {
    id: 'f_evo',
    template_version_id: TV,
    field_key: 'evolution',
    label: 'Evolution',
    scope: 'encounter',
    section: 'vitals',
    type: 'select',
    unit: null,
    allowed_values: ['gueri', 'deces'],
    allowed_options: [
      { value_key: 'gueri', label: 'Gueri', is_active: true },
      { value_key: 'deces', label: 'Deces', is_active: false },
    ],
    display_order: 6,
  };
  const enc = { ...ENCOUNTER, data: { ...ENCOUNTER.data, evolution: 'gueri' } };

  const run = (profile?: 'analysis' | 'complete'): Promise<Response> => {
    const adminResponder: Responder = (call) => {
      if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') return okResult([]);
      if (call.kind === 'storage' && call.method === 'upload') {
        const blob = call.args[1] as Blob;
        return blob.arrayBuffer().then((buf) => {
          uploadedBytes = new Uint8Array(buf);
          return okResult({ path: 'p' });
        });
      }
      if (call.kind === 'storage') return okResult([{}]);
      if (call.kind === 'from') {
        switch (call.table) {
          case 'cohort':
            return okResult({ id: COHORT, base_id: BASE, name: 'Cohorte Test', cohort_type: 'snapshot' });
          case 'base':
            return okResult({ name: 'Base Test' });
          case 'cohort_member':
            return okResult([{ patient_id: 'p1' }]);
          case 'patient':
            return okResult([{ id: 'p1', patient_code: 'P0001', template_version_id: TV, data: {} }]);
          case 'cohort_encounter_member':
            return okResult([{ encounter_id: 'e1' }]);
          case 'encounter':
            return okResult([enc]);
          case 'template_field':
            return okResult([...FIELDS, selectField]);
          case 'template_section':
            return okResult(SECTIONS);
          case 'export_log':
            return okResult({ id: 'exp1', format: 'xlsx' });
        }
      }
      return okResult(null);
    };
    const admin = fakeSupabaseClient({ role: 'admin', responder: adminResponder });
    const asUser = fakeSupabaseClient({
      role: 'user',
      user: { data: { user: { id: 'u1' } } },
      responder: (c) => (c.kind === 'rpc' ? okResult(true) : okResult(null)),
    });
    const custom: GenerateExportDeps = {
      buildClients: () => ({ asUser, admin }),
      newId: () => 'fixed-uuid',
      now: () => 1_700_000_000_000,
      nowIso: () => '2026-07-12T00:00:00.000Z',
    };
    const payload = profile ? { ...body('xlsx'), options: { profile } } : body('xlsx');
    return handleGenerateExport(makeRequest({ body: payload }), custom);
  };

  const analysisRes = await readResponse(await run());
  assertEquals(analysisRes.status, 200);
  assert(uploadedBytes !== null);
  const wb = XLSX.read(uploadedBytes!, { type: 'array' });
  assertEquals(wb.SheetNames.includes('Modalités'), true);
  const sheet = XLSX.utils.sheet_to_json(wb.Sheets['Modalités']) as Record<string, unknown>[];
  assertEquals(sheet, [
    { variable: 'encounter__evolution', code: 'gueri', label: 'Gueri', order: 1, is_active: 'true' },
    { variable: 'encounter__evolution', code: 'deces', label: 'Deces', order: 2, is_active: 'false' },
  ]);
  // Analyse : la colonne principale du select porte le code stable, pas de colonne de code separee.
  const mainSheet = XLSX.utils.sheet_to_json(wb.Sheets['Données']) as Record<string, unknown>[];
  assertEquals(mainSheet[0]['encounter__evolution'], 'gueri');
  assertEquals('option_code__encounter__evolution' in mainSheet[0], false);

  uploadedBytes = null;
  const completeRes = await readResponse(await run('complete'));
  assertEquals(completeRes.status, 200);
  assert(uploadedBytes !== null);
  const wbComplete = XLSX.read(uploadedBytes!, { type: 'array' });
  assertEquals(wbComplete.SheetNames.includes('Modalités'), false);
  // Complet : libelle en colonne principale, code dans sa colonne dediee (reimportation).
  const completeMain = XLSX.utils.sheet_to_json(wbComplete.Sheets['Export']) as Record<string, unknown>[];
  assertEquals(completeMain[0]['encounter__evolution'], 'Gueri');
  assertEquals(completeMain[0]['option_code__encounter__evolution'], 'gueri');
});

Deno.test('generate-export: XLSX Analyse -> Donnees, Dictionnaire simplifie, Modalites, Metadonnees (L49)', async () => {
  let uploadedBytes: Uint8Array | null = null;
  const selectEvo = {
    id: 'f_evo',
    template_version_id: TV,
    field_key: 'evolution',
    label: 'Evolution',
    scope: 'encounter',
    section: 'vitals',
    type: 'select',
    unit: null,
    allowed_values: ['gueri', 'deces'],
    allowed_options: [
      { value_key: 'gueri', label: 'Gueri', is_active: true },
      { value_key: 'deces', label: 'Deces', is_active: false },
    ],
    display_order: 4,
  } as const;
  const multiSignes = {
    id: 'f_signes',
    template_version_id: TV,
    field_key: 'signes',
    label: 'Signes',
    scope: 'encounter',
    section: 'vitals',
    type: 'multiselect',
    unit: null,
    allowed_values: ['fievre'],
    allowed_options: [{ value_key: 'fievre', label: 'Fievre', is_active: true }],
    display_order: 5,
  } as const;
  const encounter = {
    ...ENCOUNTER,
    data: { ...ENCOUNTER.data, evolution: 'gueri', signes: ['fievre'] },
  };

  const adminResponder: Responder = (call) => {
    if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') return okResult([]);
    if (call.kind === 'storage' && call.method === 'upload') {
      const blob = call.args[1] as Blob;
      return blob.arrayBuffer().then((buf) => {
        uploadedBytes = new Uint8Array(buf);
        return okResult({ path: 'p' });
      });
    }
    if (call.kind === 'storage') return okResult([{}]);
    if (call.kind === 'from') {
      switch (call.table) {
        case 'cohort':
          return okResult({ id: COHORT, base_id: BASE, name: 'Cohorte Test', cohort_type: 'snapshot' });
        case 'base':
          return okResult({ name: 'Base Test' });
        case 'cohort_member':
          return okResult([{ patient_id: 'p1' }]);
        case 'patient':
          return okResult([{ id: 'p1', patient_code: 'P0001', template_version_id: TV, data: {} }]);
        case 'cohort_encounter_member':
          return okResult([{ encounter_id: 'e1' }]);
        case 'encounter':
          return okResult([encounter]);
        case 'template_field':
          return okResult([...FIELDS, selectEvo, multiSignes]);
        case 'template_section':
          return okResult(SECTIONS);
        case 'export_log':
          return okResult({ id: 'exp1', format: 'xlsx' });
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

  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body('xlsx') }), custom));
  assertEquals(status, 200);
  assert(uploadedBytes !== null);
  const wb = XLSX.read(uploadedBytes!, { type: 'array' });
  // L49 : les quatre feuilles du profil Analyse, dans l'ordre du classeur autonome.
  assertEquals(wb.SheetNames.slice(0, 4), ['Données', 'Dictionnaire', 'Modalités', 'Métadonnées']);

  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Données']) as Record<string, unknown>[];
  assertEquals(rows[0]['encounter__evolution'], 'gueri');
  assertEquals(rows[0]['has__encounter__signes__fievre'], 1);
  assertEquals('nb__encounter__signes' in rows[0], false);
  assertEquals('option_code__encounter__signes' in rows[0], false);

  // Dictionnaire Analyse : reduit aux proprietes d'interpretation, sans identifiants techniques.
  const dictRows = XLSX.utils.sheet_to_json(wb.Sheets['Dictionnaire']) as Record<string, unknown>[];
  const dictColumns = Object.keys(dictRows[0]);
  for (
    const kept of [
      'column_id',
      'label',
      'description',
      'section',
      'type',
      'formula',
      'unit',
      'allowed_values',
      'missing_reasons',
    ]
  ) {
    assertEquals(dictColumns.includes(kept), true, `colonne ${kept} attendue`);
  }
  for (const removed of ['field_key', 'scope', 'is_multiple', 'template_versions']) {
    assertEquals(dictColumns.includes(removed), false, `colonne ${removed} absente`);
  }
  const evoRow = dictRows.find((r) => r.column_id === 'encounter__evolution');
  assertEquals(evoRow?.allowed_values, 'Gueri; Deces (inactif)');
  const indicatorRow = dictRows.find((r) => r.column_id === 'has__encounter__signes__fievre');
  assertEquals(indicatorRow?.type, 'computed_indicator');
  assertEquals(indicatorRow?.allowed_values, 'fievre');

  // Metadonnees : le fichier s'explique seul (population, versions, exclusions, regle).
  const meta = new Map(
    (XLSX.utils.sheet_to_json(wb.Sheets['Métadonnées']) as Array<{ attribute: string; value: unknown }>)
      .map((r) => [r.attribute, r.value]),
  );
  assertEquals(meta.get('export_profile'), 'analysis');
  assertEquals(meta.get('base_name'), 'Base Test');
  assertEquals(meta.get('cohort_name'), 'Cohorte Test');
  assertEquals(meta.get('export_mode'), 'encounter');
  assertEquals(meta.get('selection_rule'), 'last');
  assertEquals(meta.get('template_versions'), TV);
  assertEquals(meta.get('row_count'), 1);
  assertEquals(meta.get('excluded_patients_incomplete'), 0);
  assertEquals(meta.get('excluded_encounters_incomplete'), 0);

  // Complet : pas de Metadonnees, dictionnaire detaille (versions et portee conserves).
  uploadedBytes = null;
  const completeRes = await readResponse(
    await handleGenerateExport(makeRequest({ body: { ...body('xlsx'), options: { profile: 'complete' } } }), custom),
  );
  assertEquals(completeRes.status, 200);
  assert(uploadedBytes !== null);
  const wbComplete = XLSX.read(uploadedBytes!, { type: 'array' });
  assertEquals(wbComplete.SheetNames.includes('Métadonnées'), false);
  const completeDict = XLSX.utils.sheet_to_json(wbComplete.Sheets['Dictionnaire']) as Record<string, unknown>[];
  for (const kept of ['field_key', 'scope', 'is_multiple', 'template_versions']) {
    assertEquals(Object.keys(completeDict[0]).includes(kept), true, `complete colonne ${kept}`);
  }
});

Deno.test('generate-export: Analyse refuse un multiselect au-dela de 100 codes, pas Complet (L47)', async () => {
  const codes = Array.from({ length: 101 }, (_, index) => `code_${index}`);
  const hugeField = {
    id: 'f_signes',
    template_version_id: TV,
    field_key: 'signes',
    label: 'Signes',
    scope: 'encounter',
    section: 'vitals',
    type: 'multiselect',
    unit: null,
    allowed_values: codes,
    allowed_options: null,
    display_order: 6,
  };
  const enc = {
    ...ENCOUNTER,
    data: { ...ENCOUNTER.data, signes: codes },
  };

  const makeRun = (responder: Responder) => {
    const admin = fakeSupabaseClient({ role: 'admin', responder });
    const asUser = fakeSupabaseClient({
      role: 'user',
      user: { data: { user: { id: 'u1' } } },
      responder: (c) => (c.kind === 'rpc' ? okResult(true) : okResult(null)),
    });
    const custom: GenerateExportDeps = {
      buildClients: () => ({ asUser, admin }),
      newId: () => 'fixed-uuid',
      now: () => 1_700_000_000_000,
      nowIso: () => '2026-07-12T00:00:00.000Z',
    };
    return (payload: unknown) => handleGenerateExport(makeRequest({ body: payload }), custom);
  };

  const runWith = async (profile?: 'analysis' | 'complete') =>
    readResponse(
      await makeRun((call) => {
        if (call.kind === 'rpc' && call.rpc === 'export_incomplete_records') return okResult([]);
        if (call.kind === 'storage' && call.method === 'upload') return okResult({ path: 'p' });
        if (call.kind === 'storage') return okResult([{}]);
        if (call.kind === 'from') {
          switch (call.table) {
            case 'cohort':
              return okResult({ id: COHORT, base_id: BASE, name: 'Cohorte Test', cohort_type: 'snapshot' });
            case 'base':
              return okResult({ name: 'Base Test' });
            case 'cohort_member':
              return okResult([{ patient_id: 'p1' }]);
            case 'patient':
              return okResult([{ id: 'p1', patient_code: 'P0001', template_version_id: TV, data: {} }]);
            case 'cohort_encounter_member':
              return okResult([{ encounter_id: 'e1' }]);
            case 'encounter':
              return okResult([enc]);
            case 'template_field':
              return okResult([...FIELDS, hugeField]);
            case 'template_section':
              return okResult(SECTIONS);
            case 'export_log':
              return okResult({ id: 'exp1', format: 'xlsx' });
          }
        }
        return okResult(null);
      })(profile ? { ...body('xlsx'), options: { profile } } : body('xlsx')),
    );

  // Analyse : jamais de fichier tronque silencieusement, refus explicite du seuil.
  const refused = await runWith();
  assertEquals(refused.status, 413);
  assertEquals(refused.body.code, 'EXPORT_INDICATOR_CARDINALITY');
  assertEquals(refused.body.limit, 100);
  assertEquals(refused.body.fields, ['signes']);

  // Complet : les codes concatenes conservent l'information sans seuil a faire respecter.
  const complete = await runWith('complete');
  assertEquals(complete.status, 200);
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

// ---------------------------------------------------------------------------
// La porte de l'export : completude, plus statut de validation (decision 2026-08-17)
// ---------------------------------------------------------------------------

Deno.test('generate-export: aucune lecture ne filtre sur le statut de validation', async () => {
  const filtered: string[] = [];
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: body() }),
      deps({
        fromResponder: (call) => {
          for (const op of call.ops.filter((candidate) => candidate.m === 'eq')) {
            if ((op.a as [string, unknown])[0] === 'validation_status') filtered.push(call.table);
          }
          return undefined;
        },
      }),
    ),
  );
  assertEquals(status, 200);
  // Un brouillon complet doit pouvoir sortir : plus aucun `validation_status = 'curated'`.
  assertEquals(filtered, []);
});

Deno.test('generate-export: fiche incomplete ecartee, comptee et tracee -- sans faire echouer l export', async () => {
  let logged: Record<string, unknown> | undefined;
  const { status, body: b } = await readResponse(
    await handleGenerateExport(
      makeRequest({ body: { cohortId: COHORT, format: 'csv', options: { mode: 'patient' } } }),
      deps({
        memberRows: [{ patient_id: 'p1' }, { patient_id: 'p2' }],
        patientRows: [
          { id: 'p1', patient_code: 'P001', template_version_id: TV, data: {} },
          { id: 'p2', patient_code: 'P002', template_version_id: TV, data: {} },
        ],
        incompleteRecords: [{ record_kind: 'patient', record_id: 'p2' }],
        fromResponder: (call) => {
          if (call.table !== 'export_log') return undefined;
          logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
          return undefined;
        },
      }),
    ),
  );
  assertEquals(status, 200);
  assertEquals(b.error, undefined);
  assertEquals(logged?.patient_count, 1);
  assertEquals((logged?.export_options as { excluded_records?: unknown }).excluded_records, {
    reason: 'required_fields_missing',
    patients: 1,
    encounters: 0,
  });
});

Deno.test('generate-export: rencontre incomplete absente du fichier', async () => {
  let uploaded: Blob | null = null;
  const d = deps({
    encounterMemberRows: [{ encounter_id: 'e1' }, { encounter_id: 'e2' }],
    encounterRows: [ENCOUNTER, { ...ENCOUNTER, id: 'e2', data: {} }],
    incompleteRecords: [{ record_kind: 'encounter', record_id: 'e2' }],
    onStorage: (method, args) => {
      if (method === 'upload') uploaded = args[1] as Blob;
    },
  });
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body() }), d));
  assertEquals(status, 200);
  const text = await uploaded!.text();
  assertStringIncludes(text, 'e1');
  assertEquals(text.includes('e2'), false);
});

Deno.test('generate-export: filtre de completude illisible -> refus (aucun export non verifie)', async () => {
  const { status, body: b } = await readResponse(
    await handleGenerateExport(makeRequest({ body: body() }), deps({ incompleteError: { message: 'rpc down' } })),
  );
  assertEquals(status, 500);
  assertEquals(b.code, 'EXPORT_READ_FAILED');
  assertEquals(b.resource, 'completeness');
});

// ---------------------------------------------------------------------------
// L53 — projection d'export par BLOCS, bout en bout.
//
// La projection choisit des COLONNES. Elle ne touche jamais la population, les variables du
// tronc commun traversent toutes les projections, et la projection RESOLUE est journalisee.
// ---------------------------------------------------------------------------

const TV2 = '423e4567-e89b-42d3-a456-426614174000';

/** Base a DEUX niveaux : `tb_biologie` est une sous-section de `tuberculose`. */
const BLOCK_SECTIONS = [
  {
    id: 'sb1',
    template_version_id: TV,
    section_key: 'tuberculose',
    label: 'Tuberculose',
    parent_section_id: null,
    display_order: 0,
  },
  {
    id: 'sb2',
    template_version_id: TV,
    section_key: 'tb_biologie',
    label: 'Biologie',
    parent_section_id: 'sb1',
    display_order: 1,
  },
  {
    id: 'sb3',
    template_version_id: TV,
    section_key: 'malnutrition',
    label: 'Malnutrition',
    parent_section_id: null,
    display_order: 2,
  },
];

const blockField = (
  id: string,
  fieldKey: string,
  section: string | null,
  order: number,
  versionId = TV,
) => ({
  id,
  template_version_id: versionId,
  field_key: fieldKey,
  label: fieldKey,
  description: null,
  scope: 'encounter',
  section,
  type: 'number',
  is_multiple: false,
  unit: null,
  allowed_values: null,
  allowed_options: null,
  missing_reasons: null,
  formula: null,
  display_order: order,
});

const BLOCK_FIELDS = [
  // L54 : tronc commun explicite — aucune section, donc aucun bloc, donc jamais decochable.
  blockField('bf1', 'age', null, 1),
  blockField('bf2', 'tb_statut', 'tuberculose', 2),
  blockField('bf3', 'tb_crp', 'tb_biologie', 3),
  blockField('bf4', 'poids', 'malnutrition', 4),
];

const BLOCK_ENCOUNTER = {
  ...ENCOUNTER,
  data: { age: 7, tb_statut: 1, tb_crp: 12, poids: 9 },
};

/** Cohorte a deux niveaux, avec des surcharges de gabarit quand le cas l'exige. */
function blocDeps(
  opts: Opts & { fields?: unknown[]; sections?: unknown[] } = {},
): GenerateExportDeps {
  const fields = opts.fields ?? BLOCK_FIELDS;
  const sections = opts.sections ?? BLOCK_SECTIONS;
  return deps({
    ...opts,
    encounterRows: opts.encounterRows ?? [BLOCK_ENCOUNTER],
    fromResponder: (call) => {
      if (call.table === 'template_field') {
        return queriedRows(call, fields as Array<Record<string, unknown>>, 'id');
      }
      if (call.table === 'template_section') {
        return queriedRows(call, sections as Array<Record<string, unknown>>, 'id');
      }
      return opts.fromResponder?.(call);
    },
  });
}

Deno.test('L53 : projeter un bloc filtre les COLONNES, jamais la population, et se journalise', async () => {
  let uploaded: Blob | null = null;
  let logged: Record<string, unknown> | undefined;
  const d = blocDeps({
    onStorage: (method, args) => {
      if (method === 'upload') uploaded = args[1] as Blob;
    },
    fromResponder: (call) => {
      if (call.table !== 'export_log') return undefined;
      logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
      return undefined;
    },
  });
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: {
          ...body('csv'),
          options: { profile: 'complete', sectionProjection: { mode: 'selected', blockKeys: ['tuberculose'] } },
        },
      }),
      d,
    ),
  );
  assertEquals(status, 200);
  const uploadedBlob = uploaded as Blob | null;
  assert(uploadedBlob !== null);
  const csv = await uploadedBlob.text();
  const entete = csv.split('\n')[0];
  // Le tronc commun est la, le bloc choisi aussi — sous-section comprise. L'autre bloc, non.
  assertStringIncludes(entete, 'encounter__age');
  assertStringIncludes(entete, 'encounter__tb_statut');
  assertStringIncludes(entete, 'encounter__tb_crp');
  assertEquals(entete.includes('encounter__poids'), false);
  // La POPULATION ne bouge pas : une rencontre dans la cohorte, une ligne dans le fichier.
  assertEquals(csv.trim().split('\n').length, 2);
  assertEquals(logged?.encounter_count, 1);
  const options = (logged?.export_options ?? {}) as { sectionProjection?: unknown };
  assertEquals(options.sectionProjection, { mode: 'selected', blockKeys: ['tuberculose'] });
});

Deno.test('L53 : sans projection, le journal porte la projection RESOLUE `all`', async () => {
  let logged: Record<string, unknown> | undefined;
  const d = blocDeps({
    fromResponder: (call) => {
      if (call.table !== 'export_log') return undefined;
      logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
      return undefined;
    },
  });
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body() }), d));
  assertEquals(status, 200);
  const options = (logged?.export_options ?? {}) as { sectionProjection?: unknown };
  assertEquals(options.sectionProjection, { mode: 'all' });
});

Deno.test('L53 : les cles sont dedupliquees et triees avant journalisation', async () => {
  let logged: Record<string, unknown> | undefined;
  const d = blocDeps({
    fromResponder: (call) => {
      if (call.table !== 'export_log') return undefined;
      logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
      return undefined;
    },
  });
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: {
          ...body('csv'),
          options: {
            sectionProjection: { mode: 'selected', blockKeys: ['tuberculose', 'malnutrition', 'tuberculose'] },
          },
        },
      }),
      d,
    ),
  );
  assertEquals(status, 200);
  const options = (logged?.export_options ?? {}) as { sectionProjection?: { blockKeys?: string[] } };
  assertEquals(options.sectionProjection?.blockKeys, ['malnutrition', 'tuberculose']);
});

Deno.test('L53 : refus 400 — `selected` sans blockKeys utilisable, avant toute generation', async () => {
  for (const projection of [{ mode: 'selected' }, { mode: 'selected', blockKeys: [] }, { mode: 'ciblee' }]) {
    let uploaded = false;
    const d = blocDeps({
      onStorage: (method) => {
        if (method === 'upload') uploaded = true;
      },
    });
    const { status, body: b } = await readResponse(
      await handleGenerateExport(
        makeRequest({ body: { ...body('csv'), options: { sectionProjection: projection } } }),
        d,
      ),
    );
    assertEquals(status, 400);
    assertEquals(b.error, 'sectionProjection invalide');
    assertEquals(uploaded, false);
  }
});

Deno.test('L53 : refus 400 — bloc inconnu de toutes les versions de la cohorte', async () => {
  let uploaded = false;
  const d = blocDeps({
    onStorage: (method) => {
      if (method === 'upload') uploaded = true;
    },
  });
  const { status, body: b } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: { ...body('csv'), options: { sectionProjection: { mode: 'selected', blockKeys: ['paludisme'] } } },
      }),
      d,
    ),
  );
  assertEquals(status, 400);
  assertEquals(b.code, 'EXPORT_PROJECTION_UNKNOWN_BLOCK');
  assertEquals(b.blocks, ['paludisme']);
  // Aucun fichier n'a ete produit : le refus precede la generation.
  assertEquals(uploaded, false);
});

Deno.test('L53 : refus 400 — la cle designe une SOUS-SECTION, pas un bloc', async () => {
  const { status, body: b } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: { ...body('csv'), options: { sectionProjection: { mode: 'selected', blockKeys: ['tb_biologie'] } } },
      }),
      blocDeps(),
    ),
  );
  assertEquals(status, 400);
  assertEquals(b.code, 'EXPORT_PROJECTION_NOT_A_BLOCK');
  assertEquals(b.blocks, ['tb_biologie']);
});

Deno.test('L53 : refus 400 — role racine/feuille divergent entre versions', async () => {
  // `malnutrition` est racine en v1 et sous-section de `tuberculose` en v2 : le bloc designe
  // par cette cle depend de la version lue, donc la projection ne veut plus rien dire.
  const sections = [
    ...BLOCK_SECTIONS,
    {
      id: 'sc1',
      template_version_id: TV2,
      section_key: 'tuberculose',
      label: 'Tuberculose',
      parent_section_id: null,
      display_order: 0,
    },
    {
      id: 'sc2',
      template_version_id: TV2,
      section_key: 'malnutrition',
      label: 'Malnutrition',
      parent_section_id: 'sc1',
      display_order: 1,
    },
  ];
  const fields = [...BLOCK_FIELDS, blockField('bf5', 'poids', 'malnutrition', 4, TV2)];
  const { status, body: b } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: { ...body('csv'), options: { sectionProjection: { mode: 'selected', blockKeys: ['malnutrition'] } } },
      }),
      blocDeps({
        sections,
        fields,
        encounterMemberRows: [{ encounter_id: 'e1' }, { encounter_id: 'e2' }],
        encounterRows: [BLOCK_ENCOUNTER, { ...BLOCK_ENCOUNTER, id: 'e2', template_version_id: TV2 }],
      }),
    ),
  );
  assertEquals(status, 400);
  assertEquals(b.code, 'EXPORT_PROJECTION_NOT_A_BLOCK');
});

Deno.test('L53 : refus 409 — une variable rattachee a des BLOCS differents selon les versions', async () => {
  const sections = [
    ...BLOCK_SECTIONS,
    {
      id: 'sc1',
      template_version_id: TV2,
      section_key: 'tuberculose',
      label: 'Tuberculose',
      parent_section_id: null,
      display_order: 0,
    },
    {
      id: 'sc2',
      template_version_id: TV2,
      section_key: 'malnutrition',
      label: 'Malnutrition',
      parent_section_id: null,
      display_order: 1,
    },
  ];
  // `tb_crp` vit sous `tuberculose` en v1 et sous `malnutrition` en v2 : la fusion la classerait
  // au hasard de l'ordre de lecture.
  const fields = [...BLOCK_FIELDS, blockField('bf6', 'tb_crp', 'malnutrition', 3, TV2)];
  const { status, body: b } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: { ...body('csv'), options: { sectionProjection: { mode: 'selected', blockKeys: ['tuberculose'] } } },
      }),
      blocDeps({
        sections,
        fields,
        encounterMemberRows: [{ encounter_id: 'e1' }, { encounter_id: 'e2' }],
        encounterRows: [BLOCK_ENCOUNTER, { ...BLOCK_ENCOUNTER, id: 'e2', template_version_id: TV2 }],
      }),
    ),
  );
  assertEquals(status, 409);
  assertEquals(b.code, 'EXPORT_BLOCK_AMBIGUOUS');
  assertEquals(b.fields, ['encounter__tb_crp']);
});

Deno.test('L53 : PAS de refus — deplacement entre SOUS-SECTIONS du meme bloc', async () => {
  const sections = [
    ...BLOCK_SECTIONS,
    {
      id: 'sd1',
      template_version_id: TV2,
      section_key: 'tuberculose',
      label: 'Tuberculose',
      parent_section_id: null,
      display_order: 0,
    },
    {
      id: 'sd2',
      template_version_id: TV2,
      section_key: 'tb_imagerie',
      label: 'Imagerie',
      parent_section_id: 'sd1',
      display_order: 1,
    },
  ];
  // `tb_crp` passe de `tb_biologie` a `tb_imagerie` : la FEUILLE change, le BLOC non.
  const fields = [...BLOCK_FIELDS, blockField('bf7', 'tb_crp', 'tb_imagerie', 3, TV2)];
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: { ...body('csv'), options: { sectionProjection: { mode: 'selected', blockKeys: ['tuberculose'] } } },
      }),
      blocDeps({
        sections,
        fields,
        encounterMemberRows: [{ encounter_id: 'e1' }, { encounter_id: 'e2' }],
        encounterRows: [BLOCK_ENCOUNTER, { ...BLOCK_ENCOUNTER, id: 'e2', template_version_id: TV2 }],
      }),
    ),
  );
  assertEquals(status, 200);
});

Deno.test('L53 : base historique PLATE sans projection — acceptee malgre un changement de section', async () => {
  // Aucune sous-section, aucune projection : le nouveau controle de bloc reste eteint et
  // l'export continue de reussir, exactement comme avant le lot.
  const sections = [
    {
      id: 'sp1',
      template_version_id: TV,
      section_key: 'clinique',
      label: 'Clinique',
      parent_section_id: null,
      display_order: 0,
    },
    {
      id: 'sp2',
      template_version_id: TV,
      section_key: 'biologie',
      label: 'Biologie',
      parent_section_id: null,
      display_order: 1,
    },
    {
      id: 'sp3',
      template_version_id: TV2,
      section_key: 'clinique',
      label: 'Clinique',
      parent_section_id: null,
      display_order: 0,
    },
    {
      id: 'sp4',
      template_version_id: TV2,
      section_key: 'biologie',
      label: 'Biologie',
      parent_section_id: null,
      display_order: 1,
    },
  ];
  const fields = [
    blockField('pf1', 'crp', 'clinique', 1),
    blockField('pf2', 'crp', 'biologie', 1, TV2),
  ];
  let uploadedBlob: Blob | null = null;
  const d = blocDeps({
    sections,
    fields,
    encounterMemberRows: [{ encounter_id: 'e1' }, { encounter_id: 'e2' }],
    encounterRows: [
      { ...BLOCK_ENCOUNTER, data: { crp: 5 } },
      { ...BLOCK_ENCOUNTER, id: 'e2', template_version_id: TV2, data: { crp: 6 } },
    ],
    onStorage: (method, args) => {
      if (method === 'upload') uploadedBlob = args[1] as Blob;
    },
  });
  const { status } = await readResponse(await handleGenerateExport(makeRequest({ body: body('xlsx') }), d));
  assertEquals(status, 200);
  const blob1 = uploadedBlob as Blob | null;
  assert(blob1 !== null);
  const uploadedBytes = new Uint8Array(await blob1.arrayBuffer());
  const wb = XLSX.read(uploadedBytes, { type: 'array' });
  const entetes = (XLSX.utils.sheet_to_json(wb.Sheets['Dictionnaire'], { header: 1 }) as string[][])[0];
  // Le dictionnaire garde STRICTEMENT sa forme d'avant L53 : aucune colonne de bloc.
  assertEquals(entetes.includes('block'), false);
  assertEquals(entetes.includes('block_label'), false);
});

Deno.test('L53 : XLSX — dictionnaire aux deux niveaux et Metadonnees porteuse de la projection', async () => {
  let uploadedBlob: Blob | null = null;
  const d = blocDeps({
    onStorage: (method, args) => {
      if (method === 'upload') uploadedBlob = args[1] as Blob;
    },
  });
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: {
          ...body('xlsx'),
          options: { sectionProjection: { mode: 'selected', blockKeys: ['tuberculose'] } },
        },
      }),
      d,
    ),
  );
  assertEquals(status, 200);
  const blob2 = uploadedBlob as Blob | null;
  assert(blob2 !== null);
  const uploadedBytes = new Uint8Array(await blob2.arrayBuffer());
  const wb = XLSX.read(uploadedBytes, { type: 'array' });
  const dictionnaire = XLSX.utils.sheet_to_json(wb.Sheets['Dictionnaire']) as Record<string, unknown>[];
  const parCle = new Map(dictionnaire.map((r) => [r.column_id, r]));
  // La sous-section garde SA feuille et porte le bloc racine.
  assertEquals(parCle.get('encounter__tb_crp')?.section, 'tb_biologie');
  assertEquals(parCle.get('encounter__tb_crp')?.block, 'tuberculose');
  assertEquals(parCle.get('encounter__tb_crp')?.block_label, 'Tuberculose');
  // Le bloc exclu n'est plus documente : le dictionnaire decrit le fichier, pas le gabarit.
  assertEquals(parCle.has('encounter__poids'), false);
  const metadonnees = XLSX.utils.sheet_to_json(wb.Sheets['Métadonnées']) as Record<string, unknown>[];
  const parAttribut = new Map(metadonnees.map((r) => [r.attribute, r.value]));
  assertEquals(parAttribut.get('section_projection_blocks'), 'tuberculose');
});

Deno.test('L53 : hash de fichier — stable a projection egale, distinct a projection differente', async () => {
  const hashPour = async (projection: unknown) => {
    let logged: Record<string, unknown> | undefined;
    const d = blocDeps({
      fromResponder: (call) => {
        if (call.table !== 'export_log') return undefined;
        logged = call.ops.find((operation) => operation.m === 'insert')?.a[0] as Record<string, unknown>;
        return undefined;
      },
    });
    const { status } = await readResponse(
      await handleGenerateExport(
        makeRequest({ body: { ...body('csv'), options: { sectionProjection: projection } } }),
        d,
      ),
    );
    assertEquals(status, 200);
    return String(logged?.file_hash);
  };
  const tb = { mode: 'selected', blockKeys: ['tuberculose'] };
  assertEquals(await hashPour(tb), await hashPour(tb));
  // Deux projections differentes ne peuvent pas produire le meme fichier.
  assert((await hashPour(tb)) !== (await hashPour({ mode: 'all' })));
});

Deno.test('L53 : les gardes de sortie voient le jeu FILTRE, meta comprise', async () => {
  let uploaded: Blob | null = null;
  const d = blocDeps({
    onStorage: (method, args) => {
      if (method === 'upload') uploaded = args[1] as Blob;
    },
  });
  const { status } = await readResponse(
    await handleGenerateExport(
      makeRequest({
        body: {
          ...body('csv'),
          options: { profile: 'complete', sectionProjection: { mode: 'selected', blockKeys: ['malnutrition'] } },
        },
      }),
      d,
    ),
  );
  assertEquals(status, 200);
  const gardeBlob = uploaded as Blob | null;
  assert(gardeBlob !== null);
  const csv = await gardeBlob.text();
  // Le jeu de colonnes soumis a `assertNoIdentity` et aux limites est exactement celui-ci :
  // meta de rencontre, tronc commun, bloc choisi. Rien du bloc ecarte.
  assertEquals(csv.split('\n')[0].split(','), [
    'patient_code',
    'encounter_id',
    'encounter_date',
    'encounter_type',
    'age_value',
    'age_unit',
    'encounter__age',
    'encounter__poids',
  ]);
});
