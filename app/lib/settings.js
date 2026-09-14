// settings.js — persistent machine preferences (localStorage).
// Machine params live here (shared by Studio + Machine config). Per-artwork
// options (rotate, placement, sampling) stay in the Studio UI.

const KEY = 'kerf.settings.v1';

export const SETTINGS_DEFAULTS = Object.freeze({
  ip: '192.168.1.20',
  port: 5000,
  unitsPerMm: 40,      // plotter units per mm (confirmed for this machine)
  bedWunits: 11080,    // 277 mm
  bedHunits: 7600,     // 190 mm
  cutTool: 1,          // CT number
  tbParam: 25,         // TB<n> header value
  originXmm: 0,        // preconfigured origin, mm from bed bottom-left
  originYmm: 0,
});

let cache = null;

export function getSettings() {
  if (!cache) {
    try { cache = { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { cache = { ...SETTINGS_DEFAULTS }; }
  }
  return cache;
}

export function saveSettings(patch) {
  cache = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  document.dispatchEvent(new CustomEvent('settings-changed', { detail: cache }));
  return cache;
}

export function resetSettings() {
  cache = { ...SETTINGS_DEFAULTS };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  document.dispatchEvent(new CustomEvent('settings-changed', { detail: cache }));
  return cache;
}
