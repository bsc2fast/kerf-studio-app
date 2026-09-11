# 02 — SignMaster fast-track (this is our shortcut)

The machine is driven by **SignMaster Pro** (a standard, widely-used sign/cutting
program) on a **Windows** machine we have access to. This is great news and
changes our plan for the better. Instead of guessing the machine's language, we
let SignMaster tell us — and then copy exactly what it sends.

## Why this helps

- SignMaster only supports machines that speak **known languages** (HPGL, GPGL,
  DMPL, and a few others). Our "unbranded" machine must be a **clone of a model
  SignMaster supports** — so it already speaks a documented language.
- The cutter profile you selected inside SignMaster **names that model** (and thus
  the language + connection type). That's the single most useful fact to grab.
- With Windows + SignMaster in hand, we can **capture the exact byte stream**
  SignMaster sends for a real cut, then replay it from the Mac. No blind guessing.

## What to grab from SignMaster (Windows) — Phase 1 fast version

Open SignMaster and find the **Cutter/Plotter setup** (often under a "Cut/Plot"
or "Vinyl Spooler" / "Cutter Setup" menu). Note:

1. **Exact cutter make + model** selected in the machine list.  ← most important
   - e.g. "Generic HPGL", "Graphtec ...", "GCC ...", "Redsail", "Creation ...".
   - Even the *category* (Generic HPGL / Generic GPGL) tells us the language.
2. **Connection / port** it's set to: a **COM port** (serial), a **USB** entry,
   or a **network/TCP IP + port**.
3. If serial: the **baud rate / parity / flow control** shown in the port
   settings (write these down — the Mac must match them exactly).
4. Any **units / step size / scale** setting in the cutter profile.

Photograph or type these into [01-machine-profile.md](01-machine-profile.md).

## Capturing the actual command stream (Phase 2b, now easy)

We want the raw bytes SignMaster sends. Easiest options, best-first:

### Option 1 — "Cut to file" (cleanest, if available)
Some SignMaster/cutter drivers let you send the job to a **file** instead of the
port (a "Print to file" / "Spool to file" / a `FILE:` port). If we can point the
cutter output at a file, we get the exact command stream with **zero sniffing**.
Save it into `captures/` (e.g. `captures/square-from-signmaster.plt`).

### Option 2 — Serial port capture (if it's a COM port)
Install a free Windows serial-port monitor (e.g. an open-source COM port sniffer)
that logs everything sent to the COM port. Do one real cut of a **simple square**,
save the log to `captures/`.

### Option 3 — USB capture (if it's a USB device, not a COM port)
Use a free Windows USB capture tool (USBPcap + Wireshark) to record the USB
traffic during one simple cut. Save the capture to `captures/`.

**Recommended first job to capture: a 40 mm × 40 mm square.** Simple, known size —
perfect for decoding coordinates and checking scale later.

## What I (Claude) do with the capture

- Decode it into a readable command map (what each command means).
- Confirm the language (HPGL vs GPGL vs …) and the coordinate scale/units.
- Build the Mac-side sender + the design→commands converter from that ground truth.

## Net effect on the plan

- Phase 1 now includes "read the SignMaster cutter profile" — may instantly reveal
  the machine + language.
- Phase 2 "make it move" can reuse SignMaster's own captured bytes as the first
  test send — near-guaranteed to work since it's literally what already works.
