import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PORT ?? '8080');
const CLAMD_HOST = process.env.CLAMD_HOST ?? '127.0.0.1';
const CLAMD_PORT = Number(process.env.CLAMD_PORT ?? '3310');
const CLAMD_TIMEOUT_MS = Number(process.env.CLAMD_TIMEOUT_MS ?? '30000');
const MAX_SCAN_BYTES = Number(process.env.MAX_SCAN_BYTES ?? String(25 * 1024 * 1024));
const SCAN_TOKEN = process.env.SCAN_TOKEN ?? '';

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  return !SCAN_TOKEN || req.headers.authorization === `Bearer ${SCAN_TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.byteLength;
      if (total > MAX_SCAN_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
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

function parseScan(raw) {
  if (/\bOK\b/i.test(raw)) return { status: 'clean', raw };
  const found = raw.match(/:?\s*(.+?)\s+FOUND\b/i);
  if (found) return { status: 'infected', signature: found[1].replace(/^stream:\s*/i, ''), raw };
  return { status: 'error', raw };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    try {
      const raw = await pingClamd();
      sendJson(res, raw.includes('PONG') ? 200 : 503, { status: raw.includes('PONG') ? 'ok' : 'error', raw });
    } catch (error) {
      sendJson(res, 503, { status: 'error', error: error instanceof Error ? error.message : 'clamd unavailable' });
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

  try {
    const buffer = await readBody(req);
    const verdict = parseScan(await scanBuffer(buffer));
    if (verdict.status === 'error') {
      sendJson(res, 502, { status: 'error', raw: verdict.raw });
      return;
    }
    sendJson(res, 200, { ...verdict, engine: 'clamav' });
  } catch (error) {
    const status = Number(error?.statusCode ?? 503);
    sendJson(res, status, { status: 'error', error: error instanceof Error ? error.message : 'scan failed' });
  }
});

server.listen(PORT, () => {
  console.log(`clamav-scanner listening on ${PORT}, clamd=${CLAMD_HOST}:${CLAMD_PORT}`);
});
