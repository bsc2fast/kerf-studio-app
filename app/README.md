# Kerf Studio — app/

The Studio UI: plain HTML and ES modules, served by `../server.mjs`. See the
[top-level README](../README.md) to run it.

- `index.html`, `styles.css`, `main.js` — UI and wiring
- `lib/pdf-cut.js` — PDF → polylines, only the `Cut` spot colour
- `lib/svg-parse.js` — SVG → polylines (mm)
- `lib/plt-parse.js` — `.plt` → polylines, for preview only (the file is sent as-is)
- `lib/hpgl.js` — polylines → HPGL `.plt`
- `lib/transport.js` — ping / send through the local server
- `lib/settings.js` — machine settings (IP, bed, origin), kept in the browser
- `samples/test-square.svg` — calibration artwork
