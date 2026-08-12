// =============================================================================
// Preflight clinique E2E (audits v18-v20 §8.3) : rejoue la CHAINE DOCUMENTAIRE
// complete contre l'environnement STAGING — jamais la prod. Prouve sur du vrai
// cloud ce que les tests embarques ne peuvent pas voir : policies storage.objects
// reelles, limites de taille, Edge Functions deployees, URLs signees, quarantaine
// physique inter-buckets, scanner ClamAV.
//
//   node scripts/e2e-staging.mjs          (ou : npm run e2e:staging)
//
// Prerequis : .env.staging rempli (local, gitignore) et un mode d'inspection COHERENT
// avec la base visee. Le script REFUSE de viser un projet non-staging.
//
//   INSPECTION_MODE=strict (defaut) : mode strict actif en base, secrets Edge poses,
//     scanner ClamAV joignable par l'Edge (tunnel) -> les 6 familles sont jouees.
//   INSPECTION_MODE=paused : aucun scanner. Les familles qui DEPENDENT du verdict
//     antivirus ne sont pas jouees et sont declarees NON EXECUTEES — jamais comptees
//     comme vertes. Le reste de la chaine documentaire (ticket, policies Storage,
//     limites de taille, URL signee) reste prouve.
// =============================================================================
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  INSPECTION_MODE_ERROR,
  INSPECTION_PAUSED,
  inspectionPauseBanner,
  readInspectionMode,
} from './inspection-mode.mjs';

