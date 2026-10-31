// server.mjs — local bridge: serves the web app AND forwards .plt to the machine
// over raw TCP (which a browser cannot do itself). It also keeps the git clone
// up to date: it checks the remote on launch and the Studio can pull + restart.
//
// Run:  node server.mjs [httpPort]
// Then open http://localhost:8080/  (Chrome/Edge).
//
// Endpoints:
//   GET  /api/health                      -> { bridge, version }
//   GET  /api/ping?ip=..&port=..          -> { ok, ms }   TCP connect test (no data)
//   POST /api/send?ip=..&port=..          -> { ok, bytes } body = .plt text, sent over TCP
//   GET  /api/version[?fetch=1]           -> { git, current, date, behind, incoming[], dirty }
//   POST /api/update                      -> { ok, from, to }  git pull --ff-only, then restart
// POSTs need the header `X-Kerf: 1`, so another website can't trigger them
// (a custom header forces a CORS preflight, which this server never approves).
// Everything else is served statically from ./app.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_EXIT = 75;   // the server exits with this after an update → restart it

if (!process.env.KERF_WORKER) supervise(); else serve();

/** Run the server as a child and restart it after an in-app update. Ctrl+C
 *  reaches both processes; the child exits and this one follows it. */
function supervise() {
  let child = null;
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child?.kill('SIGTERM'));
  const run = () => {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, KERF_WORKER: '1' } });
    child.on('exit', (code, sig) => {
      if (code === UPDATE_EXIT) { console.log('\nUpdated — restarting Kerf Studio…\n'); run(); }
      else process.exit(code ?? (sig ? 1 : 0));
    });
  };
  run();
}

function serve() {
const HTTP_PORT = parseInt(process.argv[2], 10) || 8080;
const APP_DIR = path.join(ROOT, 'app');
const DEFAULT_IP = '192.168.1.20';
const DEFAULT_TCP = 5000;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
  '.pdf': 'application/pdf', '.plt': 'application/octet-stream',
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

// ---- updates (git) ----------------------------------------------------------
const git = (args, timeout = 20000) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: ROOT, timeout, windowsHide: true }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()));
});
let lastFetch = 0, fetching = null;
/** Fetch the remote at most every 10 minutes; concurrent callers share one fetch. */
function fetchRemote(force) {
  if (fetching) return fetching;
  if (!force && Date.now() - lastFetch < 10 * 60e3) return Promise.resolve();
  fetching = git(['fetch', '--quiet']).then(() => { lastFetch = Date.now(); })
    .catch((e) => { console.warn('Update check failed (offline?):', e.message); })
    .finally(() => { fetching = null; });
  return fetching;
}
async function versionInfo({ fetch = false, force = false } = {}) {
  // must be Kerf's own clone, not some repo it happens to sit inside
  const top = await git(['rev-parse', '--show-toplevel']).catch(() => null);
  if (!top || fs.realpathSync(top) !== fs.realpathSync(ROOT)) return { git: false, reason: 'Not a git clone — updates need `git clone`.' };
  const current = await git(['rev-parse', '--short', 'HEAD']);
  const date = await git(['log', '-1', '--format=%cs']);
  let upstream;
  try { upstream = await git(['rev-parse', '--abbrev-ref', '@{u}']); }
  catch { return { git: true, current, date, behind: 0, incoming: [], reason: 'This branch tracks no remote.' }; }
  if (fetch) await fetchRemote(force);
  const behind = parseInt(await git(['rev-list', '--count', 'HEAD..@{u}']), 10) || 0;
  const incoming = behind ? (await git(['log', '--format=%cs %s', '-n', '12', 'HEAD..@{u}'])).split('\n') : [];
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])) !== '';
  return { git: true, current, date, upstream, behind, incoming, dirty, checkedAt: lastFetch || null };
}

let sending = 0;
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = url.searchParams.get('ip') || DEFAULT_IP;
  const port = parseInt(url.searchParams.get('port'), 10) || DEFAULT_TCP;

  // --- API ---
  if (url.pathname.startsWith('/api/') && req.method === 'POST' && req.headers['x-kerf'] !== '1') {
    json(res, 403, { ok: false, error: 'missing X-Kerf header' }); return;
  }
  if (url.pathname === '/api/health') {
    const version = await git(['rev-parse', '--short', 'HEAD']).catch(() => null);
    json(res, 200, { bridge: true, edition: 'node', version }); return;
  }
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
      sending++;
      try {
        const { reply } = await tcpSend(ip, port, body);
        json(res, 200, { ok: true, ip, port, bytes: body.length, reply: reply.toString('latin1') });
      } catch (e) { json(res, 502, { ok: false, ip, port, error: e.message }); }
      finally { sending--; }
    });
    return;
  }
  if (url.pathname === '/api/version') {
    try { json(res, 200, await versionInfo({ fetch: url.searchParams.has('fetch'), force: url.searchParams.get('fetch') === 'force' })); }
    catch (e) { json(res, 500, { git: false, reason: e.message }); }
    return;
  }
  if (url.pathname === '/api/update' && req.method === 'POST') {
    try {
      if (sending) throw new Error('A cut is being sent; update after it finishes.');
      const v = await versionInfo({ fetch: true, force: true });
      if (!v.git || !v.upstream) throw new Error(v.reason || 'No remote to update from.');
      if (v.dirty) throw new Error('Files in this folder were changed by hand, so it won\'t update automatically. Run `git pull` yourself.');
      if (!v.behind) { json(res, 200, { ok: true, from: v.current, to: v.current, restarting: false }); return; }
      await git(['pull', '--ff-only', '--quiet'], 60000);
      const to = await git(['rev-parse', '--short', 'HEAD']);
      console.log(`Updated ${v.current} → ${to}`);
      json(res, 200, { ok: true, from: v.current, to, restarting: true });
      // restart so server.mjs changes take effect too (the supervisor relaunches us)
      setTimeout(() => server.close(() => process.exit(UPDATE_EXIT)), 300);
      setTimeout(() => process.exit(UPDATE_EXIT), 3000).unref();
    } catch (e) { json(res, 409, { ok: false, error: e.message }); }
    return;
  }

  // --- static files from ./app ---
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const filePath = path.normalize(path.join(APP_DIR, p));
  if (!filePath.startsWith(APP_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

server.listen(HTTP_PORT, () => {
  console.log(`Kerf Studio running:`);
  console.log(`  App:     http://localhost:${HTTP_PORT}/`);
  console.log(`  Machine: TCP ${DEFAULT_IP}:${DEFAULT_TCP} (set the IP in Machine settings)`);
  console.log(`  Ctrl+C to stop.`);
  fetchRemote(true);   // check for updates in the background
});
}
