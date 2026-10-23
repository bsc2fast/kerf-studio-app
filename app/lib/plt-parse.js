// plt-parse.js
// Read an existing .plt (HPGL) back into polylines, for preview only. The file
// itself is never rewritten: an uploaded .plt is sent byte-for-byte.
//
// Understands what this machine's files use (see docs/04-plt-format-decoded.md):
//   TB<n>,<bedW>,<bedH>;  CT<n>;  IN;  PU<x>,<y>;  PD<x>,<y>[,<x>,<y>…];  PG;
// Coordinates stay in plotter units (origin bottom-left, Y up).

/**
 * @param {string} text  the .plt contents
 * @returns {{ polylines: {x:number,y:number}[][], bedWunits?: number, bedHunits?: number, cutTool?: number }}
 */
export function parsePlt(text) {
  const out = { polylines: [] };
  let cur = null, pen = { x: 0, y: 0 };
  const flush = () => { if (cur && cur.length > 1) out.polylines.push(cur); cur = null; };

  for (const raw of text.split(';')) {
    const cmd = raw.trim();
    if (cmd.length < 2) continue;
    const op = cmd.slice(0, 2).toUpperCase();
    const nums = (cmd.slice(2).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

    if (op === 'TB' && nums.length >= 3) { out.bedWunits = nums[1]; out.bedHunits = nums[2]; }
    else if (op === 'CT' && nums.length) out.cutTool = nums[0];
    else if (op === 'PU') {
      flush();
      for (let i = 0; i + 1 < nums.length; i += 2) pen = { x: nums[i], y: nums[i + 1] };
    } else if (op === 'PD') {
      if (!cur) cur = [{ ...pen }];
      for (let i = 0; i + 1 < nums.length; i += 2) { pen = { x: nums[i], y: nums[i + 1] }; cur.push(pen); }
    }
  }
  flush();
  return out;
}
