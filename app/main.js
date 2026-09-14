// main.js — Kerf: Studio + Machine config + Get-app, one shared app.
import { svgToPolylines, rotateAndNormalize, boundsOf } from './lib/svg-parse.js';
import { extractCutPolylines } from './lib/pdf-cut.js';
import { polylinesToHPGL, hpglStats } from './lib/hpgl.js';
import { detectBackend, pingMachine, sendPlt } from './lib/transport.js';
import { getSettings, saveSettings, resetSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const PALETTE = ['#e5484d', '#3b82f6', '#12a594', '#f5a524', '#8e4ec6', '#e93d82', '#46a758', '#d6409f'];
const PAD = ' '.repeat(1025);
const state = { fileName: null, contours: [], plt: null };
let backendMode = 'web';

// per-artwork controls (machine params live in Settings)
const sc = {
  userUnitsPerMm: $('userUnitsPerMm'), sampleStepMm: $('sampleStepMm'),
  rotate: $('rotate'), place: $('place'), flipY: $('flipY'),
};

function readOpts() {
  const s = getSettings();
  return {
    userUnitsPerMm: parseFloat(sc.userUnitsPerMm.value) || (96 / 25.4),
    sampleStepMm: parseFloat(sc.sampleStepMm.value) || 0.3,
    rotate: sc.rotate.value, place: sc.place.value, flipY: sc.flipY.checked,
    unitsPerMm: s.unitsPerMm || 40, bedWunits: s.bedWunits, bedHunits: s.bedHunits,
    cutTool: s.cutTool, originXmm: s.originXmm, originYmm: s.originYmm,
  };
}

// ---- file loading ---------------------------------------------------------
async function loadFile(file) {
  if (!file) return;
  state.fileName = file.name;
  const o = readOpts();
  try {
    let polylines;
    if (/\.pdf$/i.test(file.name)) {
      setStatus('Reading PDF…');
      const res = await extractCutPolylines(new Uint8Array(await file.arrayBuffer()));
      if (!res.polylines.length) {
        setStatus(res.cutFound
          ? 'Found a "Cut" colour but no cut paths (nested in an unsupported way). Try exporting the Cut layer as SVG.'
          : 'No "Cut" spot colour found. Mark cut lines with a spot colour named "Cut" in Illustrator.', 'warn');
        clearContours(); return;
      }
      polylines = res.polylines;
    } else if (/\.svg$/i.test(file.name)) {
      polylines = svgToPolylines(await file.text(), { userUnitsPerMm: o.userUnitsPerMm, sampleStepMm: o.sampleStepMm }).polylines;
    } else { setStatus(`"${file.name}" is neither PDF nor SVG.`, 'warn'); return; }
    buildContours(polylines);
    setStatus(`Loaded ${file.name} — ${state.contours.length} cut contour(s).`, 'ok');
  } catch (err) { setStatus('Could not read file: ' + err.message, 'err'); }
}

function buildContours(polylines) {
  state.contours = polylines.map((pts, i) => {
    const b = boundsOf([pts]);
    return { pts, selected: true, color: PALETTE[i % PALETTE.length],
      w: b ? b.maxX - b.minX : 0, h: b ? b.maxY - b.minY : 0, n: pts.length };
  });
  renderContours(); regenerate();
}
function clearContours() { state.contours = []; renderContours(); $('pltOut').value = ''; $('stats').textContent = ''; toggleOutputs(false); drawEmpty(); }
function toggleOutputs(on) { $('exportBtn').disabled = !on; $('saveStickBtn').disabled = !on; $('sendLanBtn').disabled = !on; }

$('fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('dropzone');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
$('loadSample').addEventListener('click', async () => {
  const text = await (await fetch('./samples/test-square.svg')).text();
  state.fileName = 'test-square.svg';
  buildContours(svgToPolylines(text, readOpts()).polylines);
  setStatus('Loaded sample.', 'ok');
});

// ---- contour list ---------------------------------------------------------
function renderContours() {
  const box = $('contours'), list = $('contourList');
  box.hidden = state.contours.length === 0;
  list.innerHTML = '';
  state.contours.forEach((c, i) => {
    const row = document.createElement('label'); row.className = 'contour-row';
    row.innerHTML = `<input type="checkbox" ${c.selected ? 'checked' : ''}>
      <span class="swatch" style="background:${c.color}"></span>
      <span>Contour ${i + 1}</span>
      <span class="meta">${c.w.toFixed(1)} × ${c.h.toFixed(1)} mm · ${c.n} pts</span>`;
    row.querySelector('input').addEventListener('change', (e) => { state.contours[i].selected = e.target.checked; regenerate(); });
    list.appendChild(row);
  });
}
$('allBtn').addEventListener('click', () => {
  const anyOff = state.contours.some(c => !c.selected);
  state.contours.forEach(c => c.selected = anyOff);
  renderContours(); regenerate();
});

// ---- pipeline -------------------------------------------------------------
function chooseRotation(selected, o) {
  if (o.rotate !== 'auto') return parseInt(o.rotate, 10) || 0;
  const fit = (deg) => { const a = rotateAndNormalize(selected, deg); return a.widthMm * o.unitsPerMm <= o.bedWunits && a.heightMm * o.unitsPerMm <= o.bedHunits; };
  if (fit(0)) return 0; if (fit(90)) return 90; return 0;
}
function regenerate() {
  if (!sc.rotate) return;
  const o = readOpts();
  const selected = state.contours.filter(c => c.selected).map(c => c.pts);
  if (!selected.length) { $('pltOut').value = ''; $('stats').textContent = state.contours.length ? 'No contours selected.' : ''; toggleOutputs(false); drawEmpty(); return; }
  const rot = chooseRotation(selected, o);
  const art = rotateAndNormalize(selected, rot);
  state.plt = polylinesToHPGL(art.polylines, {
    widthMm: art.widthMm, heightMm: art.heightMm, place: o.place, flipY: o.flipY,
    unitsPerMm: o.unitsPerMm, bedWunits: o.bedWunits, bedHunits: o.bedHunits, cutTool: o.cutTool,
    originXmm: o.originXmm, originYmm: o.originYmm,
  });
  drawPreview(o, art);
  $('pltOut').value = state.plt;
  const st = hpglStats(state.plt);
  const fits = art.widthMm * o.unitsPerMm <= o.bedWunits && art.heightMm * o.unitsPerMm <= o.bedHunits;
  $('stats').textContent = `${art.polylines.length} contour(s) · ${art.widthMm.toFixed(1)} × ${art.heightMm.toFixed(1)} mm · rot ${rot}° · ${st.pdCount} pts · ${st.bytes} bytes` + (fits ? '' : ' · ⚠ exceeds bed');
  toggleOutputs(true);
}
Object.values(sc).forEach(c => c && c.addEventListener('change', regenerate));

// ---- preview canvas -------------------------------------------------------
function drawEmpty() { const c = $('preview'), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); }
function drawPreview(o, art) {
  const canvas = $('preview'), ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height; ctx.clearRect(0, 0, W, H);
  const bedWmm = o.bedWunits / o.unitsPerMm, bedHmm = o.bedHunits / o.unitsPerMm;
  const pad = 16, scale = Math.min((W - 2 * pad) / bedWmm, (H - 2 * pad) / bedHmm);
  const ox = (W - bedWmm * scale) / 2, oy = (H - bedHmm * scale) / 2;
  const SX = (x) => ox + x * scale, SY = (y) => oy + y * scale;

  ctx.fillStyle = 'rgba(127,127,127,0.06)'; ctx.strokeStyle = 'rgba(120,140,170,0.6)'; ctx.lineWidth = 1;
  ctx.fillRect(ox, oy, bedWmm * scale, bedHmm * scale); ctx.strokeRect(ox, oy, bedWmm * scale, bedHmm * scale);

  // anchor (bottom-left of art bbox) in machine mm, then draw Y-down on screen
  const anchorX = o.place === 'origin' ? o.originXmm : (bedWmm - art.widthMm) / 2;
  const anchorY = o.place === 'origin' ? o.originYmm : (bedHmm - art.heightMm) / 2;
  // origin marker
  ctx.fillStyle = '#f5a524';
  ctx.beginPath(); ctx.arc(SX(o.originXmm), SY(bedHmm - o.originYmm), 3, 0, 7); ctx.fill();

  ctx.lineWidth = 1.4;
  const selColors = state.contours.filter(c => c.selected).map(c => c.color);
  art.polylines.forEach((pl, i) => {
    ctx.strokeStyle = selColors[i] || '#e5484d';
    ctx.beginPath();
    const P = (p) => { const mx = anchorX + p.x; const my = o.flipY ? (art.heightMm - p.y) : p.y; return [SX(mx), SY(bedHmm - (anchorY + my))]; };
    const [x0, y0] = P(pl[0]); ctx.moveTo(x0, y0);
    for (let k = 1; k < pl.length; k++) { const [x, y] = P(pl[k]); ctx.lineTo(x, y); }
    ctx.stroke();
  });
}

// ---- export / save-to-stick ----------------------------------------------
$('exportBtn').addEventListener('click', () => {
  if (!state.plt) return;
  const base = (state.fileName || 'artwork').replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.plt], { type: 'application/octet-stream' }));
  a.download = `${base}.plt`; a.click(); URL.revokeObjectURL(a.href);
  setStatus(`Exported ${base}.plt.`, 'ok');
});

