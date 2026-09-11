// serial.js
// Phase B: send the .plt straight to the machine over Web Serial (Chrome/Edge).
//
// This is EXPERIMENTAL until we confirm the machine's direct USB port shows up as
// a serial device on macOS (see scripts/detect.sh). The converter + .plt export do
// not depend on any of this — you can keep using the flash drive meanwhile.
//
// Web Serial requires a secure context: run the app from http://localhost (see
// scripts/serve.sh), not from a file:// path.

export function serialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export class CutterSerial {
  constructor() {
    this.port = null;
    this._open = false;
  }

  /** Reuse a previously-granted port (survives page reloads) without a picker. */
  async tryRestorePort() {
    if (!serialSupported() || this.port) return this.port;
    try { const ports = await navigator.serial.getPorts(); if (ports && ports[0]) this.port = ports[0]; } catch {}
    return this.port;
  }

  /** Ensure we have a granted port. requestPort() needs a user gesture (a click). */
  async ensurePicked() {
    if (!serialSupported()) throw new Error('Web Serial not available. Use Chrome or Edge on desktop, over localhost.');
    if (!this.port) this.port = await navigator.serial.requestPort();
    return this.port;
  }

  /** Open (or re-open) the granted port with the given line settings. */
  async openWith({ baudRate = 9600, flowControl = 'none', assertSignals = true,
                   dataBits = 8, stopBits = 1, parity = 'none' } = {}) {
    await this.ensurePicked();
    if (this._open) { try { await this.port.close(); } catch {} this._open = false; }
    await this.port.open({ baudRate, flowControl, dataBits, stopBits, parity });
    this._open = true;
    if (assertSignals) { try { await this.port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch {} }
  }

  /** Close the port but keep the grant (so we can re-open without re-picking). */
  async closePort() { if (this._open) { try { await this.port.close(); } catch {} this._open = false; } }

  /** Convenience for the manual single-connect UI. */
  async connect(settings = {}) { await this.openWith(settings); return this.describe(); }

  /** Build + send a SAFE pen-up-only test (no cutting). Includes PG; so the
   *  machine EXECUTES the job (many cutters buffer until they see PG;). */
  async sendPenUpTest() {
    const pad = ' '.repeat(1025);
    const payload = `TB25,11080,7600;CT1;${pad}IN;PU5540,3800;PU1500,1500;PU5540,3800;PU11280,200;PG;`;
    await this.send(payload);
    return payload.length;
  }

  /** Read up to `ms` milliseconds of bytes from the machine. */
  async read(ms = 2000) {
    if (!this.port?.readable) return new Uint8Array(0);
    const reader = this.port.readable.getReader();
    const chunks = []; let total = 0;
    const timer = new Promise((res) => setTimeout(res, ms));
    try {
      while (true) {
        const r = await Promise.race([reader.read(), timer.then(() => ({ timeout: true }))]);
        if (r.timeout || r.done) break;
        if (r.value) { chunks.push(r.value); total += r.value.length; }
      }
    } catch { /* ignore */ } finally { try { reader.releaseLock(); } catch {} }
    const out = new Uint8Array(total); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /** Ask the machine to identify itself (HPGL output queries) and read any reply.
   *  Non-destructive — no movement. Returns the raw bytes received. */
  async probe(ms = 2000) {
    await this.send('\x1b.@;OI;OH;OA;OF;');
    return this.read(ms);
  }

  describe() {
    if (!this.port) return null;
    const info = this.port.getInfo?.() || {};
    return {
      usbVendorId: info.usbVendorId ?? null,
      usbProductId: info.usbProductId ?? null,
    };
  }

  /** Send a string (the .plt text) to the machine. */
  async send(text) {
    if (!this.port) throw new Error('Not connected. Click Connect first.');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() { await this.closePort(); }
}
