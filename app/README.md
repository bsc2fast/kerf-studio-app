# Cutter Studio (web app)

Converts vector artwork (SVG) into a `.plt` (HPGL) cut file for the flatbed
cutter — replacing SignMaster's export step. Runs entirely in the browser.

## Run it

```bash
bash ../scripts/serve.sh        # serves on http://localhost:8080
```

Then open <http://localhost:8080/> in **Chrome or Edge**. (Use the server — not a
`file://` path — because ES modules and Web Serial both require it.)

## Use it

1. **Load** a **PDF** (or SVG) — drag-drop, "Choose file", or "Load sample".
   - For PDFs, only the lines drawn in the **`Cut` spot colour** are extracted
     (exactly what SignMaster cuts). CMYK artwork is ignored.
2. **Pick contours** — each cut shape appears as a checkbox with its size. A PDF
   template can hold several outlines; tick the ones you want to cut.
3. Check the **Preview** — each contour is drawn on the bed in its own colour.
   Rotation defaults to **Auto** (0°/90° to fit the bed, like SignMaster).
4. **Save to USB stick** (one click, Chrome/Edge) — writes the `.plt` straight onto
   the flash drive; you pick the stick once and it's remembered. Then eject and cut
   on the machine. (Or **Export .plt** to save to Downloads and copy it yourself.)

## Direct send over LAN — WORKS ✅

The machine's **network port** accepts the plot stream over TCP. Setup:

1. Connect the machine's LAN port to the Mac (USB-C hub Ethernet). On the machine's
   **Network** screen note its IP (e.g. `192.168.1.20`) and Save.
2. Put the Mac on the same subnet (once, admin):
   `sudo ifconfig <iface> inet 192.168.1.10 netmask 255.255.255.0`
   (find `<iface>` — the USB Ethernet, e.g. `en12` — via `networksetup -listallhardwareports`).
3. Run the bridge: `bash scripts/serve.sh` (this is `node server.mjs` — needed
   because browsers can't open raw TCP; the bridge forwards the `.plt`).
4. In the app's **3 · Send to machine** panel: set IP/port (default `192.168.1.20:5000`),
   **Test connection**, then **Send cut to machine**.

**The machine must be on its main/ready screen** — the plot port (5000) only opens
there; inside menus it's closed.

Serial (USB-B / FTDI FT232R) is a dead end — 256 setting combos, zero response;
see docs/01 §D. Use LAN (above) or the flash drive.

## The one thing that needs calibrating

Two scale numbers must match your machine. They're set from a **known-good `.plt`**:

- **SVG units per mm** — depends on how your artwork is authored (Illustrator px,
  pt, or real mm). Default `3.7795` assumes CSS px at 96 dpi.
- **Plotter units per mm** — the machine's HPGL scale. Default `40` (= 1/40 mm) is
  the classic HPGL value; we confirm it from your `.plt`.

Drop a working `.plt` in `../captures/` and these get pinned so exported files cut
at the exact right size.

## PDF extraction — how it works

`lib/pdf-cut.js` reads the PDF directly in the browser: it finds the colour space
named `Cut`, walks the page + its Form XObjects, and keeps only the paths
stroked/filled with `Cut`, flattening curves to points. Verified to reproduce the
captured `.plt` files coordinate-for-coordinate.

Scope: handles Illustrator "Save as PDF" (classic xref, FlateDecode, forms). PDFs
using object streams, or cut art nested in unusual ways, may extract nothing — the
app then tells you to export the `Cut` layer as SVG instead.

## Known limitations

- Curves are flattened by sampling; fine for cutting.
- No blade-offset / overcut / start-position options yet — added once we confirm
  what the machine honours (nothing in the captured `.plt` used them).

## Files

- `index.html`, `styles.css`, `main.js` — UI + wiring
- `lib/svg-parse.js` — SVG → polylines (mm)
- `lib/hpgl.js` — polylines → HPGL `.plt`
- `lib/serial.js` — Web Serial direct send (experimental, Phase B)
- `samples/test-square.svg` — calibration test artwork
