// transport.js — one send path that works in all three editions:
//   • Tauri app   → call Rust commands (window.__TAURI__.core.invoke)
//   • Node bridge → POST /api/send, GET /api/ping (server.mjs)
//   • Hosted web  → no machine link (export / Save-to-stick only)
//
// The app calls detectBackend() once at boot, then pingMachine()/sendPlt().

function tauriInvoke() {
  const t = (typeof window !== 'undefined') && window.__TAURI__;
  if (!t) return null;
  return (t.core && t.core.invoke) || t.invoke || null;
}

/** Returns 'tauri' | 'bridge' | 'web'. */
export async function detectBackend() {
  if (tauriInvoke()) return 'tauri';
  try {
    const r = await fetch('/api/health', { method: 'GET' });
    if (r.ok) { const j = await r.json().catch(() => null); if (j && j.bridge) return 'bridge'; }
  } catch { /* no bridge */ }
  return 'web';
}

/** Test reachability. Returns latency in ms (or throws). */
export async function pingMachine(ip, port) {
  const invoke = tauriInvoke();
  if (invoke) return invoke('ping_machine', { ip, port: Number(port) });
  const res = await fetch(`/api/ping?ip=${encodeURIComponent(ip)}&port=${port}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'unreachable');
  return j.ms;
}

/** Send the .plt to the machine. Returns { bytes }. */
export async function sendPlt(ip, port, plt) {
  const invoke = tauriInvoke();
  if (invoke) { const bytes = await invoke('send_plt', { ip, port: Number(port), data: plt }); return { bytes }; }
  const res = await fetch(`/api/send?ip=${encodeURIComponent(ip)}&port=${port}`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: plt,
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'send failed');
  return { bytes: j.bytes };
}
