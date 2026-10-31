# 07 — TODO / next session

Snapshot of open work as of 2026-09-27. Everything below is "later" — the app is
fully working today (design → cut over LAN via the local server).

## 1. Speed / Force / Graver over the network (main open item)

Goal: set **Speed**, **Force**, and **Graver (Left/Right)** programmatically and
**prepend them to the cut job**, so operators never touch the machine's panel.

What we know from the panel (V/F screen): Speed (e.g. 50), Force (e.g. 550),
Graver = *Left Graver* / *Right Graver* (the tool — almost certainly the `.plt`
`CT` command: `CT1`=Left, `CT2`=Right). Settings password on the machine: **16**.

First probe result (this session): sending standalone `VS44;SS45;FS522;FO533;CT2;`
over TCP left the panel **unchanged**. Likely because commands outside a `TB` job
are ignored and/or cutter settings apply per-job without updating the panel display.
→ **Panel observation is not a reliable way to verify.**

**Chosen method — SignMaster diff (definitive, do this first):** export 4 `.plt`
of the *same* simple shape, changing only one setting each, into `captures/`:

| file | Speed | Force | Graver |
|---|---|---|---|
| `base.plt`  | 50  | 550 | Left  |
| `spd.plt`   | 100 | 550 | Left  |
| `frc.plt`   | 50  | 300 | Left  |
| `right.plt` | 50  | 550 | Right |

Then diff them to extract the exact command encoding, and add **Speed / Force /
Graver** controls to the Machine page (`app/index.html` `#view-config`,
`app/main.js`, `app/lib/settings.js`) that prepend to every job built in
`app/lib/hpgl.js`.

Fallback if SignMaster is unavailable: probe-by-cutting (embed candidates in a real
job, judge by cut result). Untried mnemonics: `F`, `BF`, `PF`, `PR`, `SO`, `!VS`,
and `VS`/`FS` placed *inside* a `TB` job.

## 2. Optional polish

- ~~Rename repo/folder~~ — done 2026-10-23: `flatbed-cutter-control` → `kerf-studio-app`.

## Not doing (settled)

- **Head jog / home / move-to-XY over the network** — not possible on this camera
  print-and-cut machine (every network job triggers the uncancellable camera scan;
  `TB` is required to move and is what scans; only TCP 5000, ready-screen only).
  Jogging is panel-only. See `docs/01-machine-profile.md` §D and the project memory.


## Dropped (2026-10-31)

The Tauri desktop app, its DMG, the release CI and the hosted Studio at
kerf.sankhacooray.com/studio/ were removed. Kerf Studio runs only locally
(`node server.mjs`), like Helix Studio; the site just explains how to set it up.
