// main.js — Kerf Studio: the Studio and Machine settings, one shared app.
import { svgToPolylines, rotateAndNormalize, boundsOf } from './lib/svg-parse.js';
import { extractCutPolylines } from './lib/pdf-cut.js';
import { polylinesToHPGL, hpglStats } from './lib/hpgl.js';
import { parsePlt } from './lib/plt-parse.js';
import { pingMachine, sendPlt, getVersion, updateStudio, waitForRestart } from './lib/transport.js';
import { getSettings, saveSettings, resetSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const PALETTE = ['#ff5a5f', '#6aa8ff', '#3ee0d0', '#ffb454', '#b18cff', '#f06aa8', '#7bd88f', '#e7d36a'];
// kind: 'art' (PDF/SVG → generated .plt) | 'plt' (uploaded .plt, sent as-is)
const state = { fileName: null, kind: null, contours: [], plt: null, pltBed: null, items: [], hover: -1 };

// ---- theme ------------------------------------------------------------------
const THEME_KEY = 'kerf.theme';
try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.dataset.theme = t; } catch {}
$('themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  drawPreview();
});

// ---- per-artwork controls (machine params live in Settings) ------------------
const sc = { userUnitsPerMm: $('userUnitsPerMm'), sampleStepMm: $('sampleStepMm'), flipY: $('flipY') };
function segControl(el) {
  const sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === el.dataset.value));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.v === el.dataset.value) return;
    el.dataset.value = b.dataset.v; sync(); regenerate();
  });
  sync();
}
segControl($('rotate')); segControl($('place'));

function readOpts() {
  const s = getSettings();
  return {
    userUnitsPerMm: parseFloat(sc.userUnitsPerMm.value) || (96 / 25.4),
    sampleStepMm: parseFloat(sc.sampleStepMm.value) || 0.3,
    rotate: $('rotate').dataset.value, place: $('place').dataset.value, flipY: sc.flipY.checked,
    unitsPerMm: s.unitsPerMm || 40, bedWunits: s.bedWunits, bedHunits: s.bedHunits,
    cutTool: s.cutTool, originXmm: s.originXmm, originYmm: s.originYmm,
  };
}

// ---- file loading -----------------------------------------------------------
async function loadFile(file) {
  if (!file) return;
  const o = readOpts();
  try {
    if (/\.(plt|hpgl?|hpg)$/i.test(file.name)) {
      setStatus('Reading PLT…');
      const text = await file.text();
      const res = parsePlt(text);
      if (!res.polylines.length) { setStatus(`No cut paths (PU/PD) found in ${file.name}.`, 'warn'); return; }
      state.kind = 'plt'; state.plt = text;
      state.pltBed = res.bedWunits && res.bedHunits ? { w: res.bedWunits, h: res.bedHunits } : null;
      setFile(file.name);
      buildContours(res.polylines, o.unitsPerMm);
      setStatus(`Loaded ${file.name} — ${state.contours.length} contour(s), sent as-is.`, 'ok');
      return;
    }
    let polylines;
    if (/\.pdf$/i.test(file.name)) {
      setStatus('Reading PDF…');
      const res = await extractCutPolylines(new Uint8Array(await file.arrayBuffer()));
      if (!res.polylines.length) {
        setStatus(res.cutFound
          ? 'Found a "Cut" colour but no cut paths. Try exporting the Cut layer as SVG.'
          : 'No "Cut" spot colour found. Mark cut lines with a spot colour named "Cut".', 'warn');
        return;
      }
      polylines = res.polylines;
    } else if (/\.svg$/i.test(file.name)) {
      polylines = svgToPolylines(await file.text(), { userUnitsPerMm: o.userUnitsPerMm, sampleStepMm: o.sampleStepMm }).polylines;
    } else { setStatus(`"${file.name}" isn't a PDF, SVG or PLT.`, 'warn'); return; }
    state.kind = 'art'; state.pltBed = null;
    setFile(file.name);
    buildContours(polylines, 1);
    setStatus(`Loaded ${file.name} — ${state.contours.length} cut contour(s).`, 'ok');
  } catch (err) { setStatus('Could not read file: ' + err.message, 'err'); }
}

