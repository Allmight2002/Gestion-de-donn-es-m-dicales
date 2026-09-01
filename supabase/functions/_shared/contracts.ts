export const MAX_JSON_BYTES = 16 * 1024;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RequestValidationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export async function readJsonObject(req: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') throw new RequestValidationError(415, 'Content-Type application/json requis');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestValidationError(413, 'Corps JSON trop volumineux');
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RequestValidationError(413, 'Corps JSON trop volumineux');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RequestValidationError(400, 'Corps JSON invalide');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestValidationError(400, 'Objet JSON requis');
  }
  return value as Record<string, unknown>;
}

export function validationResponse(error: unknown): Response {
  const validation = error instanceof RequestValidationError
    ? error
    : new RequestValidationError(400, 'Requete invalide');
  return new Response(JSON.stringify({ error: validation.message }), {
    status: validation.status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'content-type': 'application/json',
    },
  });
}

export function requiredEnv(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Configuration serveur manquante: ${name}`);
    return [name, value];
  }));
}

export function supabaseEnvironment(): { url: string; anonKey: string; serviceRoleKey: string } {
  const env = requiredEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  return {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export type DocumentEntity = 'attachment' | 'raw_document';
export type SignedReadEntity = DocumentEntity | 'export';

export function parseEntityId(
  body: Record<string, unknown>,
  entities: readonly string[],
): { entity: string; id: string } {
  if (
    typeof body.entity !== 'string' || !entities.includes(body.entity) ||
    typeof body.id !== 'string' || !UUID_RE.test(body.id)
  ) {
    throw new RequestValidationError(400, 'entity ou id invalide');
  }
  return { entity: body.entity, id: body.id };
}

export interface ExportRequest {
  cohortId: string;
  format: 'csv' | 'xlsx';
  options: {
    mode: 'patient' | 'encounter';
    rule: 'first' | 'last';
    scope: 'matching' | 'all' | 'both';
    /**
     * Profil d'export (L45). `analysis` est le profil par defaut du parcours quotidien ;
     * `complete` conserve la structure technique pendant la transition. Un appel sans
     * profil produit donc toujours Analyse.
     */
    profile: 'analysis' | 'complete';
  };
}

export function parseExportRequest(body: Record<string, unknown>): ExportRequest {
  if (typeof body.cohortId !== 'string' || !UUID_RE.test(body.cohortId)) {
    throw new RequestValidationError(400, 'cohortId invalide');
  }
  if (body.format !== undefined && body.format !== 'csv' && body.format !== 'xlsx') {
    throw new RequestValidationError(400, 'format invalide');
  }
  const raw = body.options;
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new RequestValidationError(400, 'options invalides');
  }
  const options = (raw ?? {}) as Record<string, unknown>;
  const mode = options.mode ?? 'encounter';
  const rule = options.rule ?? 'last';
  const scope = options.scope ?? 'matching';
  const profile = options.profile ?? 'analysis';
  if (
    !['patient', 'encounter'].includes(String(mode)) || !['first', 'last'].includes(String(rule)) ||
    !['matching', 'all', 'both'].includes(String(scope)) ||
    !['analysis', 'complete'].includes(String(profile))
  ) throw new RequestValidationError(400, 'options invalides');
  return {
    cohortId: body.cohortId,
    format: body.format ?? 'csv',
    options: { mode, rule, scope, profile },
  } as ExportRequest;
}

export function parseReconcileRequest(body: Record<string, unknown>): { limit: number } {
  if (
    body.limit !== undefined && (!Number.isInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 100)
  ) {
    throw new RequestValidationError(400, 'limit doit etre un entier entre 1 et 100');
  }
  return { limit: Number(body.limit ?? 25) };
}
