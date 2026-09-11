// main.js — wires the UI together.
import { svgToPolylines, rotateAndNormalize, boundsOf } from './lib/svg-parse.js';
import { extractCutPolylines } from './lib/pdf-cut.js';
import { polylinesToHPGL, hpglStats, MACHINE_DEFAULTS } from './lib/hpgl.js';

const $ = (id) => document.getElementById(id);
const PALETTE = ['#e5484d', '#3b82f6', '#12a594', '#f5a524', '#8e4ec6', '#e93d82', '#46a758', '#d6409f'];
const state = { fileName: null, contours: [], plt: null };

const controls = {
  userUnitsPerMm: $('userUnitsPerMm'), sampleStepMm: $('sampleStepMm'),
  rotate: $('rotate'), place: $('place'), flipY: $('flipY'),
  unitsPerMm: $('unitsPerMm'), bedWunits: $('bedWunits'), bedHunits: $('bedHunits'), tool: $('tool'),
};

function readOpts() {
  return {
    userUnitsPerMm: parseFloat(controls.userUnitsPerMm.value) || (96 / 25.4),
    sampleStepMm: parseFloat(controls.sampleStepMm.value) || 0.3,
    rotate: controls.rotate.value, place: controls.place.value, flipY: controls.flipY.checked,
    unitsPerMm: parseFloat(controls.unitsPerMm.value) || 40,
    bedWunits: parseInt(controls.bedWunits.value, 10) || MACHINE_DEFAULTS.bedWunits,
    bedHunits: parseInt(controls.bedHunits.value, 10) || MACHINE_DEFAULTS.bedHunits,
    cutTool: parseInt(controls.tool.value, 10) || 1,
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
          ? 'Found a "Cut" colour but no cut paths (they may be nested in an unsupported way). Try exporting the Cut layer as SVG.'
          : 'No "Cut" spot colour found in this PDF. Mark cut lines with a spot colour named "Cut" in Illustrator.', 'warn');
        clearContours(); return;
      }
      polylines = res.polylines;
    } else if (/\.svg$/i.test(file.name)) {
      const text = await file.text();
      polylines = svgToPolylines(text, { userUnitsPerMm: o.userUnitsPerMm, sampleStepMm: o.sampleStepMm }).polylines;
    } else {
      setStatus(`"${file.name}" is neither PDF nor SVG.`, 'warn'); return;
    }
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

function clearContours() { state.contours = []; renderContours(); $('pltOut').value = ''; $('stats').textContent = ''; $('exportBtn').disabled = true; $('saveStickBtn').disabled = true; $('sendLanBtn').disabled = true; drawEmpty(); }

$('fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('dropzone');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
$('loadSample').addEventListener('click', async () => {
  const res = await fetch('./samples/test-square.svg');
  const text = await res.text();
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
    row.innerHTML = `<input type="checkbox" ${c.selected ? 'checked' : ''} data-i="${i}">
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
  const o = readOpts();
  const selected = state.contours.filter(c => c.selected).map(c => c.pts);
  if (!selected.length) { $('pltOut').value = ''; $('stats').textContent = 'No contours selected.'; $('exportBtn').disabled = true; $('saveStickBtn').disabled = true; $('sendLanBtn').disabled = true; drawEmpty(); return; }
  const rot = chooseRotation(selected, o);
  const art = rotateAndNormalize(selected, rot);
  state.plt = polylinesToHPGL(art.polylines, {
    widthMm: art.widthMm, heightMm: art.heightMm, place: o.place, flipY: o.flipY,
    unitsPerMm: o.unitsPerMm, bedWunits: o.bedWunits, bedHunits: o.bedHunits, cutTool: o.cutTool,
  });
  drawPreview(o, art);
  $('pltOut').value = state.plt;
  const st = hpglStats(state.plt);
  const fits = art.widthMm * o.unitsPerMm <= o.bedWunits && art.heightMm * o.unitsPerMm <= o.bedHunits;
  $('stats').textContent = `${art.polylines.length} contour(s) · ${art.widthMm.toFixed(1)} × ${art.heightMm.toFixed(1)} mm · rot ${rot}° · ${st.pdCount} pts · ${st.bytes} bytes` + (fits ? '' : ' · ⚠ exceeds bed');
  $('exportBtn').disabled = false; $('saveStickBtn').disabled = false; $('sendLanBtn').disabled = false;
}
Object.values(controls).forEach(c => c && c.addEventListener('change', regenerate));

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

  const offX = o.place === 'center' ? (bedWmm - art.widthMm) / 2 : 0;
  const offY = o.place === 'center' ? (bedHmm - art.heightMm) / 2 : 0;
  ctx.lineWidth = 1.4;
  // Colour each contour to match its list swatch (selection order preserved).
  const selColors = state.contours.filter(c => c.selected).map(c => c.color);
  art.polylines.forEach((pl, i) => {
    ctx.strokeStyle = selColors[i] || '#e5484d';
    ctx.beginPath(); ctx.moveTo(SX(offX + pl[0].x), SY(offY + pl[0].y));
    for (let k = 1; k < pl.length; k++) ctx.lineTo(SX(offX + pl[k].x), SY(offY + pl[k].y));
    ctx.stroke();
  });
}

// ---- export ---------------------------------------------------------------
$('exportBtn').addEventListener('click', () => {
  if (!state.plt) return;
  const base = (state.fileName || 'artwork').replace(/\.[^.]+$/, '');
  const blob = new Blob([state.plt], { type: 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${base}.plt`; a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`Exported ${base}.plt — copy to the flash drive and open on the machine.`, 'ok');
});

