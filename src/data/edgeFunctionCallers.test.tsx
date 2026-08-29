// @vitest-environment jsdom
// Chantier D — « corriger partout ou nulle part ». Un lot anterieur avait corrige UN seul
// appelant et laisse les autres afficher « [object Object] ». Ce fichier couvre donc CHAQUE
// chemin frontend qui passe par `functions.invoke`, et se termine par une garde d'inventaire
// qui echoue si un nouvel appel direct apparait hors de l'utilitaire partage.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeExportRepository } from './exports';
import { makeMissionRepository } from './mission';
import { finalizeUploadOperation, retryUploadedFileInspection } from './inspection';

const TRANSPORT = 'Edge Function returned a non-2xx status code';

function httpError(status: number, body: Record<string, unknown>): Error {
  const error = new Error(TRANSPORT) as Error & { context: Response };
  error.name = 'FunctionsHttpError';
  error.context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return error;
}

/** Client minimal dont l'unique fonction Edge refuse la demande. */
function refusingClient(status: number, body: Record<string, unknown>) {
  const invoke = vi.fn(async () => ({ data: null, error: httpError(status, body) }));
  return { client: { functions: { invoke } } as never, invoke };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('refus des Edge Functions — un test par appelant', () => {
  test('generate-export : le motif du refus remplace le message de transport', async () => {
    const { client } = refusingClient(409, { error: 'Seule une cohorte figee est exportable' });
    const repo = makeExportRepository(client);
    await expect(repo.recordExport({
      cohortId: 'c1', baseId: 'b1', templateVersions: ['v1'], format: 'csv', options: {},
    })).rejects.toThrow('Seule une cohorte figee est exportable');
  });

  test('generate-export : EXPORT_INCOMPLETE arrive avec son code', async () => {
    const { client } = refusingClient(409, {
      code: 'EXPORT_INCOMPLETE',
      error: 'Export refuse : donnees incompletes ou incoherentes',
      resource: 'patients',
    });
    const repo = makeExportRepository(client);
    await expect(repo.recordExport({
      cohortId: 'c1', baseId: 'b1', templateVersions: ['v1'], format: 'csv', options: {},
    })).rejects.toThrow('Export refuse : donnees incompletes ou incoherentes (EXPORT_INCOMPLETE)');
  });

  test('generate-export : le profil voyage dans options, absent = analysis par defaut (L45)', async () => {
    const invoke = vi.fn(async () => ({
      data: {
        id: 'e1', format: 'csv', exported_at: '2026-01-01T00:00:00Z', patient_count: 1,
        encounter_count: 0, file_hash: 'h', stored_file_path: 'x', generation_mode: 'server',
        export_options: { profile: 'complete', download_filename: 'meddata_x.csv' },
      },
      error: null,
    }));
    const repo = makeExportRepository({ functions: { invoke } } as never);
    const item = await repo.recordExport({
      cohortId: 'c1', baseId: 'b1', templateVersions: [], format: 'csv',
      options: { mode: 'patient' }, profile: 'complete',
    });
    expect(invoke).toHaveBeenCalledWith(
      'generate-export',
      { body: expect.objectContaining({ options: expect.objectContaining({ mode: 'patient', profile: 'complete' }) }) },
    );
    expect(item.profile).toBe('complete');
    expect(item.fileName).toBe('meddata_x.csv');
  });

  test('generate-export : un appel sans profil reste valide et expose analysis', async () => {
    const invoke = vi.fn(async () => ({
      data: {
        id: 'e1', format: 'csv', exported_at: '2026-01-01T00:00:00Z', patient_count: 1,
        encounter_count: 0, file_hash: 'h', stored_file_path: 'x', generation_mode: 'server',
        export_options: {},
      },
      error: null,
    }));
    const repo = makeExportRepository({ functions: { invoke } } as never);
    const item = await repo.recordExport({
      cohortId: 'c1', baseId: 'b1', templateVersions: [], format: 'csv', options: { mode: 'encounter' },
    });
    expect(invoke).toHaveBeenCalledWith(
      'generate-export',
      { body: expect.objectContaining({ options: expect.objectContaining({ mode: 'encounter', profile: undefined }) }) },
    );
    expect(item.profile).toBeNull();
  });

  test('create-mission-account : creation refusee sur une base invalide', async () => {
    const { client } = refusingClient(400, { error: 'Base invalide' });
    const repo = makeMissionRepository(client);
    await expect(repo.create({
      operationId: 'op1', baseId: 'pas-un-uuid', accountLabel: 'Thesard', loginIdentifier: 'thesard',
      expiresAt: '2027-01-01', canViewIdentity: false, identityJustification: null,
    })).rejects.toThrow('Base invalide');
  });

  test('create-mission-account : revelation refusee (non proprietaire)', async () => {
    const { client } = refusingClient(403, { error: 'Acces refuse' });
    const repo = makeMissionRepository(client);
    await expect(repo.reveal('a1')).rejects.toThrow('Acces refuse');
  });

  test('create-mission-account : identifiant deja pris, avec code', async () => {
    const { client } = refusingClient(409, { code: 'LOGIN_TAKEN', error: 'Identifiant deja utilise' });
    const repo = makeMissionRepository(client);
    await expect(repo.regenerate('a1', 'op2')).rejects.toThrow('Identifiant deja utilise (LOGIN_TAKEN)');
  });

  test('inspect-upload : motif du refus et signature virale conserves', async () => {
    const { client } = refusingClient(422, {
      error: 'Fichier mis en quarantaine',
      signature: 'Eicar-Test-Signature',
    });
    await expect(retryUploadedFileInspection(client, 'attachment', 'a1')).rejects.toThrow(
      'Inspection antivirus impossible : Fichier mis en quarantaine - signature: Eicar-Test-Signature.',
    );
  });

  test('finalize-upload : le refus du serveur remonte tel quel', async () => {
    const { client } = refusingClient(409, { error: 'Ticket deja finalise' });
    await expect(finalizeUploadOperation(client, 't1', 'attachment', {})).rejects.toThrow('Ticket deja finalise');
  });

  test('signed-read : le refus n est plus avale en silence', async () => {
    vi.stubEnv('VITE_USE_SIGNED_READ', 'true');
    vi.resetModules();
    const { signedRead } = await import('./signedRead');
    const { client } = refusingClient(409, { error: 'Fichier en quarantaine : lecture refusee' });
    await expect(signedRead(client, 'attachment', 'a1', 'clinical-attachments', 'p/a.png', 60)).rejects.toThrow(
      'Fichier en quarantaine : lecture refusee',
    );
  });

  test('aucun appelant ne laisse passer le message de transport ni [object Object]', async () => {
    const body = { error: 'Authentification requise' };
    const attempts: Array<() => Promise<unknown>> = [
      () => makeExportRepository(refusingClient(401, body).client).recordExport({
        cohortId: 'c1', baseId: 'b1', templateVersions: [], format: 'csv', options: {},
      }),
      () => makeMissionRepository(refusingClient(401, body).client).revoke('a1'),
      () => retryUploadedFileInspection(refusingClient(401, body).client, 'raw_document', 'd1'),
      () => finalizeUploadOperation(refusingClient(401, body).client, 't1', 'attachment', {}),
    ];
    for (const attempt of attempts) {
      const message = await attempt().then(() => '', (e: unknown) => String((e as Error).message));
      expect(message).toContain('Authentification requise');
      expect(message).not.toContain('non-2xx');
      expect(message).not.toContain('[object Object]');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Garde d'inventaire : la correction doit rester globale.
// ---------------------------------------------------------------------------------------------

const SRC = join(process.cwd(), 'src');
const posix = (path: string) => relative(SRC, path).replace(/\\/g, '/');

/** Seuls ces fichiers ont le droit d'appeler `functions.invoke` directement. */
const DIRECT_CALLERS_ALLOWED = [
  // L'utilitaire partage : c'est lui qui traduit le refus.
  'lib/edgeFunctionError.ts',
  // inspect-upload a besoin du corps de la reponse EN CAS DE SUCCES (verdict d'inspection) ;
  // son refus passe malgre tout par `readEdgeFunctionFailure`.
  'data/inspection.ts',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('inventaire des appels a functions.invoke', () => {
  test('aucun appel direct hors de l utilitaire partage', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => /functions\s*\.\s*invoke/.test(readFileSync(path, 'utf8')))
      .map(posix)
      .filter((path) => !DIRECT_CALLERS_ALLOWED.includes(path));
    expect(offenders).toEqual([]);
  });

  test('la garde surveille des fichiers reels et une derogation encore justifiee', () => {
    const scanned = sourceFiles(SRC).map(posix);
    for (const allowed of DIRECT_CALLERS_ALLOWED) {
      expect(scanned).toContain(allowed);
      // Si le fichier cesse d'appeler directement, la derogation doit disparaitre de la liste.
      expect(readFileSync(join(SRC, allowed), 'utf8')).toMatch(/functions\s*\.\s*invoke/);
    }
  });
});
