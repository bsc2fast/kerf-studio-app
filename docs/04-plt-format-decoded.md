# 04 — The machine's .plt format (decoded from captures)

Reverse-engineered from the working files in `../captures/` (BP-L1-M, TP-L2-M,
TP-L3-M) — each a matched PDF + PLT pair, cut successfully on the machine.

## Verdict: it's HPGL with a small wrapper

The body is plain **HPGL** (`PU`/`PD`), wrapped by a few machine commands. We can
generate byte-faithful files (verified: our converter reproduces the captured
coordinates exactly). No further reverse-engineering needed.

## Exact layout

```
TB25,11080,7600;CT1;<1025 spaces>IN;   <- header
PU<x>,<y>;                              <- move to start of a contour (pen up)
PD<x>,<y>;PD<x>,<y>; ... ;              <- one PD per point = the cut
PU<x>,<y>; ...                          <- next contour
PU11280,200;PG;                         <- park + page-eject (end)
```

- The whole file is **one continuous line** (no newlines).
- **`TB25,11080,7600`** — bed/work setup. `11080 × 7600` plotter units.
- **`CT1`** — select cut tool 1. (No HPGL `SP` pen-select is used.)
- **1025 spaces** of padding between `CT1;` and `IN;` (kept verbatim; likely a
  buffer/flush the firmware expects).
- **`IN;`** — initialise.
- **`PU x,y`** pen up (travel), **`PD x,y`** pen down (cut). One point per command.
- **`PU11280,200;`** park just past the right edge (`bedW + 200`, `y = 200`).
- **`PG;`** page / advance — ends the job.

## Coordinate system (all confirmed)

- **Units:** 40 plotter units per mm (1/40 mm). Confirmed: the BP-L1 outline spans
  10000 × 7040 units and measures 250 × 176 mm.
- **Bed:** 11080 × 7600 units = **277 × 190 mm**.
- **Origin:** bottom-left, **Y increases upward** (so Y is flipped vs SVG).
- **Placement:** the design is **centred on the bed**. In every file the eyelet
  circle sits at the exact bed centre `(5540, 3800)`.
- **Rotation:** SignMaster **rotated the portrait A4 artwork 90°** onto the
  landscape bed. (Our converter has a rotate option to reproduce this.)
- **Curves:** circles/arcs are flattened into many short `PD` segments. Our
  sampler does the same; segment count differs slightly (cosmetic only).

## How cut lines are chosen (the important input rule)

The source PDFs are Adobe Illustrator, A4, full CMYK artwork **plus a spot-colour
separation named exactly `Cut`**. SignMaster cuts **only the `Cut` separation**;
all the CMYK graphics are ignored. (Confirmed via Ghostscript `tiffsep`, which
emitted a `(Cut)` plate alongside Cyan/Magenta/Yellow/Black.)

So our converter's input must likewise be **only the cut contours**. Two ways to
supply them — see PLAN Phase 2 decision:
- **A:** in Illustrator, export just the `Cut` objects/layer as SVG.
- **B:** we parse the PDF and extract only the `Cut` spot-colour paths (bigger build).

## What each captured file cuts

- **BP-L1-M:** eyelet (Ø3 mm) + a 250 × 176 mm rounded-rectangle outline.
- **TP-L2-M:** eyelet + a Ø165 mm circle.
- **TP-L3-M:** eyelet + a Ø135 mm circle.
