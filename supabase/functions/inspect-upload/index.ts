// @ts-nocheck - Fonction Edge Supabase (runtime Deno), hors build Vite.
//
// Inspection serveur des fichiers uploades :
//   1) autorise l'appel via la RLS avec le JWT utilisateur ;
//   2) retelecharge l'objet avec la cle service_role ;
//   3) recalcule hash/taille/type reel par magic bytes ;
//   4) appelle un scanner HTTP ClamAV ;
//   5) promeut la ligne en `accepted` ou `quarantined` cote serveur uniquement.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const EXPECTED_CONTAINER: Record<string, string> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
  doc: 'ole',
  xls: 'ole',
  docx: 'zip',
  xlsx: 'zip',
};
const MIME_BY_CONTAINER: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
  ole: 'application/x-ole-storage',
};
const MAX_INSPECT_BYTES = Number(Deno.env.get('MAX_INSPECT_UPLOAD_BYTES') ?? String(20 * 1024 * 1024));
const SCANNING_STALE_MS = Number(Deno.env.get('INSPECTION_SCANNING_STALE_MS') ?? String(15 * 60 * 1000));

function detectContainer(h: Uint8Array): string | null {
  const at = (off: number, sig: number[]) => sig.every((b, i) => h[off + i] === b);
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  if (at(0, [0x50, 0x4b])) return 'zip';
  if (at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  return null;
}

const extOf = (path: string): string => (path.split('/').pop()?.split('.').pop() ?? '').toLowerCase();
const hex = (bytes: Uint8Array): string => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const isFiniteLimit = Number.isFinite(MAX_INSPECT_BYTES) && MAX_INSPECT_BYTES > 0;
const asciiBytes = (text: string): number[] => Array.from(text).map((c) => c.charCodeAt(0));

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = asciiBytes(needle);
  if (target.length === 0 || bytes.length < target.length) return false;
  for (let i = 0; i <= bytes.length - target.length; i += 1) {
    let ok = true;
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function officeSubtypeMatches(ext: string, bytes: Uint8Array): boolean {
  if (ext === 'docx') return containsAscii(bytes, '[Content_Types].xml') && containsAscii(bytes, 'word/');
  if (ext === 'xlsx') return containsAscii(bytes, '[Content_Types].xml') && containsAscii(bytes, 'xl/');
  return true;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)));
}

function metadataSize(row: Record<string, unknown> | null | undefined): number | null {
  const metadata = row?.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const size = (metadata as Record<string, unknown>).size ?? (metadata as Record<string, unknown>).contentLength;
  const parsed = typeof size === 'number' ? size : typeof size === 'string' ? Number(size) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

async function storageObjectSize(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<number | null> {
  const parts = path.split('/');
  const name = parts.pop();
  if (!name) return null;
  const prefix = parts.join('/');
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 100, search: name });
  const row = (data ?? []).find((item: Record<string, unknown>) => item.name === name) as Record<string, unknown> | undefined;
  return metadataSize(row);
}

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

async function scanWithClamAV(bytes: Uint8Array, filename: string): Promise<
  | { ok: true; infected: boolean; signature?: string }
  | { ok: false; error: string }