let stickDir = null;
const fsSupported = typeof window.showDirectoryPicker === 'function';
function idb(op, val) {
  return new Promise((resolve) => {
    const r = indexedDB.open('kerf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => resolve(null);
    r.onsuccess = () => { try { const tx = r.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'); const s = tx.objectStore('kv'); const req = op === 'get' ? s.get('stickDir') : s.put(val, 'stickDir'); req.onsuccess = () => resolve(op === 'get' ? req.result : true); req.onerror = () => resolve(null); } catch { resolve(null); } };
  });
}
async function ensureStick(interactive) {
  if (!fsSupported) throw new Error('This browser has no folder access. Use Chrome/Edge, or "Export .plt".');
  if (stickDir) {
    if (await stickDir.queryPermission({ mode: 'readwrite' }) === 'granted') return stickDir;
    if (interactive && await stickDir.requestPermission({ mode: 'readwrite' }) === 'granted') return stickDir;
  }
  if (!interactive) return null;
  stickDir = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idb('put', stickDir); setStickNote(); return stickDir;
}
function setStickNote() {
  const n = $('stickNote'); if (!n) return;
  if (!fsSupported) { n.textContent = 'Tip: "Save to USB stick" needs Chrome/Edge.'; return; }
  n.textContent = stickDir ? `Saving to: ${stickDir.name}/ (shift-click Save to change folder)` : 'First save asks you to pick your USB stick once.';
}
$('saveStickBtn').addEventListener('click', async (e) => {
  if (!state.plt) return;
  const base = (state.fileName || 'artwork').replace(/\.[^.]+$/, '');
  try {
    if (e.shiftKey) stickDir = null;
    const dir = await ensureStick(true); if (!dir) return;
    const fh = await dir.getFileHandle(`${base}.plt`, { create: true });
    const w = await fh.createWritable(); await w.write(state.plt); await w.close();
    setStatus(`Saved ${base}.plt to ${dir.name}/.`, 'ok');
  } catch (err) { if (err?.name !== 'AbortError') setStatus('Save failed: ' + err.message, 'err'); }
});

function bedMm() { const s = getSettings(); return { w: s.bedWunits / s.unitsPerMm, h: s.bedHunits / s.unitsPerMm }; }

// ---- send helpers ---------------------------------------------------------
const ipv = () => getSettings().ip;
const portv = () => String(getSettings().port);
async function send(plt, logEl, okMsg) {
  if (logEl) { logEl.hidden = false; logEl.textContent = 'Sending…'; }
  try {
    const j = await sendPlt(ipv(), portv(), plt);
    if (logEl) logEl.textContent = `✅ ${okMsg} (${j.bytes} bytes → ${ipv()}:${portv()})`;
    setConn('online', `Connected · ${ipv()}`);
    return true;
  } catch (err) {
    if (logEl) logEl.textContent = '❌ ' + err.message + '\nMachine must be on its main/ready screen.';
    setConn('offline', 'Not reachable'); return false;
  }
}
async function testConn(logEl) {
  if (logEl) { logEl.hidden = false; logEl.textContent = `Testing ${ipv()}:${portv()}…`; }
  setConn('checking', 'Checking…');
  try {
    const ms = await pingMachine(ipv(), portv());
    if (logEl) logEl.textContent = `✅ Reached ${ipv()}:${portv()} in ${ms} ms — ready to receive.`;
    setConn('online', `Connected · ${ipv()}`); startConnPoll(); return true;
  } catch (err) {
    if (logEl) logEl.textContent = `❌ ${ipv()}:${portv()} — ${err.message}\nMake sure the machine is on its main/ready screen.`;
    setConn('offline', 'Not reachable'); stopConnPoll(); return false;
  }
}

// Studio send buttons
$('pingBtn').addEventListener('click', () => testConn($('lanLog')));
$('sendLanBtn').addEventListener('click', () => { if (state.plt) send(state.plt, $('lanLog'), 'Cut sent — machine will scan the marks and cut'); });

// ---- Machine config page --------------------------------------------------
const cfg = { cfgIp: $('cfgIp'), cfgPort: $('cfgPort'), unitsPerMm: $('unitsPerMm'), bedWunits: $('bedWunits'), bedHunits: $('bedHunits'), cutTool: $('cutTool'), originXmm: $('originXmm'), originYmm: $('originYmm') };
function populateConfig() {
  const s = getSettings();
  cfg.cfgIp.value = s.ip; cfg.cfgPort.value = s.port; cfg.unitsPerMm.value = s.unitsPerMm;
  cfg.bedWunits.value = s.bedWunits; cfg.bedHunits.value = s.bedHunits; cfg.cutTool.value = s.cutTool;
  cfg.originXmm.value = s.originXmm; cfg.originYmm.value = s.originYmm;
  updateBedNote();
}
function readConfig() {
  saveSettings({
    ip: cfg.cfgIp.value.trim(), port: parseInt(cfg.cfgPort.value, 10) || 5000,
    unitsPerMm: parseFloat(cfg.unitsPerMm.value) || 40,
    bedWunits: parseInt(cfg.bedWunits.value, 10) || 11080, bedHunits: parseInt(cfg.bedHunits.value, 10) || 7600,
    cutTool: parseInt(cfg.cutTool.value, 10) || 1,
    originXmm: parseFloat(cfg.originXmm.value) || 0, originYmm: parseFloat(cfg.originYmm.value) || 0,
  });
}
function updateBedNote() { const { w, h } = bedMm(); const n = $('bedMmNote'); if (n) n.textContent = `Bed ≈ ${w.toFixed(0)} × ${h.toFixed(0)} mm`; }
Object.values(cfg).forEach(el => el && el.addEventListener('input', () => { readConfig(); updateBedNote(); regenerate(); if (getSettings().ip) setConn(connState, connLabelText()); }));

$('cfgTestBtn').addEventListener('click', () => testConn($('configLog')));
$('resetBtn').addEventListener('click', () => { resetSettings(); populateConfig(); regenerate(); setStatus('Settings reset to defaults.', 'ok'); });

// ---- connection status widget ---------------------------------------------
let connPoll = null, connState = 'idle';
function connLabelText() { return connState === 'online' ? `Connected · ${ipv()}` : connState === 'offline' ? 'Not reachable' : connState === 'checking' ? 'Checking…' : (backendMode === 'web' ? 'Desktop app needed' : 'Not connected'); }
function setConn(st, label) { connState = st; const dot = $('connDot'), lbl = $('connLabel'); if (dot) dot.className = 'led' + (st === 'online' ? ' on' : st === 'offline' ? ' off' : st === 'checking' ? ' checking' : ''); if (lbl) lbl.textContent = label ?? connLabelText(); }
function stopConnPoll() { if (connPoll) { clearInterval(connPoll); connPoll = null; } }
function startConnPoll() { stopConnPoll(); connPoll = setInterval(async () => { try { await pingMachine(ipv(), portv()); setConn('online'); } catch { setConn('offline'); stopConnPoll(); } }, 15000); }
$('connBtn').addEventListener('click', () => { if (backendMode === 'web') { location.hash = '#get'; return; } testConn(null); });

// ---- routing --------------------------------------------------------------
const VIEWS = ['studio', 'config', 'get'];
function showView(v) {
  if (!VIEWS.includes(v)) v = 'studio';
  VIEWS.forEach(id => { const el = $('view-' + id); if (el) el.hidden = id !== v; });
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
}
window.addEventListener('hashchange', () => showView(location.hash.replace('#', '')));
showView(location.hash.replace('#', '') || 'studio');

// ---- boot -----------------------------------------------------------------
populateConfig();
setStickNote();
(async () => { if (fsSupported) { try { const h = await idb('get'); if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'denied') stickDir = h; } catch {} setStickNote(); } })();

detectBackend().then((mode) => {
  backendMode = mode;
  const cb = $('connBtn'), tag = $('lanTag'), panel = $('lanPanel'), note = $('webSendNote');
  if (mode === 'web') {
    if (panel) panel.hidden = true;
    if (note) note.hidden = false;
    setConn('idle', 'Desktop app needed'); if (cb) cb.textContent = 'Get app';
  } else {
    if (tag) tag.textContent = mode === 'tauri' ? 'Kerf app' : 'LAN';
    testConn(null);   // auto-check once
  }
});

function setStatus(msg, kind = '') { const el = $('status'); el.textContent = msg; el.className = `status ${kind}`; }
setStatus('Drop a PDF or SVG (or click "Load sample") to begin.');