// ---- Save straight to the USB stick (File System Access API) --------------
let stickDir = null;
const fsSupported = typeof window.showDirectoryPicker === 'function';

// tiny IndexedDB store to remember the chosen folder across reloads
function idb(op, val) {
  return new Promise((resolve) => {
    const r = indexedDB.open('cutter-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => resolve(null);
    r.onsuccess = () => {
      try {
        const tx = r.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
        const s = tx.objectStore('kv');
        const req = op === 'get' ? s.get('stickDir') : s.put(val, 'stickDir');
        req.onsuccess = () => resolve(op === 'get' ? req.result : true);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}

async function ensureStick(interactive) {
  if (!fsSupported) throw new Error('This browser has no folder access. Use Chrome/Edge, or use "Export .plt".');
  if (stickDir) {
    const p = await stickDir.queryPermission({ mode: 'readwrite' });
    if (p === 'granted') return stickDir;
    if (interactive && (await stickDir.requestPermission({ mode: 'readwrite' })) === 'granted') return stickDir;
  }
  if (!interactive) return null;
  stickDir = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idb('put', stickDir);
  setStickNote();
  return stickDir;
}

function setStickNote() {
  const n = $('stickNote');
  if (!fsSupported) { n.textContent = 'Tip: "Save to USB stick" needs Chrome/Edge. Use "Export .plt" otherwise.'; return; }
  n.textContent = stickDir ? `Saving to: ${stickDir.name}/ (click to pick a different folder: shift-click Save)` : 'First save will ask you to pick your USB stick once.';
}

$('saveStickBtn').addEventListener('click', async (e) => {
  if (!state.plt) return;
  const base = (state.fileName || 'artwork').replace(/\.[^.]+$/, '');
  try {
    // shift-click forces re-picking the folder
    if (e.shiftKey) stickDir = null;
    const dir = await ensureStick(true);
    if (!dir) return;
    const fh = await dir.getFileHandle(`${base}.plt`, { create: true });
    const w = await fh.createWritable();
    await w.write(state.plt); await w.close();
    setStatus(`Saved ${base}.plt to ${dir.name}/ — eject the stick and cut on the machine.`, 'ok');
  } catch (err) {
    if (err?.name === 'AbortError') return; // user cancelled the picker
    setStatus('Save failed: ' + err.message, 'err');
  }
});

// ---- Send to machine over LAN (via the local Node bridge) -----------------
const lanTarget = () => `ip=${encodeURIComponent($('ip').value.trim())}&port=${encodeURIComponent($('port').value.trim())}`;
const lanLog = (msg) => { const el = $('lanLog'); el.hidden = false; el.textContent = msg; };
const PENUP = () => `TB25,11080,7600;CT1;${' '.repeat(1025)}IN;PU5540,3800;PU1500,1500;PU5540,3800;PU11280,200;PG;`;

async function lanPost(plt) {
  const res = await fetch(`/api/send?${lanTarget()}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: plt });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'send failed');
  return j;
}

$('pingBtn').addEventListener('click', async () => {
  lanLog(`Testing ${$('ip').value}:${$('port').value}…`);
  try {
    const res = await fetch(`/api/ping?${lanTarget()}`);
    const j = await res.json();
    if (j.ok) { lanLog(`✅ Reached ${j.ip}:${j.port} in ${j.ms} ms. Machine is ready to receive.`); setStatus('Machine reachable — ready to send.', 'ok'); }
    else { lanLog(`❌ ${j.ip}:${j.port} — ${j.error}\nMake sure the machine is on its main/ready screen (the plot port only opens there).`); setStatus('Port not open — check the machine is on its ready screen.', 'warn'); }
  } catch (err) { lanLog('Bridge error: ' + err.message + '\nIs the Node bridge running? (node server.mjs)'); setStatus('Bridge not reachable.', 'err'); }
});

$('penupBtn').addEventListener('click', async () => {
  lanLog('Sending safe pen-up test (0 cuts)…');
  try { const j = await lanPost(PENUP()); lanLog(`✅ Sent ${j.bytes} bytes to ${j.ip}:${j.port} (pen-up only). Watch the head — did it move?`); setStatus('Pen-up test sent.', 'ok'); }
  catch (err) { lanLog('❌ ' + err.message + '\nMachine must be on its main/ready screen.'); setStatus('Send failed: ' + err.message, 'err'); }
});

$('sendLanBtn').addEventListener('click', async () => {
  if (!state.plt) return;
  lanLog(`Sending cut (${state.plt.length} bytes) to ${$('ip').value}:${$('port').value}…`);
  try { const j = await lanPost(state.plt); lanLog(`✅ Cut sent — ${j.bytes} bytes to ${j.ip}:${j.port}.`); setStatus('Cut sent to the machine!', 'ok'); }
  catch (err) { lanLog('❌ ' + err.message + '\nMachine must be on its main/ready screen.'); setStatus('Send failed: ' + err.message, 'err'); }
});

// Restore the saved USB-stick folder handle on load (permission re-checked lazily).
(async () => {
  if (!fsSupported) { setStickNote(); return; }
  try { const h = await idb('get'); if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'denied') stickDir = h; } catch {}
  setStickNote();
})();

// ---- status ---------------------------------------------------------------
function setStatus(msg, kind = '') { const el = $('status'); el.textContent = msg; el.className = `status ${kind}`; }
setStatus('Drop a PDF or SVG (or click "Load sample") to begin.');
