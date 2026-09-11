# 03 — What we're really building (confirmed strategy)

## Confirmed current workflow

The direct connection was **never** set up. The real, working flow is:

1. In **SignMaster** (Windows): import artwork → **auto-detect cut contours** →
   assign tool → **export a `.plt` file**.
2. Copy the `.plt` onto a **USB flash drive**.
3. Plug the drive into the machine's **USB-A port** and open/run the file there.

Goal: remove **SignMaster** and the **Windows PC**, and eventually the **flash
drive** too — replacing all of it with our own Mac / web / desktop app.

## The most important consequence

**We already know the machine's input format: a `.plt` file** (almost certainly
**HPGL** — a documented plotter language). We do **not** need to reverse-engineer
anything: a working `.plt` you already use is ground truth. From one sample I can
confirm the exact dialect, units, and coordinate scale the machine expects.

> ACTION: drop one or more working `.plt` files into `captures/`, ideally with the
> source artwork they were made from. This is the single highest-value input now.

## SignMaster does two separable jobs — we replace them independently

| Job | What it does | Our replacement |
|---|---|---|
| **1. Generate** | artwork → contours → tool → `.plt` (HPGL) | a converter we build (the core) |
| **2. Deliver** | (you do this) copy to flash drive, open on machine | keep for now → later, direct send |

This split lets Phase A ship value **without** the direct connection working.

## Two-phase strategy

### Phase A — remove SignMaster + Windows (keep flash drive)
Build the converter + a simple UI: import artwork → preview cut lines → export
`.plt` to the flash drive. You keep opening it on the machine as you do today.
Low-risk: it rides the delivery path already proven to work.

### Phase B — remove the flash drive (direct communication)
Send the `.plt` straight to the machine. Options, best-first for us:

- **Web Serial (Chrome/Edge on Mac):** a pure web app talks to a USB-serial port,
  no install. Works **if** the direct USB port enumerates as a serial device on
  macOS. Cleanest outcome.
- **Desktop app (Electron/Tauri) or tiny local helper:** needed if the port is a
  USB *printer-class* device, or for the **LAN** route (browsers can't open raw
  TCP sockets, and many plotters accept raw HPGL on TCP port 9100).

We decide Phase B's shape only after testing the port (detect.sh + a live send).
Phase A does not depend on it.

## The converter — what "auto-detect contour" means, and what we need to know

SignMaster's "auto-detect contour" depends on the artwork type:

- **Vector artwork** (SVG / PDF / AI / EPS): the shapes are already outlines →
  converting to HPGL paths is straightforward. **Easy.**
- **Raster artwork** (PNG / JPG): there is no outline yet; a contour must be
  *traced* from the image (like image-to-vector), possibly offset around a printed
  graphic ("print & cut"). Needs a tracing step. **More involved.**

> DECIDED (2026-09-11): source artwork is **vector** (SVG/PDF/AI/EPS). So we take
> the **easy path** — outlines straight to HPGL, no image tracing. SVG is the
> primary input format. (Raster tracing is out of scope unless this changes.)

## Suggested tech (matches the sclab workspace style)

- A **web app** (HTML/JS) for the converter + preview, since Web Serial lives in
  the browser and the workspace is full of html5 apps. If we later need USB-printer
  or LAN, wrap the same app in a thin desktop shell — the converter code is reused.