const INSPECTION_MODE = readInspectionMode(process.env);
if (!INSPECTION_MODE) { console.error(`✗ ${INSPECTION_MODE_ERROR}`); process.exit(1); }
const SCANNER_PAUSED = INSPECTION_MODE === INSPECTION_PAUSED;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ---- .env.staging -----------------------------------------------------------
const env = {};
try { for (const line of readFileSync(join(ROOT, '.env.staging'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
} } catch { /* CI injecte les secrets sans les ecrire sur disque. */ }
const need = (k) => {
  if (process.env[k]) return process.env[k];
  if (!env[k]) { console.error(`✗ ${k} manquant dans .env.staging`); process.exit(1); }
  return env[k];
};
const SUPA_URL = need('STAGING_SUPABASE_URL');
const ANON = need('STAGING_SUPABASE_ANON_KEY');
const SERVICE = need('STAGING_SUPABASE_SERVICE_ROLE_KEY');
const DB_URL = need('STAGING_SUPABASE_DB_URL');
const EMAIL = need('STAGING_MEDECIN_EMAIL');
const PASSWORD = need('STAGING_MEDECIN_PASSWORD');

// Garde-fou anti-prod : ce script ne vise QUE le projet staging connu.
if (!SUPA_URL.includes('gmsxrniiclrheehhoakn')) {
  console.error('✗ STAGING_SUPABASE_URL ne pointe pas vers le projet staging attendu — abandon.');
  process.exit(1);
}

// ---- contenus de test ---------------------------------------------------------
// CALIBRATION (2026-07-09, scanner local) : un EICAR en COMMENTAIRE d'un PDF est juge
// "clean" par clamd (conforme a la spec EICAR : detection au DEBUT de fichier). Pour
// exercer le verdict CLAMAV de bout en bout, on place EICAR DANS UNE ARCHIVE : clamd
// scanne les archives, et un .docx est un ZIP -> passe le controle magic-bytes de l'Edge.
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;
const PDF_CLEAN = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n`);
const RAW_EICAR = Buffer.from(EICAR);
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function crc32(buf) {
  let t = crc32.t;
  if (!t) {
    t = crc32.t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ZIP minimal a entrees STOCKEES (sans compression) — construit a l'EXECUTION pour ne
// jamais committer d'octets que des antivirus de poste pourraient signaler. Les entrees
// [Content_Types].xml et word/ rendent l'archive conforme au controle de sous-format
// Office de l'Edge (officeSubtypeMatches) -> le fichier ATTEINT le scanner ClamAV.
function zipMulti(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name, 'ascii');
    const crc = crc32(data);
    const lf = Buffer.alloc(30);
    lf.writeUInt32LE(0x04034b50, 0);
    lf.writeUInt16LE(20, 4);
    lf.writeUInt32LE(crc, 14);
    lf.writeUInt32LE(data.length, 18);
    lf.writeUInt32LE(data.length, 22);
    lf.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(lf, n, data);
    centrals.push(Buffer.concat([cd, n]));
    offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}
const DOCX_EICAR = zipMulti([
  { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
  { name: 'word/document.xml', data: Buffer.from('<document/>') },
  { name: 'eicar.com', data: RAW_EICAR },
]);

// ---- clients ------------------------------------------------------------------
const admin = new pg.Client({ connectionString: DB_URL });
const user = createClient(SUPA_URL, ANON, { auth: { persistSession: false } });
const service = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const skipped = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
// Un scenario non joue n'est ni vert ni rouge : il est ABSENT, et le rapport le dit.
function skip(name, reason) {
  skipped.push({ name, reason });
  console.log(`⏭️  NON EXECUTE  ${name} — ${reason}`);
}

// Scenario qui DEPEND du verdict antivirus : joue tel quel en mode strict, declare non
// execute quand l'inspection est suspendue. Jamais transforme en succes par defaut.
async function scannerScenario(name, run) {
  if (SCANNER_PAUSED) {
    skip(name, 'aucun scanner joignable (INSPECTION_MODE=paused)');
    return;
  }
  try {
    await run();
  } catch (e) {
    report(name, false, e.message);
  }
}

async function edge(fn, body) {
  const { data, error } = await user.functions.invoke(fn, { body });
  if (!error) return { status: 200, data };
  const ctx = error.context;
  if (ctx && typeof ctx.status === 'number') {
    let payload = null;
    try { payload = await ctx.clone().json(); } catch { /* corps non-JSON */ }
    return { status: ctx.status, data: payload };
  }
  return { status: 0, data: null, error: String(error.message ?? error) };
}

const q = (sql, params) => admin.query(sql, params).then((r) => r.rows);

// ---- fixtures idempotentes (admin, donnees jetables marquees E2E) ---------------
async function ensureFixture(medecinId) {
  let tpl = (await q(`select id from public.template where name='E2E Staging' and owner_user_id=$1`, [medecinId]))[0];
  if (!tpl) tpl = (await q(
    `insert into public.template(name, specialty, owner_user_id, is_global) values('E2E Staging','e2e',$1,false) returning id`,
    [medecinId]))[0];
  let ver = (await q(`select id from public.template_version where template_id=$1`, [tpl.id]))[0];
  if (!ver) ver = (await q(
    `insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id`,
    [tpl.id, medecinId]))[0];
  let base = (await q(`select id from public.base where name='E2E-base' and owner_user_id=$1`, [medecinId]))[0];
  if (!base) base = (await q(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id) values('E2E-base','e2e',$1,$2) returning id`,
    [medecinId, ver.id]))[0];
  let patient = (await q(`select id from public.patient where base_id=$1 and patient_code='E2E-P1'`, [base.id]))[0];
  if (!patient) patient = (await q(
    `insert into public.patient(base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values($1,'E2E-P1',$2,'{}'::jsonb,'direct','draft',$3) returning id`,
    [base.id, ver.id, medecinId]))[0];
  return { baseId: base.id, patientId: patient.id };
}

// ---- brique commune : ticket -> upload -> ligne metier -------------------------
async function uploadAttachment({ baseId, patientId }, bytes, label, status = 'pending', ext = 'pdf', mime = 'application/pdf') {
  if (status !== 'pending' && status !== 'accepted_client') throw new Error('Statut E2E invalide');
  const key = randomUUID();
  const path = `${baseId}/e2e/${key}.${ext}`;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { data: operationRows, error: te } = await user.rpc('create_upload_operation', {
    p_base_id: baseId, p_bucket: 'clinical-attachments', p_path: path,
    p_idempotency_key: key, p_file_hash: hash, p_file_size: bytes.byteLength, p_mime_type: mime,
  });
  if (te) throw new Error(`operation upload: ${te.message}`);
  const operation = Array.isArray(operationRows) ? operationRows[0] : operationRows;
  const { error: ue } = await user.storage.from('clinical-attachments')
    .upload(path, bytes, { contentType: mime });
  if (ue) throw new Error(`upload: ${ue.message}`);
  const finalized = await edge('finalize-upload', {
    ticketId: operation.ticket_id, entity: 'attachment',
    metadata: { patient_id: patientId, kind: 'document', label },
  });
  if (finalized.status !== 200 || !finalized.data?.id) {
    throw new Error(`finalize-upload: ${JSON.stringify(finalized.data ?? finalized.error ?? finalized.status)}`);
  }
  // Fixture historique explicite : le client courant ne peut plus creer ce
  // statut, mais le test de reprise doit encore couvrir les anciennes lignes.
  if (status === 'accepted_client') {
    await q('update public.clinical_attachment set inspection_status=$1 where id=$2', [status, finalized.data.id]);
  }
  return { id: finalized.data.id, path, ticket: operation.ticket_id };
}

