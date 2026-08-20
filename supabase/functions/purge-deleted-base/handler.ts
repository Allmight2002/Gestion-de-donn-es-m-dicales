// D10 — purge definitive d'une base placee dans la corbeille.
//
// PostgreSQL prepare la liste des chemins et verrouille la base. Cette fonction
// supprime ensuite les objets connus ET ceux decouverts par listing Storage,
// verifie que le prefixe est vide, puis demande la finalisation atomique SQL.
// Les erreurs internes des dependances ne quittent jamais cette couche.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readJsonObject, UUID_RE, validationResponse } from '../_shared/contracts.ts';

export interface PurgeDeps {
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const BUCKETS = ['raw-documents', 'clinical-attachments', 'scientific-exports', 'quarantined-uploads'] as const;
const REMOVE_BATCH_SIZE = 100;
const LIST_PAGE_SIZE = 1000;

type Bucket = (typeof BUCKETS)[number];
type PurgeObject = { bucket: Bucket; path: string };
type PurgeRow = {
  status?: string;
  code?: string;
  operation_id?: string;
  base_id?: string;
  manifest?: { objects?: unknown } | null;
  manifest_hash?: string | null;
  patient_count?: number | null;
  encounter_count?: number | null;
  document_count?: number | null;
  attachment_count?: number | null;
  export_count?: number | null;
  storage_object_count?: number | null;
};

const UUID_PATH_RE = /^[0-9a-f-]{36}\//i;

const ERROR_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Authentification requise.',
  OWNER_REQUIRED: 'Seul le propriétaire de la base peut la supprimer définitivement.',
  BASE_ACTIVE: 'La base est active et doit d’abord être placée dans la corbeille.',
  BASE_NOT_FOUND: 'Cette base n’est plus présente dans la corbeille.',
  PURGE_OPERATION_INVALID: 'La demande de suppression définitive est invalide.',
  PURGE_OPERATION_CONFLICT: 'Cette demande est déjà associée à une autre base.',
  PURGE_OPERATION_NOT_FOUND: 'La demande de suppression définitive est introuvable.',
  PURGE_IN_PROGRESS: 'Une suppression définitive est déjà en cours. Réessayez dans un instant.',
  PURGE_ACTOR_MISMATCH: 'La demande de suppression définitive n’appartient pas à cette session.',
  MANIFEST_MISMATCH: 'La vérification des fichiers a changé. Relancez la suppression.',
  PURGE_STATE_INCONSISTENT: 'La suppression définitive ne peut pas être reprise en sécurité.',
  PURGE_STATE_INVALID: 'La base n’est plus dans un état permettant sa purge.',
  STORAGE_MANIFEST_INVALID: 'Les fichiers de cette base ne peuvent pas être vérifiés en sécurité.',
  SERVER_REQUIRED: 'La finalisation serveur est indisponible.',
};

function codeMessage(code: string | undefined, fallback: string): string {
  return (code && ERROR_MESSAGES[code]) ?? fallback;
}

function statusForCode(code: string | undefined): number {
  switch (code) {
    case 'AUTHENTICATION_REQUIRED':
      return 401;
    case 'OWNER_REQUIRED':
      return 403;
    case 'BASE_NOT_FOUND':
    case 'PURGE_OPERATION_NOT_FOUND':
      return 404;
    case 'BASE_ACTIVE':
    case 'PURGE_OPERATION_CONFLICT':
    case 'PURGE_IN_PROGRESS':
    case 'PURGE_ACTOR_MISMATCH':
    case 'MANIFEST_MISMATCH':
    case 'PURGE_STATE_INCONSISTENT':
    case 'PURGE_STATE_INVALID':
    case 'STORAGE_MANIFEST_INVALID':
      return 409;
    default:
      return 400;
  }
}

function rowOf(data: unknown): PurgeRow | null {
  if (Array.isArray(data)) return (data[0] as PurgeRow | undefined) ?? null;
  return data && typeof data === 'object' ? data as PurgeRow : null;
}

