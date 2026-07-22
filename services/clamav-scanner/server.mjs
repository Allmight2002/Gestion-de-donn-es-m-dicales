import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { parseScan } from './parse-scan.mjs';
import { parseClamavVersion } from './parse-version.mjs';

function positiveInteger(name, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside the accepted range`);
  }
  return value;
}

const PORT = positiveInteger('PORT', 8080, { maximum: 65_535 });
const CLAMD_HOST = process.env.CLAMD_HOST ?? '127.0.0.1';
const CLAMD_PORT = positiveInteger('CLAMD_PORT', 3310, { maximum: 65_535 });
const CLAMD_TIMEOUT_MS = positiveInteger('CLAMD_TIMEOUT_MS', 30_000, { maximum: 120_000 });
const MAX_SCAN_BYTES = positiveInteger('MAX_SCAN_BYTES', 25 * 1024 * 1024, {
  maximum: 100 * 1024 * 1024,
});
const MAX_CONCURRENT_SCANS = positiveInteger('MAX_CONCURRENT_SCANS', 4, { maximum: 64 });
const SCAN_TOKEN = process.env.SCAN_TOKEN ?? '';
const FORBIDDEN_TOKENS = new Set(['', 'change-me', 'changeme']);

if (SCAN_TOKEN.length < 32 || FORBIDDEN_TOKENS.has(SCAN_TOKEN.trim().toLowerCase())) {
  console.error('SCAN_TOKEN must be a non-default secret of at least 32 characters');
  process.exit(1);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  const expected = Buffer.from(`Bearer ${SCAN_TOKEN}`, 'utf8');
  const actual = Buffer.from(req.headers.authorization ?? '', 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      total += chunk.byteLength;
      if (total > MAX_SCAN_BYTES) {
        rejected = true;
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!rejected) reject(error);
    });
  });
}

function runClamd(writePayload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: CLAMD_HOST, port: CLAMD_PORT });
    const chunks = [];
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };

    socket.setTimeout(CLAMD_TIMEOUT_MS, () => finish(reject, new Error('clamd timeout')));
    socket.on('connect', () => writePayload(socket));
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.includes('\0') || text.includes('\n') || / (OK|FOUND|ERROR)$/.test(text.trim())) {
        finish(resolve, text.replaceAll('\0', '').trim());
      }
    });
    socket.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8').replaceAll('\0', '').trim()));
    socket.on('error', (error) => finish(reject, error));
  });
}

async function pingClamd() {
  return await runClamd((socket) => socket.write('zPING\0'));
}

async function versionClamd() {
  return await runClamd((socket) => socket.write('zVERSION\0'));
}

async function scanBuffer(buffer) {
  return await runClamd((socket) => {
    socket.write(Buffer.from('zINSTREAM\0'));
    for (let offset = 0; offset < buffer.byteLength; offset += 64 * 1024) {
      const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.byteLength));
      const size = Buffer.alloc(4);
      size.writeUInt32BE(chunk.byteLength, 0);
      socket.write(size);
      socket.write(chunk);
    }
    socket.write(Buffer.alloc(4));
  });
}

let activeScans = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    try {
      const [ping, rawVersion] = await Promise.all([pingClamd(), versionClamd()]);
      const version = parseClamavVersion(rawVersion);
      const healthy = ping.includes('PONG') && version !== null;
      sendJson(
        res,
        healthy ? 200 : 503,
        healthy
          ? {
              status: 'ok',
              engine: 'clamav',
              ...version,
              capacity: {
                activeScans,
                maxConcurrentScans: MAX_CONCURRENT_SCANS,
                availableSlots: Math.max(0, MAX_CONCURRENT_SCANS - activeScans),
              },
            }
          : { status: 'error', code: 'clamd_unhealthy' },
      );
    } catch {
      sendJson(res, 503, { status: 'error', code: 'clamd_unavailable' });
    }
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/scan') {
    sendJson(res, 404, { error: 'POST /scan expected' });
    return;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  if (activeScans >= MAX_CONCURRENT_SCANS) {
    sendJson(res, 429, { status: 'error', code: 'scanner_busy' });
    return;
  }

  activeScans += 1;
  try {
    const buffer = await readBody(req);
    const verdict = parseScan(await scanBuffer(buffer));
    if (verdict.status === 'error') {
      sendJson(res, 502, { status: 'error', code: 'clamd_invalid_response' });
      return;
    }
    sendJson(
      res,
      200,
      verdict.status === 'infected'
        ? { status: 'infected', signature: verdict.signature, engine: 'clamav' }
        : { status: 'clean', engine: 'clamav' },
    );
  } catch (error) {
    const status = Number(error?.statusCode ?? 503);
    sendJson(res, status, {
      status: 'error',
      code: status === 413 ? 'payload_too_large' : 'scan_unavailable',
    });
  } finally {
    activeScans -= 1;
  }
});

server.requestTimeout = CLAMD_TIMEOUT_MS + 5_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.listen(PORT, () => {
  console.log(`clamav-scanner listening on ${PORT}`);
});
