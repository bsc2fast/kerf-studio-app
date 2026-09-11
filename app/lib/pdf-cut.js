// pdf-cut.js
// Extract ONLY the "Cut" spot-colour paths from an Illustrator PDF, as polylines
// in millimetres (Y-down, to match svg-parse). Runs in the browser and in Node.
//
// Why by name, not colour: pdftocairo/print flatten the "Cut" spot into ambiguous
// greys, so colour matching is unreliable. Instead we read the PDF's own
// Separation colour space literally named "Cut" and keep the paths stroked/filled
// with it. Confirmed structure of these files (see docs/04): classic xref tables
// (no object/xref streams), FlateDecode streams, cut lines are strokes.
//
// Scope: handles the common Illustrator "Save as PDF" shape. If a PDF uses object
// streams or nests cut art inside form XObjects, extraction may come back empty —
// the caller should then fall back to "export the Cut layer as SVG".

const PT_TO_MM = 25.4 / 72;

/** Inflate FlateDecode bytes. DecompressionStream is strict about trailing junk,
 *  so we try zlib then raw, and if both hard-fail we recover the bytes decoded
 *  before the error via a manual pull loop. */
async function inflateOnce(bytes, format) {
  const ds = new DecompressionStream(format);
  const stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await stream.arrayBuffer());
}
async function inflate(bytes) {
  for (const fmt of ['deflate', 'deflate-raw']) {
    try { return await inflateOnce(bytes, fmt); } catch { /* try next */ }
  }
  // Tolerant recovery: decode until the stream errors, keep what we got.
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const ds = new DecompressionStream(fmt);
      const writer = ds.writable.getWriter();
      writer.write(bytes); writer.close().catch(() => {});
      const reader = ds.readable.getReader();
      const chunks = []; let n = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let r; try { r = await reader.read(); } catch { break; }
        if (r.done) break; chunks.push(r.value); n += r.value.length;
      }
      if (n > 0) { const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; }
    } catch { /* try next */ }
  }
  throw new Error('inflate failed');
}

/** Resolve a /Length that may be a direct integer or an indirect reference. */
function readLength(dict, raw, objs) {
  const dm = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  if (dm) return parseInt(dm[1], 10);
  const rm = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (rm) { const o = objs.get(`${rm[1]} ${rm[2]}`); if (o) { const v = /(\d+)/.exec(raw.slice(o.bodyStart, o.end)); if (v) return parseInt(v[1], 10); } }
  return null;
}

/** Extract a stream object's raw (still-compressed) bytes, sliced to /Length. */
function streamBytes(objStr, raw, objs) {
  const sIdx = objStr.indexOf('stream');
  if (sIdx < 0) return null;
  const dict = objStr.slice(0, sIdx);
  let dstart = sIdx + 6;
  if (objStr[dstart] === '\r') dstart++;
  if (objStr[dstart] === '\n') dstart++;
  const len = readLength(dict, raw, objs);
  let end;
  if (len != null) end = dstart + len;
  else { end = objStr.lastIndexOf('endstream'); while (end > dstart && (objStr[end-1] === '\n' || objStr[end-1] === '\r')) end--; }
  return { dict, bytes: fromLatin1(objStr.slice(dstart, end)), isFlate: /\/FlateDecode\b/.test(dict) };
}

/** Bytes -> Latin1 string (1 char per byte, so string index == byte offset). */
function toLatin1(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
  }
  return s;
}
function fromLatin1(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
}

/**
 * @param {Uint8Array} pdfBytes
 * @param {object} opts  { flatnessPt?: number }  curve flattening tolerance in points
 * @returns {Promise<{polylines:{x:number,y:number}[][], pageWidthMm:number, pageHeightMm:number, cutFound:boolean}>}
 */
