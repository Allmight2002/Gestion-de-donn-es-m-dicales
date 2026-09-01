// Inspection serveur des fichiers uploades : adaptateur mince. Toute la logique (verrou d'execution,
// magic-bytes, sous-format Office, scan ClamAV, quarantaine physique + verdict SQL, restauration
// journalisee) est dans handler.ts, testee sans deploiement. Cet adaptateur branche les dependances
// reelles : clients Supabase, scanner ClamAV (HTTP), horloge, id, configuration issue de Deno.env.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleInspectUpload, type ScanResult } from './handler.ts';

function parseScannerVerdict(body: unknown): { status: 'clean' | 'infected'; signature?: string } | null {
  if (!body || typeof body !== 'object') return null;
  const status = (body as { status?: unknown }).status;
  if (status === 'clean' || status === 'infected') {
    const signature = (body as { signature?: unknown }).signature;
    return { status, signature: typeof signature === 'string' ? signature : undefined };
  }
  const clean = (body as { clean?: unknown }).clean;
  if (clean === true) return { status: 'clean' };
  if (clean === false) {
    const signature = (body as { signature?: unknown }).signature;
    return { status: 'infected', signature: typeof signature === 'string' ? signature : undefined };
  }
  return null;
}

// Scan HTTP ClamAV : effet externe injecte dans le handler. Lit sa configuration dans Deno.env et
// ne fuite jamais le token vers la reponse (seul un message generique remonte).
async function scanWithClamAV(bytes: Uint8Array, filename: string): Promise<ScanResult> {
  const scanUrl = Deno.env.get('CLAMAV_SCAN_URL');
  if (!scanUrl) return { ok: false, error: 'CLAMAV_SCAN_URL non configure' };

  const headers = new Headers({ 'content-type': 'application/octet-stream', 'x-filename': filename });
  const token = Deno.env.get('CLAMAV_SCAN_TOKEN');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const timeoutMs = Number(Deno.env.get('CLAMAV_SCAN_TIMEOUT_MS') ?? '30000');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 30000);
  try {
    const response = await fetch(scanUrl, {
      method: 'POST',
      headers,
      body: Uint8Array.from(bytes).buffer,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `Scanner indisponible (${response.status})` };
    const verdict = parseScannerVerdict(await response.json().catch(() => null));
    if (!verdict) return { ok: false, error: 'Verdict scanner illisible' };
    return { ok: true, infected: verdict.status === 'infected', signature: verdict.signature };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof DOMException && error.name === 'AbortError'
        ? 'Scanner en timeout'
        : 'Scanner indisponible',
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve((req: Request) =>
  handleInspectUpload(req, {
    buildClients: (auth) => {
      const env = supabaseEnvironment();
      return {
        asUser: createClient(env.url, env.anonKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false },
        }),
        admin: createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } }),
      };
    },
    config: {
      maxInspectBytes: Number(Deno.env.get('MAX_INSPECT_UPLOAD_BYTES') ?? String(20 * 1024 * 1024)),
      scanningStaleMs: Number(Deno.env.get('INSPECTION_SCANNING_STALE_MS') ?? String(15 * 60 * 1000)),
      maxInspectionAttempts: Number(Deno.env.get('MAX_INSPECTION_ATTEMPTS') ?? '5'),
      inspectionRetryCooldownMs: Number(Deno.env.get('INSPECTION_RETRY_COOLDOWN_MS') ?? '60000'),
      quarantineBucket: Deno.env.get('QUARANTINE_BUCKET') ?? 'quarantined-uploads',
    },
    scan: scanWithClamAV,
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  })
);