> {
  const scanUrl = Deno.env.get('CLAMAV_SCAN_URL');
  if (!scanUrl) return { ok: false, error: 'CLAMAV_SCAN_URL non configure' };

  const headers = new Headers({ 'content-type': 'application/octet-stream', 'x-filename': filename });
  const token = Deno.env.get('CLAMAV_SCAN_TOKEN');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const timeoutMs = Number(Deno.env.get('CLAMAV_SCAN_TIMEOUT_MS') ?? '30000');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 30000);
  try {
    const response = await fetch(scanUrl, { method: 'POST', headers, body: bytes, signal: controller.signal });
    if (!response.ok) return { ok: false, error: `Scanner indisponible (${response.status})` };
    const verdict = parseScannerVerdict(await response.json().catch(() => null));
    if (!verdict) return { ok: false, error: 'Verdict scanner illisible' };
    return { ok: true, infected: verdict.status === 'infected', signature: verdict.signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scanner indisponible';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let payload: { entity?: string; id?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Corps JSON requis' });
  }
  const { entity, id } = payload;
  if ((entity !== 'attachment' && entity !== 'raw_document') || !id) {
    return json(400, { error: 'entity (attachment|raw_document) et id sont requis' });
  }

  const URL = Deno.env.get('SUPABASE_URL')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  let table: 'clinical_attachment' | 'raw_document';
  let bucket: 'clinical-attachments' | 'raw-documents';
  let path: string;
  let baseId: string | null;
  let currentStatus: string;

  if (entity === 'raw_document') {
    const { data, error } = await asUser
      .from('raw_document')
      .select('id, base_id, storage_path, inspection_status')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' });
    table = 'raw_document';
    bucket = 'raw-documents';
    path = data.storage_path;
    baseId = data.base_id;
    currentStatus = data.inspection_status;
  } else {
    const { data, error } = await asUser
      .from('clinical_attachment')
      .select('id, patient_id, storage_path, inspection_status')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' });
    const { data: pat } = await admin.from('patient').select('base_id').eq('id', data.patient_id).maybeSingle();
    table = 'clinical_attachment';
    bucket = 'clinical-attachments';
    path = data.storage_path;
    baseId = pat?.base_id ?? null;
    currentStatus = data.inspection_status;
  }

  if (!baseId) return json(403, { error: 'Acces refuse' });
  if (!path.startsWith(`${baseId}/`)) return json(409, { error: 'Chemin fichier incoherent' });
  if (currentStatus === 'accepted') return json(200, { status: 'accepted', id });
  if (currentStatus === 'quarantined') return json(409, { status: 'quarantined', error: 'Fichier deja en quarantaine' });
  let lockFromStatus = 'pending';
  if (currentStatus === 'scanning') {
    const { data: locked } = await admin
      .from(table)
      .select('inspected_at')
      .eq('id', id)
      .maybeSingle();
    const lockedAt = locked?.inspected_at ? Date.parse(locked.inspected_at) : NaN;
    if (Number.isFinite(lockedAt) && Date.now() - lockedAt < SCANNING_STALE_MS) {
      return json(409, { status: 'scanning', error: 'Inspection deja en cours' });
    }
    lockFromStatus = 'scanning';
  } else if (currentStatus !== 'pending') {
    return json(409, { status: currentStatus, error: 'Statut non relancable par inspection serveur' });
  }

  const lockCutoff = new Date(Date.now() - SCANNING_STALE_MS).toISOString();
  let lockQuery = admin
    .from(table)
    .update({ inspection_status: 'scanning', inspected_at: new Date().toISOString() })
    .eq('id', id)
    .eq('inspection_status', lockFromStatus);
  if (lockFromStatus === 'scanning') lockQuery = lockQuery.lt('inspected_at', lockCutoff);
  const { data: lockedRows, error: lockErr } = await lockQuery.select('id');
  if (lockErr) return json(500, { error: 'Verrouillage de l inspection impossible' });
  if (!lockedRows || lockedRows.length !== 1) {
    return json(409, { status: 'scanning', error: 'Inspection deja en cours ou statut non relancable' });
  }

  const auditInspection = async (metadata: Record<string, unknown>) => {
    await admin.from('audit_log').insert({
      user_id: who.user.id,
      action: 'file_inspected',
      entity: table,
      entity_id: id,
      base_id: baseId,
      metadata,
    });
  };

  const quarantineTooLarge = async (fileSize: number) => {
    const { error } = await admin.from(table).update({
      inspection_status: 'quarantined',
      inspected_at: new Date().toISOString(),
      file_size: fileSize,
    }).eq('id', id);
    if (!error) {
      await auditInspection({
        status: 'quarantined',
        engine: 'size-limit',
        file_size: fileSize,
        max_size: MAX_INSPECT_BYTES,
        detected_mime_type: null,
        signature: null,
      });
    }
    return error;
  };

  if (isFiniteLimit) {
    const listedSize = await storageObjectSize(admin, bucket, path);
    if (listedSize !== null && listedSize > MAX_INSPECT_BYTES) {
      const quarantineErr = await quarantineTooLarge(listedSize);
      if (quarantineErr) return json(500, { error: 'Mise en quarantaine impossible' });
      return json(413, { status: 'quarantined', error: 'Fichier trop volumineux', fileSize: listedSize, maxSize: MAX_INSPECT_BYTES });
    }
  }

  const { data: fileBlob, error: downloadErr } = await admin.storage.from(bucket).download(path);
  if (downloadErr || !fileBlob) {
    await admin.from(table).update({ inspection_status: 'pending', inspected_at: null }).eq('id', id);
    return json(500, { error: downloadErr?.message ?? 'Telechargement du fichier impossible' });
  }
  if (isFiniteLimit && fileBlob.size > MAX_INSPECT_BYTES) {
    const quarantineErr = await quarantineTooLarge(fileBlob.size);
    if (quarantineErr) return json(500, { error: 'Mise en quarantaine impossible' });
    return json(413, { status: 'quarantined', error: 'Fichier trop volumineux', fileSize: fileBlob.size, maxSize: MAX_INSPECT_BYTES });
  }

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const fileHash = await sha256Hex(bytes);
  const fileSize = bytes.byteLength;
  const ext = extOf(path);
  const detectedContainer = detectContainer(bytes.slice(0, 16));
  const expectedContainer = EXPECTED_CONTAINER[ext];
  const detectedMimeType = detectedContainer && expectedContainer === detectedContainer
    ? MIME_BY_EXT[ext]
    : detectedContainer ? (MIME_BY_CONTAINER[detectedContainer] ?? null) : null;
  const inspectedAt = new Date().toISOString();

  const mark = async (status: 'accepted' | 'quarantined', extra: Record<string, unknown> = {}, signature?: string) => {
    const updateResult = await admin.from(table).update({
      inspection_status: status,
      inspected_at: inspectedAt,
      file_hash: fileHash,
      file_size: fileSize,
      detected_mime_type: detectedMimeType,
      ...extra,
    }).eq('id', id);
    if (!updateResult.error) {
      await auditInspection({
        status,
        engine: 'clamav',
        file_hash: fileHash,
        file_size: fileSize,
        detected_mime_type: detectedMimeType,
        signature: signature ?? null,
      });
    }
    return updateResult;
  };

  if (!expectedContainer || detectedContainer !== expectedContainer) {
    const { error } = await mark('quarantined');
    if (error) return json(500, { error: 'Mise en quarantaine impossible' });
    return json(409, {
      status: 'quarantined',
      error: 'Type de fichier incoherent',
      detectedContainer,
      expectedContainer: expectedContainer ?? null,
    });
  }
  if (!officeSubtypeMatches(ext, bytes)) {
    const { error } = await mark('quarantined');
    if (error) return json(500, { error: 'Mise en quarantaine impossible' });
    return json(409, { status: 'quarantined', error: 'Sous-format Office incoherent', ext });
  }

  const verdict = await scanWithClamAV(bytes, path.split('/').pop() ?? path);
  if (!verdict.ok) {
    await admin.from(table).update({ inspection_status: 'pending', inspected_at: null }).eq('id', id);
    return json(503, { error: verdict.error });
  }

  if (verdict.infected) {
    const { error } = await mark('quarantined', {}, verdict.signature);
    if (error) return json(500, { error: 'Mise en quarantaine impossible' });
    return json(409, { status: 'quarantined', error: 'Fichier infecte', signature: verdict.signature });
  }

  const { error } = await mark('accepted', { mime_type: MIME_BY_EXT[ext] });
  if (error) return json(500, { error: 'Validation serveur impossible' });
  return json(200, { status: 'accepted', id, fileHash, fileSize, detectedMimeType: MIME_BY_EXT[ext] });
});
