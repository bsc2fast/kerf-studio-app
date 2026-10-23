# 07 — TODO / next session

Snapshot of open work as of 2026-09-27. Everything below is "later" — the app is
fully working today (design → cut over LAN, plus hosted web + downloadable app).

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

## 2. Refresh the downloadable app

The hosted `.dmg` is the **old single-page build** (pre multi-page / Machine page).
Rebuild and refresh:

```bash
cd desktop && PATH=$HOME/.cargo/bin:$PATH npm run build
cp src-tauri/target/release/bundle/dmg/Kerf_*_aarch64.dmg app/downloads/Kerf-macOS-AppleSilicon.dmg
cd ../web && npx wrangler deploy
```

## 3. Intel-Mac + Windows builds (CI)

```bash
git tag v0.1.0 && git push origin v0.1.0   # → .github/workflows/release.yml (draft release)
```
Then drop the artifacts into `app/downloads/` and redeploy, or link them on the
Get-app page.

## 4. Optional polish

- ~~Rename repo/folder~~ — done 2026-10-23: `flatbed-cutter-control` → `kerf-studio-app`.
- Code-signing (Apple Developer + Windows certs) to remove first-run warnings.

## Not doing (settled)

- **Head jog / home / move-to-XY over the network** — not possible on this camera
  print-and-cut machine (every network job triggers the uncancellable camera scan;
  `TB` is required to move and is what scans; only TCP 5000, ready-screen only).
  Jogging is panel-only. See `docs/01-machine-profile.md` §D and the project memory.