export async function extractCutPolylines(pdfBytes, opts = {}) {
  const flatnessPt = opts.flatnessPt ?? 0.15;
  const raw = toLatin1(pdfBytes);

  // --- index every "N G obj ... endobj" (offset-scan, robust vs xref styles) ---
  const objs = new Map(); // "num gen" -> {start, end}
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = `${m[1]} ${m[2]}`;
    const start = m.index + m[0].length;
    const end = raw.indexOf('endobj', start);
    if (end > 0) objs.set(key, { start, end, bodyStart: start });
  }
  const getObj = (numGen) => objs.get(numGen);
  const resolve = (token, dictStr) => {
    // token like "12 0 R" -> return that object's body string; else the literal
    const r = /^(\d+)\s+(\d+)\s+R$/.exec(token.trim());
    if (r) { const o = getObj(`${r[1]} ${r[2]}`); return o ? raw.slice(o.bodyStart, o.end) : null; }
    return token;
  };

  // --- find a Page object + its MediaBox, Contents, Resources ---
  let pageBody = null;
  for (const [, o] of objs) {
    const body = raw.slice(o.bodyStart, o.end);
    if (/\/Type\s*\/Page\b/.test(body) && !/\/Type\s*\/Pages\b/.test(body)) { pageBody = body; break; }
  }
  if (!pageBody) throw new Error('No page object found in PDF.');

  const mediaBox = readMediaBox(pageBody, raw, objs) || [0, 0, 595.276, 841.89];
  const pageWpt = mediaBox[2] - mediaBox[0];
  const pageHpt = mediaBox[3] - mediaBox[1];

  // --- page Resources + content ---
  const pageRes = extractRefDict(pageBody, 'Resources', raw, objs);
  const contentBytes = await getContent(pageBody, raw, objs);
  const content = toLatin1(contentBytes);

  // Pre-inflate every reachable Form XObject (the cut art lives inside these).
  const forms = new Map(); // objKey -> { content, resStr, matrix }
  await prepareForms(pageRes, forms, raw, objs, new Set());

  // --- interpret (recurses into forms) ---
  const polylines = [];
  interpret(content, pageRes, [1, 0, 0, 1, 0, 0], null, forms, raw, objs, flatnessPt, polylines, 0);

  // PDF space (points, Y-up, origin at mediaBox min) -> mm, Y-down
  const out = polylines.map(pl => pl.map(p => ({
    x: (p.x - mediaBox[0]) * PT_TO_MM,
    y: (pageHpt - (p.y - mediaBox[1])) * PT_TO_MM,
  })));

  return {
    polylines: out.filter(pl => pl.length >= 2),
    pageWidthMm: pageWpt * PT_TO_MM,
    pageHeightMm: pageHpt * PT_TO_MM,
    cutFound: /\/Separation\s*\/Cut\b/i.test(raw),
  };
}

function readMediaBox(pageBody, raw, objs) {
  let mb = /\/MediaBox\s*\[([^\]]+)\]/.exec(pageBody);
  if (!mb) { // maybe inherited from Pages; try any Pages object
    for (const [, o] of objs) {
      const b = raw.slice(o.bodyStart, o.end);
      if (/\/Type\s*\/Pages\b/.test(b)) { mb = /\/MediaBox\s*\[([^\]]+)\]/.exec(b); if (mb) break; }
    }
  }
  return mb ? mb[1].trim().split(/\s+/).map(Number) : null;
}

/** Get a dict that may be inline (<< >>) or an indirect ref, by key. Returns string. */
function extractRefDict(body, key, raw, objs) {
  const reInline = new RegExp('/' + key + '\\s*<<');
  const im = reInline.exec(body);
  if (im) { return sliceBalancedDict(body, im.index + im[0].length - 2); }
  const reRef = new RegExp('/' + key + '\\s+(\\d+)\\s+(\\d+)\\s+R');
  const rm = reRef.exec(body);
  if (rm) { const o = objs.get(`${rm[1]} ${rm[2]}`); if (o) return raw.slice(o.bodyStart, o.end); }
  return '';
}

