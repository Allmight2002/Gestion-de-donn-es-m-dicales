// Infrastructure de test LEGERE pour exercer les handlers Edge sans deployer ni contacter Supabase.
// Fournit : un faux client Supabase pilote par un « responder », un constructeur de Request et des
// utilitaires d'assertion (lecture de reponse, absence de secret). Aucune seconde implementation du
// comportement metier : seuls les effets externes (DB, Storage, RPC, auth) sont simules.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DbResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}

export interface FromCall {
  role: string;
  kind: 'from';
  table: string;
  ops: Array<{ m: string; a: unknown[] }>;
}
export interface RpcCall {
  role: string;
  kind: 'rpc';
  rpc: string;
  params: unknown;
}
export interface StorageCall {
  role: string;
  kind: 'storage';
  bucket: string;
  method: string;
  args: unknown[];
}
export type ClientCall = FromCall | RpcCall | StorageCall;
export type Responder = (call: ClientCall) => DbResult | Promise<DbResult>;

const ok = (data: unknown, count?: number | null): DbResult => ({
  data,
  error: null,
  count: count === undefined ? (Array.isArray(data) ? data.length : null) : count,
});
const fail = (error: unknown): DbResult => ({ data: null, error });
export const okResult = ok;
export const errorResult = fail;

// Constructeur de requete PostgREST simule : chaine fluide qui ENREGISTRE les operations puis delegue
// la resolution au responder du test. Il est « thenable » (comme le builder supabase-js) donc
// `await client.from(t).update(x).eq(...).select('id')` fonctionne, tout comme `.maybeSingle()`.
class FakeQuery implements PromiseLike<DbResult> {
  private readonly ops: Array<{ m: string; a: unknown[] }> = [];
  constructor(
    private readonly table: string,
    private readonly role: string,
    private readonly responder: Responder,
  ) {}
  private chain(m: string, ...a: unknown[]): this {
    this.ops.push({ m, a });
    return this;
  }
  select(...a: unknown[]): this {
    return this.chain('select', ...a);
  }
  insert(...a: unknown[]): this {
    return this.chain('insert', ...a);
  }
  update(...a: unknown[]): this {
    return this.chain('update', ...a);
  }
  delete(...a: unknown[]): this {
    return this.chain('delete', ...a);
  }
  upsert(...a: unknown[]): this {
    return this.chain('upsert', ...a);
  }
  eq(...a: unknown[]): this {
    return this.chain('eq', ...a);
  }
  neq(...a: unknown[]): this {
    return this.chain('neq', ...a);
  }
  is(...a: unknown[]): this {
    return this.chain('is', ...a);
  }
  in(...a: unknown[]): this {
    return this.chain('in', ...a);
  }
  lt(...a: unknown[]): this {
    return this.chain('lt', ...a);
  }
  gt(...a: unknown[]): this {
    return this.chain('gt', ...a);
  }
  order(...a: unknown[]): this {
    return this.chain('order', ...a);
  }
  limit(...a: unknown[]): this {
    return this.chain('limit', ...a);
  }
  range(...a: unknown[]): this {
    return this.chain('range', ...a);
  }
  private run(): Promise<DbResult> {
    return Promise.resolve(this.responder({ role: this.role, kind: 'from', table: this.table, ops: this.ops }));
  }
  maybeSingle(): Promise<DbResult> {
    this.ops.push({ m: 'maybeSingle', a: [] });
    return this.run();
  }
  single(): Promise<DbResult> {
    this.ops.push({ m: 'single', a: [] });
    return this.run();
  }
  then<R1 = DbResult, R2 = never>(
    onfulfilled?: ((value: DbResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

class FakeStorageBucket {
  constructor(
    private readonly bucket: string,
    private readonly role: string,
    private readonly responder: Responder,
  ) {}
  private call(method: string, args: unknown[]): Promise<DbResult> {
    return Promise.resolve(this.responder({ role: this.role, kind: 'storage', bucket: this.bucket, method, args }));
  }
  createSignedUrl(path: string, expiresIn: number, options?: { download?: string | boolean }): Promise<DbResult> {
    return this.call('createSignedUrl', [path, expiresIn, options]);
  }
  download(path: string): Promise<DbResult> {
    return this.call('download', [path]);
  }
  upload(path: string, body: unknown, options?: unknown): Promise<DbResult> {
    return this.call('upload', [path, body, options]);
  }
  remove(paths: string[]): Promise<DbResult> {
    return this.call('remove', [paths]);
  }
  list(path?: string, options?: unknown): Promise<DbResult> {
    return this.call('list', [path, options]);
  }
}

export interface FakeClientConfig {
  role: string;
  user?: { data: { user: { id: string } | null }; error?: unknown };
  responder?: Responder;
}

/** Construit un faux SupabaseClient structurellement compatible (cast localise, code de test uniquement). */
export function fakeSupabaseClient(config: FakeClientConfig): SupabaseClient {
  const responder: Responder = config.responder ?? (() => ok(null));
  const client = {
    auth: {
      getUser: () => Promise.resolve(config.user ?? { data: { user: null }, error: null }),
    },
    from: (table: string) => new FakeQuery(table, config.role, responder),
    rpc: (name: string, params?: unknown) =>
      Promise.resolve(responder({ role: config.role, kind: 'rpc', rpc: name, params })),
    storage: {
      from: (bucket: string) => new FakeStorageBucket(bucket, config.role, responder),
    },
  };
  return client as unknown as SupabaseClient;
}

export interface RequestOptions {
  method?: string;
  auth?: string | null;
  body?: unknown;
  contentType?: string | null;
  url?: string;
}

/** Requete de test. Par defaut POST + Authorization + JSON, chacun surchargeable pour couvrir les rejets. */
export function makeRequest(options: RequestOptions = {}): Request {
  const headers = new Headers();
  if (options.auth !== null) headers.set('Authorization', options.auth ?? 'Bearer test-jwt');
  const hasBody = options.body !== undefined;
  const contentType = options.contentType === undefined ? (hasBody ? 'application/json' : null) : options.contentType;
  if (contentType) headers.set('content-type', contentType);
  const init: RequestInit = { method: options.method ?? 'POST', headers };
  if (hasBody) init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  return new Request(options.url ?? 'http://edge.local', init);
}

/** Lit statut + corps JSON d'une reponse handler. */
export async function readResponse(
  res: Response,
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, text };
}

/** Echoue si l'un des secrets apparait dans le texte fourni (reponse HTTP ou log capture). */
export function assertNoSecret(text: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (secret && text.includes(secret)) {
      throw new Error(`Fuite de secret detectee: « ${secret} » present dans « ${text.slice(0, 200)} »`);
    }
  }
}

/** Capture console.error/console.log le temps d'un appel, pour prouver l'absence de fuite dans les logs. */
export async function captureLogs(run: () => Promise<Response>): Promise<{ response: Response; logs: string }> {
  const lines: string[] = [];
  const original = { error: console.error, log: console.log, warn: console.warn };
  const sink = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.error = sink;
  console.log = sink;
  console.warn = sink;
  try {
    const response = await run();
    return { response, logs: lines.join('\n') };
  } finally {
    console.error = original.error;
    console.log = original.log;
    console.warn = original.warn;
  }
}
