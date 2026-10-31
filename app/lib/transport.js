// transport.js — the local server (server.mjs): the machine link
//   (GET /api/ping, POST /api/send; browsers can't open raw TCP, so the server
//   forwards the .plt to the cutter) and Studio updates (/api/version, /api/update).
// POSTs carry `X-Kerf: 1`; the server refuses POSTs without it.

const POST = { method: 'POST', headers: { 'X-Kerf': '1' } };

/** Test reachability. Returns latency in ms (or throws). */
export async function pingMachine(ip, port) {
  const res = await fetch(`/api/ping?ip=${encodeURIComponent(ip)}&port=${port}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'unreachable');
  return j.ms;
}

/** Send the .plt to the machine. Returns { bytes }. */
export async function sendPlt(ip, port, plt) {
  const res = await fetch(`/api/send?ip=${encodeURIComponent(ip)}&port=${port}`, {
    ...POST, headers: { ...POST.headers, 'content-type': 'text/plain' }, body: plt,
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'send failed');
  return { bytes: j.bytes };
}

/** Studio version + pending updates. `check`: false | true (≤ every 10 min) | 'force'. */
export async function getVersion(check = false) {
  const q = check === 'force' ? '?fetch=force' : check ? '?fetch=1' : '';
  return (await fetch(`/api/version${q}`)).json();
}

/** Pull the update (fast-forward only). The server restarts itself afterwards. */
export async function updateStudio() {
  const j = await (await fetch('/api/update', POST)).json();
  if (!j.ok) throw new Error(j.error || 'update failed');
  return j;
}

/** Resolve once the restarted server answers with a version other than `from`. */
export async function waitForRestart(from, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, 700));
    try { const j = await (await fetch('/api/health', { cache: 'no-store' })).json(); if (j.version && j.version !== from) return j.version; } catch { /* restarting */ }
  }
  throw new Error('the server did not come back; restart it with node server.mjs');
}
