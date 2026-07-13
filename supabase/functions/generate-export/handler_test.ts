import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { type GenerateExportDeps, handleGenerateExport } from './handler.ts';
import {
  errorResult,
  fakeSupabaseClient,
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
      switch (call.table) {
        case 'cohort':
          return okResult(cohort);
        case 'cohort_member':
          return okResult(opts.memberRows ?? [{ patient_id: 'p1' }]);
        case 'patient':
          return okResult(opts.patientRows ?? [{ id: 'p1', patient_code: 'P001', template_version_id: TV, data: {} }]);
        case 'cohort_encounter_member':
          return okResult(opts.encounterMemberRows ?? [{ encounter_id: 'e1' }]);
        case 'encounter':
          return okResult(opts.encounterRows ?? [ENCOUNTER]);
        case 'template_field':
          return okResult(FIELDS);
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
  assertEquals(b.error, 'Cohorte incoherente : export refuse');
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
  assertEquals(b.error, 'Cohorte incoherente : export refuse');
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