/** Given index of "<<", return the balanced dict substring. */
function sliceBalancedDict(str, ltlt) {
  let depth = 0, i = ltlt;
  for (; i < str.length - 1; i++) {
    if (str[i] === '<' && str[i + 1] === '<') { depth++; i++; }
    else if (str[i] === '>' && str[i + 1] === '>') { depth--; i++; if (depth === 0) return str.slice(ltlt, i + 1); }
  }
  return str.slice(ltlt);
}

/** In a Resources dict, find ColorSpace resource names bound to Separation /Cut. */
function findCutColorSpaceNames(resStr, raw, objs) {
  const names = new Set();
  if (!resStr) return names;
  const csStr = extractRefDict(resStr, 'ColorSpace', raw, objs);
  if (!csStr) return names;
  // entries look like: /CS0 12 0 R   or   /CS0 [/Separation /Cut ...]
  const entry = /\/([A-Za-z0-9_.]+)\s+(?:(\d+)\s+(\d+)\s+R|\[)/g;
  let e;
  while ((e = entry.exec(csStr))) {
    const name = e[1];
    let def;
    if (e[2]) { const o = objs.get(`${e[2]} ${e[3]}`); def = o ? raw.slice(o.bodyStart, o.end) : ''; }
    else { def = sliceBalancedArray(csStr, e.index + e[0].length - 1); }
    if (/\/Separation\s*\/Cut\b/i.test(def)) names.add(name);
  }
  return names;
}

function sliceBalancedArray(str, lb) {
  let depth = 0, i = lb;
  for (; i < str.length; i++) {
    if (str[i] === '[') depth++;
    else if (str[i] === ']') { depth--; if (depth === 0) return str.slice(lb, i + 1); }
  }
  return str.slice(lb);
}

/** Fetch + concatenate + inflate the page content stream(s). */
async function getContent(pageBody, raw, objs) {
  // /Contents may be a ref or an array of refs
  let refs = [];
  const arr = /\/Contents\s*\[([^\]]+)\]/.exec(pageBody);
  const single = /\/Contents\s+(\d+)\s+(\d+)\s+R/.exec(pageBody);
  if (arr) { const rr = /(\d+)\s+(\d+)\s+R/g; let x; while ((x = rr.exec(arr[1]))) refs.push(`${x[1]} ${x[2]}`); }
  else if (single) refs.push(`${single[1]} ${single[2]}`);
  if (!refs.length) throw new Error('Page has no /Contents.');

  const chunks = [];
  for (const key of refs) {
    const o = objs.get(key);
    if (!o) continue;
    const sb = streamBytes(raw.slice(o.bodyStart, o.end), raw, objs);
    if (!sb) continue;
    let data = sb.bytes;
    if (sb.isFlate) { try { data = await inflate(data); } catch { /* leave as-is */ } }
    chunks.push(data);
    chunks.push(fromLatin1('\n')); // separate concatenated content streams
  }
  // join
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Uint8Array(total);
  let off = 0; for (const c of chunks) { all.set(c, off); off += c.length; }
  return all;
}

/** name -> objKey for Form/Image XObjects declared in a Resources dict. */
function findXObjectMap(resStr, raw, objs) {
  const map = new Map();
  if (!resStr) return map;
  const xoStr = extractRefDict(resStr, 'XObject', raw, objs);
  if (!xoStr) return map;
  const e = /\/([A-Za-z0-9_.]+)\s+(\d+)\s+(\d+)\s+R/g; let x;
  while ((x = e.exec(xoStr))) map.set(x[1], `${x[2]} ${x[3]}`);
  return map;
}

/** Recursively inflate all Form XObjects reachable from a Resources dict. */
async function prepareForms(resStr, forms, raw, objs, seen) {
  const map = findXObjectMap(resStr, raw, objs);
  for (const [, key] of map) {
    if (seen.has(key)) continue; seen.add(key);
    const o = objs.get(key); if (!o) continue;
    const objStr = raw.slice(o.bodyStart, o.end);
    const sb = streamBytes(objStr, raw, objs);
    if (!sb) continue;
    const dict = sb.dict;
    if (!/\/Subtype\s*\/Form\b/.test(dict)) continue; // skip images
    let data = sb.bytes;
    if (sb.isFlate) { try { data = await inflate(data); } catch {} }
    const mMat = /\/Matrix\s*\[([^\]]+)\]/.exec(dict);
    const matrix = mMat ? mMat[1].trim().split(/\s+/).map(Number) : [1, 0, 0, 1, 0, 0];
    const formRes = extractRefDict(dict + ' ', 'Resources', raw, objs);
    forms.set(key, { content: toLatin1(data), resStr: formRes, matrix });
    await prepareForms(formRes, forms, raw, objs, seen);
  }
}

