// svg-parse.js
// Turn an SVG into a set of polylines (arrays of {x,y} points, in millimetres).
//
// Strategy: we DON'T write our own Bézier/arc math. Every drawable SVG element
// (path, line, polyline, polygon, rect, circle, ellipse) is an SVGGeometryElement,
// which the browser can sample for us via getTotalLength()/getPointAtLength().
// We walk along each element at a fixed step and record points, mapping them
// through the element's transform matrix (getCTM) into the SVG's own coordinate
// system, then into millimetres.
//
// Subpaths (a <path> with multiple "M" moves) show up as large jumps between
// consecutive samples; we split the polyline there so we never cut a stray line
// between two separate shapes.

const GEO_SELECTOR = 'path, line, polyline, polygon, rect, circle, ellipse';

/**
 * @param {string} svgText  raw SVG file contents
 * @param {object} opts
 * @param {number} opts.userUnitsPerMm  how many SVG user units equal 1 mm.
 *        (Calibrated later against a known-good .plt. Default assumes the SVG's
 *         user units are CSS px at 96dpi: 96px/25.4mm ≈ 3.7795 units/mm.)
 * @param {number} opts.sampleStepMm  spacing between sampled points, in mm.
 * @returns {{polylines: {x:number,y:number}[][], widthMm:number, heightMm:number, count:number}}
 */
export function svgToPolylines(svgText, opts = {}) {
  const userUnitsPerMm = opts.userUnitsPerMm ?? (96 / 25.4);
  const sampleStepMm = opts.sampleStepMm ?? 0.3;
  const stepUU = sampleStepMm * userUnitsPerMm; // sampling step in user units
  const jumpUU = stepUU * 4;                     // gap => new subpath/polyline

  // Parse the SVG and mount it hidden in the DOM so geometry APIs work.
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('Could not parse SVG file.');
  const svg = doc.documentElement;

  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;';
  holder.appendChild(svg);
  document.body.appendChild(holder);

  const polylines = [];
  try {
    const els = svg.querySelectorAll(GEO_SELECTOR);
    for (const el of els) {
      let len = 0;
      try { len = el.getTotalLength(); } catch { continue; }
      if (!isFinite(len) || len <= 0) continue;

      const ctm = el.getCTM(); // element local coords -> SVG viewport coords
      let current = [];
      let prev = null;

      const pushPoint = (d) => {
        const p = el.getPointAtLength(Math.min(d, len));
        const v = ctm ? new DOMPoint(p.x, p.y).matrixTransform(ctm) : p;
        if (prev) {
          const dx = v.x - prev.x, dy = v.y - prev.y;
          if (Math.hypot(dx, dy) > jumpUU) {        // discontinuity => break here
            if (current.length > 1) polylines.push(current);
            current = [];
          }
        }
        current.push({ x: v.x / userUnitsPerMm, y: v.y / userUnitsPerMm });
        prev = v;
      };

      // getTotalLength/getPointAtLength are in the element's own units; under a
      // scale() transform the step has to shrink by that scale, or the samples
      // come out coarser than sampleStepMm and break into false subpaths.
      const elScale = ctm ? Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1 : 1;
      const stepEl = stepUU / elScale;
      for (let d = 0; d < len; d += stepEl) pushPoint(d);
      pushPoint(len); // always include the exact endpoint
      if (current.length > 1) polylines.push(current);
    }
  } finally {
    holder.remove();
  }

  // Normalise so the artwork's top-left bounding corner sits at (0,0) in mm.
  const bounds = boundsOf(polylines);
  if (bounds) {
    for (const pl of polylines) for (const pt of pl) { pt.x -= bounds.minX; pt.y -= bounds.minY; }
  }

  return {
    polylines,
    widthMm: bounds ? bounds.maxX - bounds.minX : 0,
    heightMm: bounds ? bounds.maxY - bounds.minY : 0,
    count: polylines.length,
  };
}

/**
 * Rotate polylines by 0/90/180/270 degrees (clockwise) and re-normalise so the
 * min corner sits at (0,0). Returns {polylines, widthMm, heightMm}.
 * Used to match SignMaster's portrait->landscape auto-rotate.
 */
export function rotateAndNormalize(polylines, deg = 0) {
  const d = ((deg % 360) + 360) % 360;
  const rot = (p) => {
    switch (d) {
      case 90:  return { x: -p.y, y: p.x };
      case 180: return { x: -p.x, y: -p.y };
      case 270: return { x: p.y, y: -p.x };
      default:  return { x: p.x, y: p.y };
    }
  };
  const out = polylines.map(pl => pl.map(rot));
  const b = boundsOf(out);
  if (b) for (const pl of out) for (const p of pl) { p.x -= b.minX; p.y -= b.minY; }
  return {
    polylines: out,
    widthMm: b ? b.maxX - b.minX : 0,
    heightMm: b ? b.maxY - b.minY : 0,
  };
}

export function boundsOf(polylines) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) for (const p of pl) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