function setFile(name) {
  state.fileName = name;
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase();
  const k = $('fileKind'); k.textContent = state.kind === 'plt' ? 'PLT' : ext; k.className = 'kind' + (state.kind === 'plt' ? ' is-plt' : '');
  $('fileName').textContent = name; $('fileName').title = name;
  const isPlt = state.kind === 'plt';
  $('layoutCtrls').hidden = isPlt; $('pltNote').hidden = !isPlt; $('pltTag').hidden = !isPlt;
  $('svgCtrls').hidden = !/\.svg$/i.test(name);
}

// `scale` converts the polyline units to mm (1 for art, unitsPerMm for .plt)
function buildContours(polylines, scale) {
  state.contours = polylines.map((pts, i) => {
    const b = boundsOf([pts]);
    return { pts, selected: true, color: PALETTE[i % PALETTE.length],
      w: b ? (b.maxX - b.minX) / scale : 0, h: b ? (b.maxY - b.minY) / scale : 0, n: pts.length };
  });
  state.hover = -1;
  renderContours(); regenerate();
}

function clearFile() {
  Object.assign(state, { fileName: null, kind: null, contours: [], plt: null, pltBed: null, items: [], hover: -1 });
  $('layoutCtrls').hidden = false; $('pltNote').hidden = true; $('pltTag').hidden = true; $('svgCtrls').hidden = true;
  renderContours(); showOutput(); drawPreview();
}
$('clearBtn').addEventListener('click', clearFile);

function toggleOutputs(on) { ['exportBtn', 'saveStickBtn', 'sendLanBtn'].forEach(id => $(id).disabled = !on); }

$('fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
const drop = $('dropzone');
drop.addEventListener('click', () => $('fileInput').click());
// drop anywhere in the window
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('drag'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag');
  if (location.hash && location.hash !== '#studio') location.hash = '#studio';
  loadFile(e.dataTransfer.files[0]);
});
$('loadSample').addEventListener('click', async (e) => {
  e.stopPropagation();
  // the A4 test sheet: 4 registration dots + "Cut" spot-colour contours (scripts/make-sample.py)
  const buf = await (await fetch('./samples/kerf-sample-a4.pdf')).arrayBuffer();
  loadFile(new File([buf], 'kerf-sample-a4.pdf', { type: 'application/pdf' }));
});

// ---- contour list -----------------------------------------------------------
function renderContours() {
  const has = state.contours.length > 0, fixed = state.kind === 'plt';
  $('contours').hidden = !has; drop.hidden = has; $('clearBtn').hidden = !has;
  $('allBtn').hidden = fixed;
  $('contourCount').textContent = has ? `${state.contours.length} contour${state.contours.length > 1 ? 's' : ''}` : '';
  const list = $('contourList'); list.innerHTML = '';
  state.contours.forEach((c, i) => {
    const row = document.createElement('label'); row.className = 'contour-row' + (fixed ? ' fixed' : '');
    row.innerHTML = `${fixed ? '' : `<input type="checkbox" ${c.selected ? 'checked' : ''}>`}
      <span class="swatch" style="background:${c.color}"></span>
      <span>${i + 1}</span>
      <span class="meta">${c.w.toFixed(1)} × ${c.h.toFixed(1)} mm</span>`;
    row.title = `${c.n} points`;
    row.querySelector('input')?.addEventListener('change', (e) => { state.contours[i].selected = e.target.checked; regenerate(); });
    row.addEventListener('mouseenter', () => { state.hover = i; drawPreview(); });
    row.addEventListener('mouseleave', () => { state.hover = -1; drawPreview(); });
    list.appendChild(row);
  });
}
$('allBtn').addEventListener('click', () => {
  const anyOff = state.contours.some(c => !c.selected);
  state.contours.forEach(c => c.selected = anyOff);
  renderContours(); regenerate();
});

// ---- pipeline ---------------------------------------------------------------
function chooseRotation(selected, o) {
  if (o.rotate !== 'auto') return parseInt(o.rotate, 10) || 0;
  const fit = (deg) => { const a = rotateAndNormalize(selected, deg); return a.widthMm * o.unitsPerMm <= o.bedWunits && a.heightMm * o.unitsPerMm <= o.bedHunits; };
  if (fit(0)) return 0; if (fit(90)) return 90; return 0;
}