const mulM = (a, b) => [
  a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
  a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
  a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5],
];

// ---- content-stream interpreter (recurses into Form XObjects) -------------
function interpret(content, resStr, ctm0, parentCutNames, forms, raw, objs, flatnessPt, out, depth) {
  if (depth > 12) return;
  let cutCSNames = findCutColorSpaceNames(resStr, raw, objs);
  if (cutCSNames.size === 0 && parentCutNames) cutCSNames = parentCutNames; // inherit
  const xobjMap = findXObjectMap(resStr, raw, objs);
  const tokens = tokenize(content);
  const polylines = out;

  let ctm = ctm0.slice();
  const gstack = [];
  let strokeIsCut = false, fillIsCut = false;
  let cur = { x: 0, y: 0 };     // current point (user space)
  let start = { x: 0, y: 0 };
  let subpaths = [];            // array of point arrays (user space), for current path
  let poly = null;

  const stack = [];
  const num = (t) => parseFloat(t);
  const apply = (M, x, y) => ({ x: M[0] * x + M[2] * y + M[4], y: M[1] * x + M[3] * y + M[5] });
  const mul = (a, b) => [ // a*b (both 6-elem affine)
    a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
    a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
    a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5],
  ];
  const moveTo = (x, y) => { start = { x, y }; cur = { x, y }; poly = [{ x, y }]; subpaths.push(poly); };
  const lineTo = (x, y) => { cur = { x, y }; if (!poly) { poly = [{ x: start.x, y: start.y }]; subpaths.push(poly); } poly.push({ x, y }); };
  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    flattenCubic(cur.x, cur.y, x1, y1, x2, y2, x3, y3, flatnessPt, (px, py) => { if (poly) poly.push({ x: px, y: py }); });
    cur = { x: x3, y: y3 };
  };
  const emitIfCut = () => {
    if ((strokeIsCut || fillIsCut) && subpaths.length) {
      for (const sp of subpaths) if (sp.length >= 2) polylines.push(sp.map(p => apply(ctm, p.x, p.y)));
    }
    subpaths = []; poly = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.op === undefined) { stack.push(t.v); continue; }
    const op = t.op;
    const n = stack.length;
    switch (op) {
      case 'q': gstack.push({ ctm: ctm.slice(), strokeIsCut, fillIsCut }); break;
      case 'Q': { const s = gstack.pop(); if (s) { ctm = s.ctm; strokeIsCut = s.strokeIsCut; fillIsCut = s.fillIsCut; } break; }
      case 'cm': if (n >= 6) ctm = mul([num(stack[n-6]),num(stack[n-5]),num(stack[n-4]),num(stack[n-3]),num(stack[n-2]),num(stack[n-1])], ctm); break;
      case 'm': if (n >= 2) moveTo(num(stack[n-2]), num(stack[n-1])); break;
      case 'l': if (n >= 2) lineTo(num(stack[n-2]), num(stack[n-1])); break;
      case 'c': if (n >= 6) curveTo(num(stack[n-6]),num(stack[n-5]),num(stack[n-4]),num(stack[n-3]),num(stack[n-2]),num(stack[n-1])); break;
      case 'v': if (n >= 4) curveTo(cur.x,cur.y,num(stack[n-4]),num(stack[n-3]),num(stack[n-2]),num(stack[n-1])); break;
      case 'y': if (n >= 4) curveTo(num(stack[n-4]),num(stack[n-3]),num(stack[n-2]),num(stack[n-1]),num(stack[n-2]),num(stack[n-1])); break;
      case 're': if (n >= 4) { const x=num(stack[n-4]),y=num(stack[n-3]),w=num(stack[n-2]),h=num(stack[n-1]); moveTo(x,y); lineTo(x+w,y); lineTo(x+w,y+h); lineTo(x,y+h); lineTo(x,y); } break;
      case 'h': if (poly && poly.length) poly.push({ x: start.x, y: start.y }); break;
      case 'CS': if (n >= 1) strokeIsCut = cutCSNames.has(String(stack[n-1])); break;
      case 'cs': if (n >= 1) fillIsCut = cutCSNames.has(String(stack[n-1])); break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': emitIfCut(); break;
      case 'n': subpaths = []; poly = null; break; // path ends with no paint
      case 'Do': if (n >= 1) {
        const nm = String(stack[n-1]); const key = xobjMap.get(nm); const f = key && forms.get(key);
        if (f) interpret(f.content, f.resStr, mulM(f.matrix, ctm), cutCSNames, forms, raw, objs, flatnessPt, out, depth + 1);
      } break;
      default: break;
    }
    stack.length = 0; // operands consumed at each operator
  }
  return polylines;
}

