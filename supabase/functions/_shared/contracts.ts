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
    /**
     * Projection d'export par BLOCS (L53). `all` est le defaut et reproduit exactement le
     * comportement anterieur ; l'absence de l'option lui equivaut. Les cles designent des blocs
     * RACINES, jamais des sous-sections — le serveur refuse une cle qui designe une feuille.
     * La projection resolue est toujours renvoyee, donc toujours journalisee.
     */
    sectionProjection: { mode: 'all' | 'selected'; blockKeys?: string[] };
  };
}

/** Meme forme que `template_section.section_key` en base : un code, jamais un libelle. */
const SECTION_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;
/** Un gabarit a quelques dizaines de blocs ; au-dela, la demande n'est plus une projection. */
const MAX_PROJECTION_BLOCKS = 200;

/**
 * L53 : `mode: "selected"` sans `blockKeys` utilisable est refuse ICI, avant toute lecture de
 * cohorte. Les cles bien formees mais inconnues ou non racines sont refusees plus loin, par le
 * handler, qui seul connait les versions reellement presentes.
 */
function parseSectionProjection(raw: unknown): { mode: 'all' | 'selected'; blockKeys?: string[] } {
  if (raw === undefined || raw === null) return { mode: 'all' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RequestValidationError(400, 'sectionProjection invalide');
  }
  const projection = raw as Record<string, unknown>;
  const mode = projection.mode ?? 'all';
  if (mode !== 'all' && mode !== 'selected') throw new RequestValidationError(400, 'sectionProjection invalide');
  // `all` ignore les cles : la projection resolue et journalisee dit alors la verite du fichier.
  if (mode === 'all') return { mode: 'all' };
  const keys = projection.blockKeys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_PROJECTION_BLOCKS) {
    throw new RequestValidationError(400, 'sectionProjection invalide');
  }
  if (!keys.every((k) => typeof k === 'string' && SECTION_KEY_RE.test(k))) {
    throw new RequestValidationError(400, 'sectionProjection invalide');
  }
  return { mode: 'selected', blockKeys: [...new Set(keys as string[])].sort() };
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
  const sectionProjection = parseSectionProjection(options.sectionProjection);
  return {
    cohortId: body.cohortId,
    format: body.format ?? 'csv',
    options: { mode, rule, scope, profile, sectionProjection },
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
