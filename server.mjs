// server.mjs — local bridge: serves the web app AND forwards .plt to the machine
// over raw TCP (which a browser cannot do itself).
//
// Run:  node server.mjs [httpPort]
// Then open http://localhost:8080/  (Chrome/Edge).
//
// Endpoints:
//   GET  /api/ping?ip=..&port=..          -> { ok, ms }   TCP connect test (no data)
//   POST /api/send?ip=..&port=..          -> { ok, bytes } body = .plt text, sent over TCP
// Everything else is served statically from ./app.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HTTP_PORT = parseInt(process.argv[2], 10) || 8080;
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');
const DEFAULT_IP = '192.168.1.20';
const DEFAULT_TCP = 5000;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

/** Open a TCP connection, write `data`, resolve when the machine closes or after idle. */
function tcpSend(ip, port, data, { idleMs = 1500, hardMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port });
    let reply = Buffer.alloc(0);
    let idle = null;
    const hard = setTimeout(() => finish(), hardMs);
    const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => finish(), idleMs); };
    const finish = () => { clearTimeout(hard); clearTimeout(idle); try { sock.destroy(); } catch {} resolve({ reply }); };
    sock.on('connect', () => { sock.write(data, () => armIdle()); });
    sock.on('data', (d) => { reply = Buffer.concat([reply, d]); armIdle(); });
    sock.on('close', () => finish());
    sock.on('error', (e) => { clearTimeout(hard); clearTimeout(idle); reject(e); });
  });
}

function tcpPing(ip, port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const sock = net.createConnection({ host: ip, port });
    const to = setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, timeoutMs);
    sock.on('connect', () => { clearTimeout(to); const ms = Number(process.hrtime.bigint() - t0) / 1e6; sock.destroy(); resolve(ms); });
    sock.on('error', (e) => { clearTimeout(to); reject(e); });
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = url.searchParams.get('ip') || DEFAULT_IP;
  const port = parseInt(url.searchParams.get('port'), 10) || DEFAULT_TCP;

  // --- API ---
  if (url.pathname === '/api/health') { json(res, 200, { bridge: true, edition: 'node' }); return; }
  if (url.pathname === '/api/ping') {
    try { const ms = await tcpPing(ip, port); json(res, 200, { ok: true, ip, port, ms: Math.round(ms * 100) / 100 }); }
    catch (e) { json(res, 502, { ok: false, ip, port, error: e.message }); }
    return;
  }
  if (url.pathname === '/api/send' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      try {
        const { reply } = await tcpSend(ip, port, body);
        json(res, 200, { ok: true, ip, port, bytes: body.length, reply: reply.toString('latin1') });
      } catch (e) { json(res, 502, { ok: false, ip, port, error: e.message }); }
    });
    return;
  }

  // --- static files from ./app ---
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const filePath = path.normalize(path.join(APP_DIR, p));
  if (!filePath.startsWith(APP_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(HTTP_PORT, () => {
  console.log(`Cutter Studio bridge running:`);
  console.log(`  App:     http://localhost:${HTTP_PORT}/`);
  console.log(`  Machine: TCP ${DEFAULT_IP}:${DEFAULT_TCP} (override per-request with ?ip=&port=)`);
  console.log(`  Ctrl+C to stop.`);
});