async function main() {
  await admin.connect();

  // 0) Le mode declare doit correspondre a la valeur REELLE en base, dans les deux sens.
  const strict = (await q('select public.require_server_inspection() as s'))[0].s === true;
  if (SCANNER_PAUSED) {
    if (strict) {
      console.error('✗ INSPECTION_MODE=paused mais require_server_inspection() = true : la base exige encore un verdict serveur, les uploads resteraient bloques. Suspendez-la d\'abord (npm run inspection:pause -- --target=staging).');
      process.exit(1);
    }
    console.log(inspectionPauseBanner('staging'));
  } else if (!strict) {
    console.error('✗ require_server_inspection() = false sur le staging : activez le mode strict avant le preflight (ordre d\'activation, docs/deploiement.md).');
    process.exit(1);
  } else {
    console.log('Mode strict actif sur le staging ✓');
  }

  const { data: auth, error: ae } = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (ae) { console.error(`✗ connexion medecin staging impossible : ${ae.message}`); process.exit(1); }
  const medecinId = auth.user.id;
  const fx = await ensureFixture(medecinId);
  console.log(`Fixture E2E prete (base ${fx.baseId})\n`);

  // 1) Fichier SAIN : verdict serveur (strict) ou statut client (pause) -> URL signee -> octets relus.
  try {
    const a = await uploadAttachment(fx, PDF_CLEAN, 'E2E sain');
    if (SCANNER_PAUSED) {
      const row = (await q('select inspection_status from public.clinical_attachment where id=$1', [a.id]))[0];
      report('sain : chaine documentaire -> accepted_client (AUCUN verdict antivirus)', row.inspection_status === 'accepted_client', row.inspection_status);
      skip('sain : inspect-upload -> accepted', 'verdict serveur indisponible (INSPECTION_MODE=paused)');
    } else {
      const insp = await edge('inspect-upload', { entity: 'attachment', id: a.id });
      const accepted = insp.data?.status === 'accepted';
      report('sain : inspect-upload -> accepted', accepted, JSON.stringify(insp.data));
    }
    const sr = await edge('signed-read', { entity: 'attachment', id: a.id });
    const url = sr.data?.url;
    let fetched = false;
    if (url) {
      const res = await fetch(url);
      fetched = res.ok && (await res.text()).startsWith('%PDF');
    }
    report('sain : signed-read -> URL signee -> octets relus', Boolean(url) && fetched);
  } catch (e) { report('sain : chaine complete', false, e.message); }

  // 2) EICAR dans un ZIP nomme .docx : verdict CLAMAV -> quarantaine PHYSIQUE.
  await scannerScenario('eicar(docx) : chaine quarantaine', async () => {
    const b = await uploadAttachment(fx, DOCX_EICAR, 'E2E eicar-docx', 'pending', 'docx', WORD_MIME);
    const insp = await edge('inspect-upload', { entity: 'attachment', id: b.id });
    report('eicar(docx) : inspect-upload -> quarantined (verdict clamav)', insp.data?.status === 'quarantined', JSON.stringify(insp.data));
    const row = (await q('select inspection_status, quarantine_bucket, quarantine_path from public.clinical_attachment where id=$1', [b.id]))[0];
    report('eicar(docx) : ligne quarantined + pointeur forensique', row.inspection_status === 'quarantined' && row.quarantine_bucket === 'quarantined-uploads' && !!row.quarantine_path);
    const folder = b.path.split('/').slice(0, -1).join('/');
    const name = b.path.split('/').pop();
    const { data: orig } = await service.storage.from('clinical-attachments').list(folder);
    report('eicar(docx) : original SUPPRIME du bucket documentaire', !(orig ?? []).some((o) => o.name === name));
    const qFolder = row.quarantine_path.split('/').slice(0, -1).join('/');
    const qName = row.quarantine_path.split('/').pop();
    const { data: qList } = await service.storage.from('quarantined-uploads').list(qFolder);
    report('eicar(docx) : octets PRESENTS en quarantaine', (qList ?? []).some((o) => o.name === qName));
    const sr = await edge('signed-read', { entity: 'attachment', id: b.id });
    report('eicar(docx) : signed-read REFUSE (aucune URL)', !sr.data?.url && sr.status !== 200);
    const { data: userQ, error: userQe } = await user.storage.from('quarantined-uploads').list(qFolder);
    report('eicar(docx) : bucket quarantaine ILLISIBLE par un utilisateur', Boolean(userQe) || (userQ ?? []).length === 0);
  });

  // 3) EICAR brut nomme .pdf : refus AVANT clamav (magic-bytes) -> quarantaine aussi.
  await scannerScenario('eicar(brut) : quarantaine', async () => {
    const c = await uploadAttachment(fx, RAW_EICAR, 'E2E eicar-brut');
    const insp = await edge('inspect-upload', { entity: 'attachment', id: c.id });
    report('eicar(brut) : deguisement d extension -> quarantined', insp.data?.status === 'quarantined', JSON.stringify(insp.data));
  });

  // 4) Upload SANS ticket : la policy storage.objects doit refuser.
  try {
    const path = `${fx.baseId}/e2e/${randomUUID()}.pdf`;
    const { error } = await user.storage.from('clinical-attachments').upload(path, PDF_CLEAN, { contentType: 'application/pdf' });
    report('sans ticket : insertion Storage REFUSEE', Boolean(error), error?.message ?? 'accepte a tort');
  } catch (e) { report('sans ticket : insertion Storage REFUSEE', true, e.message); }

  // 5) Objet > 20 Mio : refus par la limite du bucket, avant toute inspection.
  try {
    const path = `${fx.baseId}/e2e/${randomUUID()}.pdf`;
    await user.rpc('create_upload_ticket', { p_base_id: fx.baseId, p_bucket: 'clinical-attachments', p_path: path });
    const big = Buffer.alloc(21 * 1024 * 1024, 0x25); // 21 Mio de '%'
    const { error } = await user.storage.from('clinical-attachments').upload(path, big, { contentType: 'application/pdf' });
    report('21 Mio : REFUSE par la limite Storage', Boolean(error), error?.message ?? 'accepte a tort');
  } catch (e) { report('21 Mio : REFUSE par la limite Storage', true, e.message); }

  // 6) Reprise d un accepted_client (heritage pilote fictif) : reinspectable en strict.
  await scannerScenario('accepted_client : reprise', async () => {
    const d = await uploadAttachment(fx, PDF_CLEAN, 'E2E reprise', 'accepted_client');
    const sr0 = await edge('signed-read', { entity: 'attachment', id: d.id });
    report('accepted_client : signed-read REFUSE en mode strict', !sr0.data?.url && sr0.status !== 200);
    const insp = await edge('inspect-upload', { entity: 'attachment', id: d.id });
    report('accepted_client : reinspection -> accepted', insp.data?.status === 'accepted', JSON.stringify(insp.data));
  });

  await admin.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? '🎉' : '💥'} ${results.length - failed}/${results.length} scenarios verts`);
  if (skipped.length > 0) {
    console.log(`⚠️  ${skipped.length} scenario(s) NON EXECUTE(S) — ce preflight est PARTIEL :`);
    for (const item of skipped) console.log(`   - ${item.name} (${item.reason})`);
    console.log('   Aucune preuve de detection antivirus ni de quarantaine n est produite par cette execution.');
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('✗ E2E interrompu :', e.message);
  await admin.end().catch(() => {});
  process.exit(1);
});