function validStoragePath(baseId: string, path: unknown): path is string {
  return typeof path === 'string' &&
    path.length <= 600 &&
    UUID_PATH_RE.test(path) &&
    path.startsWith(`${baseId}/`) &&
    !path.includes('..') &&
    !path.includes('//');
}

function parseManifest(baseId: string, manifest: PurgeRow['manifest']): PurgeObject[] | null {
  if (!manifest || !Array.isArray(manifest.objects)) return null;
  const objects: PurgeObject[] = [];
  for (const value of manifest.objects) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (!BUCKETS.includes(entry.bucket as Bucket) || !validStoragePath(baseId, entry.path)) return null;
    objects.push({ bucket: entry.bucket as Bucket, path: entry.path });
  }
  return objects;
}

async function listBucket(admin: SupabaseClient, bucket: Bucket, baseId: string): Promise<string[]> {
  const queue = [baseId];
  const visited = new Set<string>();
  const objects = new Set<string>();

  while (queue.length > 0) {
    const prefix = queue.shift()!;
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error('storage-list');
      const entries = Array.isArray(data) ? data : [];
      for (const value of entries) {
        if (!value || typeof value !== 'object' || typeof value.name !== 'string') throw new Error('storage-entry');
        const path = `${prefix}/${value.name}`;
        if (!validStoragePath(baseId, path)) throw new Error('storage-path');
        if (value.id) objects.add(path);
        else queue.push(path);
      }
      if (entries.length < LIST_PAGE_SIZE) break;
      offset += LIST_PAGE_SIZE;
    }
  }
  return [...objects];
}

async function listAllBuckets(admin: SupabaseClient, baseId: string): Promise<PurgeObject[]> {
  const all: PurgeObject[] = [];
  for (const bucket of BUCKETS) {
    for (const path of await listBucket(admin, bucket, baseId)) all.push({ bucket, path });
  }
  return all;
}

async function removeObjects(admin: SupabaseClient, objects: PurgeObject[]): Promise<void> {
  const byBucket = new Map<Bucket, string[]>();
  for (const object of objects) {
    const paths = byBucket.get(object.bucket) ?? [];
    paths.push(object.path);
    byBucket.set(object.bucket, paths);
  }
  for (const [bucket, paths] of byBucket) {
    const unique = [...new Set(paths)];
    for (let i = 0; i < unique.length; i += REMOVE_BATCH_SIZE) {
      const { error } = await admin.storage.from(bucket).remove(unique.slice(i, i + REMOVE_BATCH_SIZE));
      if (error) throw new Error('storage-remove');
    }
  }
}

function businessError(row: PurgeRow, fallback: string): Response {
  const code = typeof row.code === 'string' ? row.code : undefined;
  return json(statusForCode(code), { error: codeMessage(code, fallback), code });
}