/** Tokenizer for the subset of content-stream syntax we need. */
function tokenize(s) {
  const out = [];
  let i = 0; const N = s.length;
  const isWS = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
  const isDelim = (c) => '()<>[]{}/%'.includes(c);
  while (i < N) {
    const c = s[i];
    if (isWS(c)) { i++; continue; }
    if (c === '%') { while (i < N && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '/') { let j = i + 1; while (j < N && !isWS(s[j]) && !isDelim(s[j])) j++; out.push({ v: s.slice(i + 1, j) }); i = j; continue; }
    if (c === '(') { // literal string — skip (not needed for geometry)
      let depth = 0, j = i;
      for (; j < N; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === '(') depth++; else if (s[j] === ')') { depth--; if (depth === 0) { j++; break; } } }
      i = j; continue;
    }
    if (c === '<') { if (s[i + 1] === '<') { out.push({ op: '<<' }); i += 2; continue; } let j = s.indexOf('>', i); i = (j < 0 ? N : j + 1); continue; }
    if (c === '>') { if (s[i + 1] === '>') { out.push({ op: '>>' }); i += 2; continue; } i++; continue; }
    if (c === '[' || c === ']' || c === '{' || c === '}') { i++; continue; }
    if (c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) {
      let j = i + 1; while (j < N && '0123456789.+-eE'.includes(s[j])) j++;
      out.push({ v: s.slice(i, j) }); i = j; continue;
    }
    // bare keyword / operator
    let j = i; while (j < N && !isWS(s[j]) && !isDelim(s[j])) j++;
    let word = s.slice(i, j);
    if (word.length === 0) { i++; continue; }
    // handle f* B* b* (star may be split)
    out.push({ op: word });
    i = j;
  }
  return out;
}

/** Recursive cubic flattening by max deviation (tolerance in same units as coords). */
function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, tol, emit, depth = 0) {
  const d1 = Math.abs((x1 - x3) * (y0 - y3) - (x0 - x3) * (y1 - y3));
  const d2 = Math.abs((x2 - x3) * (y0 - y3) - (x0 - x3) * (y2 - y3));
  if (depth > 18 || (d1 + d2) * (d1 + d2) < tol * tol * ((x0 - x3) ** 2 + (y0 - y3) ** 2 + 1e-9)) {
    emit(x3, y3); return;
  }
  const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const xa = (x01 + x12) / 2, ya = (y01 + y12) / 2;
  const xb = (x12 + x23) / 2, yb = (y12 + y23) / 2;
  const xm = (xa + xb) / 2, ym = (ya + yb) / 2;
  flattenCubic(x0, y0, x01, y01, xa, ya, xm, ym, tol, emit, depth + 1);
  flattenCubic(xm, ym, xb, yb, x23, y23, x3, y3, tol, emit, depth + 1);
}
