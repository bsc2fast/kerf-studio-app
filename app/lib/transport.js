// transport.js — the machine link, via the local bridge (server.mjs):
//   GET /api/ping, POST /api/send. Browsers can't open raw TCP, so the bridge
//   forwards the .plt to the cutter.

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
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: plt,
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'send failed');
  return { bytes: j.bytes };
}