export async function handlePurgeDeletedBase(req: Request, deps: PurgeDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise.', code: 'AUTHENTICATION_REQUIRED' });

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonObject(req);
  } catch (error) {
    return validationResponse(error);
  }
  if (typeof payload.baseId !== 'string' || !UUID_RE.test(payload.baseId)) {
    return json(400, { error: 'baseId invalide', code: 'PURGE_OPERATION_INVALID' });
  }
  if (typeof payload.operationId !== 'string' || !UUID_RE.test(payload.operationId)) {
    return json(400, { error: 'operationId invalide', code: 'PURGE_OPERATION_INVALID' });
  }
  const baseId = payload.baseId;
  const requestedOperationId = payload.operationId;

  let asUser: SupabaseClient;
  let admin: SupabaseClient;
  try {
    ({ asUser, admin } = deps.buildClients(auth));
  } catch {
    return json(500, { error: 'Configuration serveur indisponible', code: 'SERVER_CONFIGURATION' });
  }

  const { data: who, error: userError } = await asUser.auth.getUser();
  if (userError || !who?.user?.id) return json(401, { error: 'Session invalide.', code: 'AUTHENTICATION_REQUIRED' });

  const { data: preparedData, error: prepareError } = await asUser.rpc('prepare_base_purge', {
    p_base_id: baseId,
    p_operation_id: requestedOperationId,
  });
  if (prepareError) {
    return json(500, { error: 'Préparation de la purge impossible.', code: 'PURGE_PREPARE_FAILED' });
  }
  const prepared = rowOf(preparedData);
  if (!prepared) return json(500, { error: 'Réponse de purge invalide.', code: 'PURGE_PREPARE_FAILED' });
  if (prepared.status === 'completed' || prepared.code === 'ALREADY_PURGED') {
    return json(200, { status: 'already_purged', code: 'ALREADY_PURGED' });
  }
  if (prepared.status === 'rejected') return businessError(prepared, 'La purge ne peut pas être lancée.');

  const operationId = typeof prepared.operation_id === 'string' ? prepared.operation_id : null;
  const manifestHash = typeof prepared.manifest_hash === 'string' ? prepared.manifest_hash : null;
  const manifestObjects = parseManifest(baseId, prepared.manifest);
  if (!operationId || !manifestHash || !manifestObjects) {
    return json(409, {
      error: 'Les fichiers de cette base ne peuvent pas être vérifiés en sécurité.',
      code: 'STORAGE_MANIFEST_INVALID',
    });
  }

  let listed: PurgeObject[];
  try {
    listed = await listAllBuckets(admin, baseId);
  } catch {
    return json(503, {
      error: 'Vérification Storage indisponible. Aucune donnée PostgreSQL n’a été supprimée.',
      code: 'STORAGE_LIST_FAILED',
    });
  }

  try {
    await removeObjects(admin, [...manifestObjects, ...listed]);
  } catch {
    return json(503, {
      error: 'Suppression Storage incomplète. Aucune donnée PostgreSQL n’a été supprimée ; la purge peut être reprise.',
      code: 'STORAGE_DELETE_FAILED',
    });
  }

  let remaining: PurgeObject[];
  try {
    remaining = await listAllBuckets(admin, baseId);
  } catch {
    return json(503, {
      error: 'Vérification finale Storage indisponible. La purge reste en attente.',
      code: 'STORAGE_VERIFY_FAILED',
    });
  }
  if (remaining.length > 0) {
    return json(503, {
      error: 'Des fichiers Storage restent présents. La purge reste en attente et peut être reprise.',
      code: 'STORAGE_DELETE_INCOMPLETE',
    });
  }

  const { data: finalizedData, error: finalizeError } = await admin.rpc('finalize_base_purge', {
    p_operation_id: operationId,
    p_manifest_hash: manifestHash,
    p_actor_id: who.user.id,
  });
  if (finalizeError) {
    return json(503, {
      error: 'Finalisation PostgreSQL indisponible. Les fichiers sont supprimés et la purge peut être reprise.',
      code: 'DATABASE_FINALIZE_FAILED',
    });
  }
  const finalized = rowOf(finalizedData);
  if (!finalized) {
    return json(503, {
      error: 'Réponse de finalisation invalide. La purge peut être reprise.',
      code: 'DATABASE_FINALIZE_FAILED',
    });
  }
  if (finalized.status === 'completed' || finalized.code === 'PURGED' || finalized.code === 'ALREADY_PURGED') {
    return json(200, {
      status: 'purged',
      code: finalized.code ?? 'PURGED',
      operationId,
      patientCount: prepared.patient_count ?? 0,
      encounterCount: prepared.encounter_count ?? 0,
      documentCount: prepared.document_count ?? 0,
      attachmentCount: prepared.attachment_count ?? 0,
      exportCount: prepared.export_count ?? 0,
    });
  }
  return businessError(finalized, 'La finalisation de la purge a été refusée.');
}
