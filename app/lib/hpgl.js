// hpgl.js
// Convert polylines (in mm) into a .plt stream byte-faithful to this machine.
//
// Ground truth was reverse-engineered from working files in ../captures:
//   Header:  TB25,<bedW>,<bedH>;CT1;  + 1025 spaces +  IN;
//   Body:    per contour ->  PU<x>,<y>;  then one  PD<x>,<y>;  per point
//   Footer:  PU<bedW+200>,200;  PG;      (park + page-eject)
// Coordinates are plotter units at 40 units/mm (confirmed: a 250mm feature = 10000
// units). Origin is bottom-left, Y up. The design is centred on the bed (the
// eyelet sat at the exact bed centre 5540,3800 in every sample).
//
// No SP (pen-select) command is used — the machine uses CT for the cut tool.

export const MACHINE_DEFAULTS = Object.freeze({
  unitsPerMm: 40,
  bedWunits: 11080,   // 277 mm
  bedHunits: 7600,    // 190 mm
  tbParam: 25,        // TB<n> — constant in all captured files (speed/force group)
  cutTool: 1,         // CT<n>
  headerPadSpaces: 1025,
});

/**
 * @param {{x:number,y:number}[][]} polylines  points in mm, min corner at (0,0)
 * @param {object} opts
 * @param {number} opts.widthMm   art width in mm  (bounds width)
 * @param {number} opts.heightMm  art height in mm (bounds height)
 * @param {'center'|'origin'} opts.place  where to put the art on the bed
 * @param {boolean} opts.flipY   flip Y so origin is bottom-left (default true)
 * @param {...} machine overrides (unitsPerMm, bedWunits, bedHunits, tbParam, cutTool, headerPadSpaces)
 * @returns {string} the .plt text (one continuous line, like the machine's files)
 */
export function polylinesToHPGL(polylines, opts = {}) {
  const m = { ...MACHINE_DEFAULTS, ...opts };
  const { unitsPerMm: u, bedWunits: BW, bedHunits: BH } = m;
  const place = opts.place ?? 'center';
  const flipY = opts.flipY ?? true;
  const widthMm = opts.widthMm ?? 0;
  const heightMm = opts.heightMm ?? 0;

  // Offset that positions the art box on the bed.
  const artWu = widthMm * u, artHu = heightMm * u;
  const offX = place === 'center' ? (BW - artWu) / 2 : 0;
  const offY = place === 'center' ? (BH - artHu) / 2 : 0;

  const X = (mm) => Math.round(offX + mm * u);
  const Y = (mm) => {
    const py = offY + mm * u;
    return Math.round(flipY ? (BH - py) : py);
  };

  const parts = [];
  parts.push(`TB${m.tbParam},${BW},${BH};CT${m.cutTool};`);
  parts.push(' '.repeat(m.headerPadSpaces));
  parts.push('IN;');

  for (const pl of polylines) {
    if (pl.length < 2) continue;
    parts.push(`PU${X(pl[0].x)},${Y(pl[0].y)};`);
    for (let i = 1; i < pl.length; i++) parts.push(`PD${X(pl[i].x)},${Y(pl[i].y)};`);
  }

  parts.push(`PU${BW + 200},200;`);
  parts.push('PG;');
  return parts.join('');
}

/** Stats for the UI. */
export function hpglStats(plt) {
  return {
    bytes: plt.length,
    pdCount: (plt.match(/PD/g) || []).length,
    puCount: (plt.match(/PU/g) || []).length,
  };
}