// Builds state.items: what the bed draws, in machine mm (x right, y up).
function regenerate() {
  const o = readOpts();
  if (state.kind === 'plt') {
    const u = o.unitsPerMm, bed = state.pltBed || { w: o.bedWunits, h: o.bedHunits };
    state.items = state.contours.map((c, i) => ({ i, color: c.color, pts: c.pts.map(p => ({ x: p.x / u, y: p.y / u })) }));
    const all = state.contours.flatMap(c => c.pts), b = boundsOf([all]);
    const fits = b.minX >= 0 && b.minY >= 0 && b.maxX <= bed.w && b.maxY <= bed.h;
    showOutput({ size: [(b.maxX - b.minX) / u, (b.maxY - b.minY) / u], fits, sub: `at ${(b.minX / u).toFixed(0)}, ${(b.minY / u).toFixed(0)} mm` });
    toggleOutputs(true); drawPreview(); return;
  }
  const sel = state.contours.map((c, i) => ({ c, i })).filter(x => x.c.selected);
  if (!sel.length) { state.plt = null; state.items = []; showOutput(); toggleOutputs(false); drawPreview(); return; }
  const selected = sel.map(x => x.c.pts);
  const rot = chooseRotation(selected, o);
  const art = rotateAndNormalize(selected, rot);
  state.plt = polylinesToHPGL(art.polylines, {
    widthMm: art.widthMm, heightMm: art.heightMm, place: o.place, flipY: o.flipY,
    unitsPerMm: o.unitsPerMm, bedWunits: o.bedWunits, bedHunits: o.bedHunits, cutTool: o.cutTool,
    originXmm: o.originXmm, originYmm: o.originYmm,
  });
  const bedWmm = o.bedWunits / o.unitsPerMm, bedHmm = o.bedHunits / o.unitsPerMm;
  const ax = o.place === 'origin' ? o.originXmm : (bedWmm - art.widthMm) / 2;
  const ay = o.place === 'origin' ? o.originYmm : (bedHmm - art.heightMm) / 2;
  state.items = art.polylines.map((pl, k) => ({ i: sel[k].i, color: sel[k].c.color,
    pts: pl.map(p => ({ x: ax + p.x, y: ay + (o.flipY ? art.heightMm - p.y : p.y) })) }));
  const fits = art.widthMm * o.unitsPerMm <= o.bedWunits && art.heightMm * o.unitsPerMm <= o.bedHunits;
  showOutput({ size: [art.widthMm, art.heightMm], fits, sub: `rot ${rot}°` });
  toggleOutputs(true); drawPreview();
}
Object.values(sc).forEach(c => c && c.addEventListener('change', regenerate));

// stat tiles + HPGL text
function showOutput(info) {
  const st = $('stats');
  if (!info || !state.plt) {
    st.innerHTML = ''; $('pltOut').value = ''; $('pltBytes').textContent = '';
    if (state.contours.length && state.kind === 'art') st.innerHTML = '<div class="stat"><b>—</b><span>nothing selected</span></div>';
    return;
  }
  const h = hpglStats(state.plt);
  const n = state.items.length;
  st.innerHTML = `
    <div class="stat wide${info.fits ? '' : ' bad'}"><b>${info.size[0].toFixed(1)} × ${info.size[1].toFixed(1)}</b><span>${info.fits ? 'mm · ' + info.sub : '⚠ exceeds bed'}</span></div>
    <div class="stat"><b>${n}</b><span>contour${n === 1 ? '' : 's'}</span></div>
    <div class="stat"><b>${h.pdCount.toLocaleString()}</b><span>points</span></div>
    <div class="stat"><b>${(h.bytes / 1024).toFixed(1)}</b><span>KB</span></div>`;
  // display only: fold the long header padding so the commands are readable
  $('pltOut').value = state.plt.replace(/ {16,}/g, (m) => ` ⟨${m.length} spaces⟩ `);
  $('pltBytes').textContent = `${h.bytes.toLocaleString()} bytes`;
}

