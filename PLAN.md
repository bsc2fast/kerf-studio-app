# Execution plan

Direction is now clear (see [docs/03-target-format-and-strategy.md](docs/03-target-format-and-strategy.md)):
we already know the machine eats a **`.plt` file (HPGL)**. So we're not
reverse-engineering — we're **rebuilding SignMaster's two jobs** (make the `.plt`,
deliver the `.plt`) as our own Mac/web app, then cutting the flash drive out.

Phased so Phase A ships a real win even if the direct connection never works.

---

## Phase 0 — Setup ✅ (done)

Project folder created, added to the sclab workspace, plan + strategy docs written.

---

## Phase 1 — Ground truth: get a working `.plt` (cheap, do first)

**Goal:** confirm the exact format the machine expects, from a file we KNOW works.

- **You:** drop 1–3 working `.plt` files into `captures/` — ones you've actually
  cut successfully. If possible, include the **source artwork** each came from.
- **You (nice to have):** in SignMaster, note the selected **cutter model** and its
  units/scale (docs/01 section A2) — helps me match coordinates.
- **Me:** read the `.plt`, confirm it's HPGL, and document the dialect, units,
  coordinate scale, and how a shape maps to commands.

**Go/no-go:** I can explain the file's commands + scale → we can generate our own.

---

## Phase 2 — The converter (the core; this is Phase A of the strategy)

**Goal:** turn your artwork into a `.plt` that matches the known-good files.

> STATUS: **converter built + calibrated from real captures** (see
> [docs/04-plt-format-decoded.md](docs/04-plt-format-decoded.md)). "Cutter Studio"
> in [../app](../app) now emits **byte-faithful** `.plt` (verified against TP-L2-M:
> exact header/footer, eyelet at 5540,3860, correct extents). Scale confirmed:
> 40 units/mm, bed 11080×7600, design centred, 90° rotate reproduces SignMaster.
> Run: `bash scripts/serve.sh` → <http://localhost:8080/> in Chrome.
>
> **PDF import DONE (route B chosen).** `app/lib/pdf-cut.js` extracts only the
> `Cut` spot-colour paths from the PDF in-browser (handles Form XObjects, Flate
> streams). Drop a PDF → tick which contours to cut → export. Verified to
> reproduce all three captured `.plt` files coordinate-for-coordinate when the
> matching contours are selected. Note: the sample PDFs are shared master
> templates holding all four contours, so contour **selection** is part of the UI.
> Fallback message points to SVG export if a PDF can't be parsed.

- **You:** tell me what artwork you start from — **vector (SVG/PDF/AI) or raster
  (PNG/JPG) or both** — and share a representative sample. (Decides how much
  image-tracing we build; see docs/03.)
- **Me:** build the converter — artwork → cut paths → HPGL `.plt`, with the exact
  scale/units from Phase 1. Vector first (straightforward); add raster tracing +
  contour-offset only if you need "print & cut".
- **Me:** wrap it in a simple web UI: load artwork → **preview the cut lines** →
  export `.plt`.

**Milestone:** you export a `.plt` from our app, copy to the flash drive, and the
machine cuts it correctly. **At this point SignMaster + Windows are gone.**

**Go/no-go:** a known shape (e.g. 40 mm square) cuts at the correct size → continue.

---

## ✅ SOLVED — direct control over LAN

The machine has a touchscreen **Network** screen (IP `192.168.1.20`). It accepts the
plot stream over **TCP port 5000**. Working setup:
- Machine LAN → Mac USB-C hub Ethernet (adapter = ASIX AX88179A, iface `en12`).
- Mac static IP: `sudo ifconfig en12 inet 192.168.1.10 netmask 255.255.255.0`.
- Node bridge `server.mjs` (browsers can't do raw TCP) serves the app + forwards
  `.plt` to `192.168.1.20:5000`. Run via `bash scripts/serve.sh`.
- App "3 · Send to machine" → Test connection → Send cut. **Verified: head moves.**
- NOTE: port 5000 is only open on the machine's **main/ready screen** (closed in menus).

Result: full **computer → cut**, no SignMaster / Windows / flash drive.
(Flash-drive "Save to USB stick" remains as a backup path.)

---

## (archived) Phases 3–4 — direct SERIAL is a dead end

Tested exhaustively (docs/01 section D): the USB-B port (FTDI FT232R) enumerates
and opens, but the machine never replies or moves on ANY of 256 setting combos
(all bauds × framings × flow × DTR/RTS). Never worked with SignMaster either.
**Decision: stop pursuing serial.** Delivery stays on the proven **USB flash
drive**, now made one-click in the app via the File System Access API
("Save to USB stick" → pick the stick once → writes the `.plt` onto it).

Net result: the original goal is met — **no SignMaster, no Windows.** Flow is:
drop PDF → pick contours → Save to USB stick → cut on the machine.

---

## (archived) Phase 3 — Test the direct connection (start of Phase B)

**Goal:** find out if we can talk to the machine without the flash drive.

- **You:** plug the machine into the Mac's direct USB port, power on, run
  `bash scripts/detect.sh`, paste output into docs/01 section D.
- **Me:** from what appears, decide the route:
  - shows up as `/dev/cu.usbserial-*` → **Web Serial** works → browser app can send.
  - needs a driver → I tell you exactly which one to install, then re-test.
  - USB printer-class / nothing → plan for a desktop shell.
  - want wired network → LAN branch (Phase 5).

**Go/no-go:** a serial port appears → Phase 4 (Web Serial). Otherwise → desktop/LAN.

---

## Phase 4 — Direct send via Web Serial

**Goal:** send the `.plt` straight to the machine from the app — no flash drive.

- **Me:** add Web Serial to the app: pick port, set baud/flow control (matched to
  the machine), stream the `.plt` bytes. First test: send a **known-good captured
  `.plt`** (near-guaranteed, since it already works) with the blade up / no material.
- **Together:** confirm it moves correctly, then wire "Cut" to send our generated
  `.plt` directly.

**Milestone:** artwork → app → machine cuts, with no SignMaster, no Windows, no
flash drive.

---

## Phase 5 — LAN path (optional / fallback)

Only if USB stays painful, or you prefer wired network.

- **You:** USB-C→Ethernet adapter; Mac + machine on the same network (or direct cable).
- **Me:** find the machine's IP + port (often TCP 9100 raw). Because browsers can't
  open raw sockets, this needs a thin desktop app or local helper; the converter
  and UI are reused unchanged.

---

## What I need from you to move now

1. **A working `.plt` file** in `captures/` (highest value) — ideally with its
   source artwork.
2. **What artwork you start from:** vector, raster, or both.
3. (When convenient) the SignMaster cutter model, and later the `detect.sh` output.
