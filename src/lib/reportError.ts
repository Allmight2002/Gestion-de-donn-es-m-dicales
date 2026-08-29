import { supabase } from './supabase';

// Le journal d'incidents ne doit jamais devenir un journal de contenu. Le navigateur ne
// conserve ni ne transmet donc le message brut : seulement un nom d'erreur, un résumé fixe
// et des emplacements de pile nettoyés. PostgreSQL applique la même réduction par défense
// en profondeur.
export const ERROR_CONTEXTS = ['react-render', 'unhandled-rejection', 'window-error', 'data-save', 'import', 'upload', 'export', 'auth'] as const;
export type ErrorContext = (typeof ERROR_CONTEXTS)[number];

export interface ClientErrorRecord {
  at: string;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  context: ErrorContext;
}

const RING_MAX = 20;
const MAX_SENDS_PER_MINUTE = 10;
const ring: ClientErrorRecord[] = [];
const sent = new Map<string, number>();

function safeName(error: unknown): string {
  const candidate = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name) ? error.name : 'ClientError';
  return candidate.slice(0, 80);
}

function safeFrames(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frames = stack.split('\n').slice(1).filter((line) => /^\s*at\s+/.test(line));
  const cleaned = frames.map((line) => line
    .replace(/\?.*?(?=\)|$)/g, '?…')
    .replace(/["'][^"']*["']/g, '…')
    .replace(/\b\d{6,}\b/g, '…')
    .slice(0, 240)).slice(0, 12);
  return cleaned.length ? cleaned.join('\n') : undefined;
}

function safeComponentStack(componentStack?: string): string | undefined {
  if (!componentStack) return undefined;
  return componentStack.split('\n').map((line) => line.replace(/\([^)]*\)/g, '(…)').slice(0, 120)).slice(0, 12).join('\n') || undefined;
}

function fingerprint(record: ClientErrorRecord): string {
  const text = `${record.name}|${record.context}|${record.stack ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

async function persist(record: ClientErrorRecord): Promise<void> {
  if (!supabase) return;
  const now = Date.now();
  const key = fingerprint(record);
  for (const [oldKey, at] of sent) if (now - at > 60_000) sent.delete(oldKey);
  if (sent.size >= MAX_SENDS_PER_MINUTE || sent.has(key)) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return; // v1 : jamais d'écriture anonyme.
  sent.set(key, now);
  const { error } = await supabase.rpc('record_client_error', {
    p_occurred_at: record.at,
    p_name: record.name,
    p_message: record.message,
    p_stack: record.stack ?? null,
    p_component_stack: record.componentStack ?? null,
    p_context: record.context,
    p_app_version: __APP_VERSION__ || null,
    p_severity: 'error',
  });
  if (error) sent.delete(key); // best effort ; aucun rapport d'erreur de rapport d'erreur.
}

export function reportClientError(error: unknown, componentStack?: string, context: ErrorContext = 'window-error'): void {
  const record: ClientErrorRecord = {
    at: new Date().toISOString(),
    name: safeName(error),
    message: 'Erreur technique côté client',
    stack: safeFrames(error instanceof Error ? error.stack : undefined),
    componentStack: safeComponentStack(componentStack),
    context,
  };
  ring.push(record);
  if (ring.length > RING_MAX) ring.shift();
  // Console minimale : utile localement sans exposer le message ou l'objet d'erreur brut.
  console.error('[client-error]', record.name, { context: record.context });
  void persist(record).catch(() => undefined);
}

export function recentClientErrors(): ClientErrorRecord[] {
  return [...ring];
}