// ---- bed preview (canvas sized to the bed, with mm rulers) ------------------
const M = { l: 42, r: 16, t: 16, b: 30 };   // ruler margins, CSS px
function bedDims() {
  const s = getSettings(), u = s.unitsPerMm || 40;
  const b = state.kind === 'plt' && state.pltBed ? state.pltBed : { w: s.bedWunits, h: s.bedHunits };
  return { w: b.w / u, h: b.h / u };
}
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawPreview() {
  const wrap = $('bedwrap'), canvas = $('preview');
  if (!wrap.clientWidth || !wrap.clientHeight) return;
  const bed = bedDims(), o = readOpts();
  const scale = Math.max(0.1, Math.min((wrap.clientWidth - M.l - M.r - 2) / bed.w, (wrap.clientHeight - M.t - M.b - 2) / bed.h));
  const W = Math.floor(bed.w * scale + M.l + M.r), H = Math.floor(bed.h * scale + M.t + M.b);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  $('view-studio').style.setProperty('--bed-h', H + 'px');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const SX = (x) => M.l + x * scale, SY = (y) => M.t + (bed.h - y) * scale;   // machine mm → screen (Y up)

  // bed
  ctx.fillStyle = css('--bed'); ctx.fillRect(SX(0), SY(bed.h), bed.w * scale, bed.h * scale);
  ctx.strokeStyle = css('--bedline'); ctx.lineWidth = 1;
  ctx.strokeRect(SX(0) + .5, SY(bed.h) + .5, bed.w * scale - 1, bed.h * scale - 1);

  // rulers: ticks every 10 mm, labels every 50 mm
  const muted = css('--muted');
  ctx.fillStyle = muted; ctx.strokeStyle = css('--bedline'); ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = 0; x <= bed.w + 0.01; x += 10) {
    const big = x % 50 === 0, px = Math.round(SX(x)) + .5;
    ctx.beginPath(); ctx.moveTo(px, SY(0)); ctx.lineTo(px, SY(0) + (big ? 7 : 4)); ctx.stroke();
    if (big) ctx.fillText(String(x), px, SY(0) + 10);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = 0; y <= bed.h + 0.01; y += 10) {
    const big = y % 50 === 0, py = Math.round(SY(y)) + .5;
    ctx.beginPath(); ctx.moveTo(SX(0), py); ctx.lineTo(SX(0) - (big ? 7 : 4), py); ctx.stroke();
    if (big) ctx.fillText(String(y), SX(0) - 10, py);
  }

  // origin marker (only meaningful for generated layouts)
  if (state.kind !== 'plt') {
    ctx.fillStyle = css('--warn');
    ctx.beginPath(); ctx.arc(SX(o.originXmm), SY(o.originYmm), 3.5, 0, 7); ctx.fill();
  }

  if (!state.items.length) {
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`${bed.w.toFixed(0)} × ${bed.h.toFixed(0)} mm bed`, SX(bed.w / 2), SY(bed.h / 2));
    return;
  }

  // travel moves between contours
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = muted; ctx.globalAlpha = .5;
  ctx.beginPath();
  for (let k = 1; k < state.items.length; k++) {
    const a = state.items[k - 1].pts.at(-1), b = state.items[k].pts[0];
    ctx.moveTo(SX(a.x), SY(a.y)); ctx.lineTo(SX(b.x), SY(b.y));
  }
  ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

  // cut lines
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const it of state.items) {
    const hot = state.hover === it.i, dim = state.hover >= 0 && !hot;
    ctx.globalAlpha = dim ? .25 : 1; ctx.lineWidth = hot ? 3 : 1.6; ctx.strokeStyle = it.color;
    ctx.beginPath(); ctx.moveTo(SX(it.pts[0].x), SY(it.pts[0].y));
    for (let k = 1; k < it.pts.length; k++) ctx.lineTo(SX(it.pts[k].x), SY(it.pts[k].y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
new ResizeObserver(() => drawPreview()).observe($('bedwrap'));

// ---- export / save-to-stick -------------------------------------------------
const baseName = () => (state.fileName || 'artwork').replace(/\.[^.]+$/, '');
$('exportBtn').addEventListener('click', () => {
  if (!state.plt) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.plt], { type: 'application/octet-stream' }));
  a.download = `${baseName()}.plt`; a.click(); URL.revokeObjectURL(a.href);
  setStatus(`Downloaded ${baseName()}.plt.`, 'ok');
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
  if (!fsSupported) throw new Error('This browser has no folder access. Use Chrome/Edge, or download the .plt.');
  if (stickDir) {
    if (await stickDir.queryPermission({ mode: 'readwrite' }) === 'granted') return stickDir;
    if (interactive && await stickDir.requestPermission({ mode: 'readwrite' }) === 'granted') return stickDir;
  }
  if (!interactive) return null;
  stickDir = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idb('put', stickDir); setStickNote(); return stickDir;
}
function setStickNote() {
  const b = $('saveStickBtn');
  b.title = !fsSupported ? 'Save to USB stick needs Chrome/Edge'
    : stickDir ? `Save to ${stickDir.name}/ (shift-click to pick another folder)` : 'Save to USB stick (asks for the stick once)';
}
$('saveStickBtn').addEventListener('click', async (e) => {
  if (!state.plt) return;
  try {
    if (e.shiftKey) stickDir = null;
    const dir = await ensureStick(true); if (!dir) return;
    const fh = await dir.getFileHandle(`${baseName()}.plt`, { create: true });
    const w = await fh.createWritable(); await w.write(state.plt); await w.close();
    setStatus(`Saved ${baseName()}.plt to ${dir.name}/.`, 'ok');
  } catch (err) { if (err?.name !== 'AbortError') setStatus('Save failed: ' + err.message, 'err'); }
});

// ---- send helpers -----------------------------------------------------------
const ipv = () => getSettings().ip;
const portv = () => String(getSettings().port);
function log(el, text) { if (el) { el.hidden = false; el.textContent = text; } }
async function send(plt, logEl, okMsg) {
  const btn = $('sendLanBtn'); btn.disabled = true;
  log(logEl, 'Sending…'); setStatus('Sending…');
  try {
    const j = await sendPlt(ipv(), portv(), plt);
    log(logEl, `✅ ${okMsg} (${j.bytes} bytes → ${ipv()}:${portv()})`);
    setStatus(okMsg, 'ok'); setConn('online');
    return true;
  } catch (err) {
    log(logEl, '❌ ' + err.message + '\nMachine must be on its main/ready screen.');
    setStatus('Send failed — is the machine on its ready screen?', 'err'); setConn('offline'); return false;
  } finally { btn.disabled = !state.plt; }
}
async function testConn(logEl) {
  log(logEl, `Testing ${ipv()}:${portv()}…`);
  setConn('checking');
  try {
    const ms = await pingMachine(ipv(), portv());
    log(logEl, `✅ Reached ${ipv()}:${portv()} in ${ms} ms — ready to receive.`);
    setConn('online'); startConnPoll(); return true;
  } catch (err) {
    log(logEl, `❌ ${ipv()}:${portv()} — ${err.message}\nMake sure the machine is on its main/ready screen.`);
    setConn('offline'); stopConnPoll(); return false;
  }
}
$('sendLanBtn').addEventListener('click', () => { if (state.plt) send(state.plt, $('lanLog'), 'Cut sent — the machine scans the marks, then cuts'); });

// ---- Machine config page ----------------------------------------------------
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
function updateBedNote() {
  const s = getSettings(), w = s.bedWunits / s.unitsPerMm, h = s.bedHunits / s.unitsPerMm;
  $('bedMmNote').textContent = `${w.toFixed(0)} × ${h.toFixed(0)} mm`;
  // origin map: the bed with the origin dot (Y up)
  const x = Math.min(Math.max(s.originXmm, 0), w), y = h - Math.min(Math.max(s.originYmm, 0), h);
  const svg = $('originSvg'); svg.setAttribute('viewBox', `-4 -4 ${w + 8} ${h + 8}`);
  svg.innerHTML = `<rect class="b" x="0" y="0" width="${w}" height="${h}" rx="4" vector-effect="non-scaling-stroke"/>
    <path class="c" d="M${x} 0V${h}M0 ${y}H${w}" vector-effect="non-scaling-stroke"/>
    <circle class="o" cx="${x}" cy="${y}" r="${Math.max(w, h) / 40}"/>`;
}
Object.values(cfg).forEach(el => el.addEventListener('input', () => {
  readConfig(); updateBedNote();
  if (state.kind === 'plt') buildContours(state.contours.map(c => c.pts), getSettings().unitsPerMm); else regenerate();
  setConn(connState);
}));
$('cfgTestBtn').addEventListener('click', () => testConn($('configLog')));
$('resetBtn').addEventListener('click', () => { resetSettings(); populateConfig(); regenerate(); setStatus('Settings reset to defaults.', 'ok'); });

// ---- connection pill --------------------------------------------------------
let connPoll = null, connState = 'idle';
function connLabelText() {
  return connState === 'online' ? ipv() : connState === 'offline' ? `${ipv()} · offline` : connState === 'checking' ? 'Checking…'
    : ipv();
}
function setConn(st) {
  connState = st;
  $('connWidget').className = 'pill ' + st;
  $('connLabel').textContent = connLabelText();
}
function stopConnPoll() { if (connPoll) { clearInterval(connPoll); connPoll = null; } }
function startConnPoll() { stopConnPoll(); connPoll = setInterval(async () => { try { await pingMachine(ipv(), portv()); setConn('online'); } catch { setConn('offline'); stopConnPoll(); } }, 15000); }
$('connWidget').addEventListener('click', () => testConn($('lanLog')));

// ---- Studio updates (git) ---------------------------------------------------
// The server checks the remote on launch; when this clone is behind, the app-bar
// chip appears and Machine settings → Kerf Studio pulls the update (fast-forward
// only), waits for the server to restart, then reloads.
const escHtml = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderVersion(v, err) {
  const st = $('verStatus'), list = $('verIncoming'), up = $('verUpdateBtn'), pill = $('updatePill');
  st.className = 'small'; list.hidden = true; up.disabled = true; pill.hidden = true;
  $('verNote').textContent = v?.current ? `${v.current} · ${v.date}` : '';
  if (err) { st.textContent = `Couldn't check for updates: ${err}`; st.classList.add('warn'); return; }
  if (!v.git || !v.upstream) { st.textContent = v.reason; return; }
  if (!v.behind) { st.textContent = 'Up to date.'; return; }
  st.textContent = `${v.behind} update${v.behind === 1 ? '' : 's'} available.`;
  list.innerHTML = v.incoming.map(l => `<li><span>${escHtml(l.slice(0, 10))}</span>${escHtml(l.slice(11))}</li>`).join('');
  list.hidden = false;
  if (v.dirty) { st.textContent += ' Files in this folder were changed by hand, so update with git pull.'; st.classList.add('warn'); }
  else up.disabled = false;
  $('updateLabel').textContent = `Update · ${v.behind} new`; pill.hidden = false;
}
async function checkUpdates(mode) {
  try { renderVersion(await getVersion(mode)); } catch (e) { renderVersion(null, e.message); }
}
$('verCheckBtn').addEventListener('click', () => { $('verStatus').textContent = 'Checking…'; checkUpdates('force'); });
$('verUpdateBtn').addEventListener('click', async () => {
  const b = $('verUpdateBtn'), st = $('verStatus');
  b.disabled = true; st.className = 'small'; st.textContent = 'Updating…';
  try {
    const r = await updateStudio();
    if (r.restarting) { st.textContent = 'Restarting…'; await waitForRestart(r.from); }
    location.reload();
  } catch (e) { st.textContent = `Update failed: ${e.message}`; st.classList.add('warn'); b.disabled = false; }
});

// ---- routing ----------------------------------------------------------------
const VIEWS = ['studio', 'config'];
function showView(v) {
  if (!VIEWS.includes(v)) v = 'studio';
  VIEWS.forEach(id => { $('view-' + id).hidden = id !== v; });
  document.querySelectorAll('header [data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  if (v === 'studio') requestAnimationFrame(drawPreview);
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && location.hash && location.hash !== '#studio') location.hash = '#studio'; });
showView(location.hash.slice(1) || 'studio');

// ---- toast ------------------------------------------------------------------
let toastTimer = null;
function setStatus(msg, kind = '') {
  const el = $('status'); el.textContent = msg; el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'warn' || kind === 'err' ? 8000 : 3500);
}

// ---- boot -------------------------------------------------------------------
populateConfig();
setStickNote();
(async () => { if (fsSupported) { try { const h = await idb('get'); if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'denied') stickDir = h; } catch {} setStickNote(); } })();

testConn(null);   // auto-check once
checkUpdates(true);
setInterval(() => checkUpdates(true), 6 * 3600e3);
drawPreview();
