# 05 — Web deployment plan (hosted app + downloadable bridge)

Goal: serve Cutter Studio from a `sankhacooray.com` subdomain, with a simple
one-word brand name, and let users download a small **self-running bridge**
(Mac/Windows) for the direct-to-machine sending.

## The one thing that shapes everything

The Studio app splits cleanly into two kinds of work:

| Capability | Needs | Works from a hosted web page? |
|---|---|---|
| PDF → `.plt`, preview, **Export .plt** | browser only | ✅ yes |
| **Save to USB stick** | File System Access API | ✅ yes (Chrome/Edge) |
| **Send to machine over LAN** | raw TCP socket | ❌ no — browsers can't open TCP |

So a hosted page can do *everything except the LAN send*. The LAN send needs the
local **bridge** (our `server.mjs`). And a hosted **https** page can't even call a
local `http://localhost` bridge — browsers block that (mixed content + private
network access). Therefore:

> **The bridge must serve its own copy of the app at `http://localhost`.** That's
> the only place the LAN send can run. The hosted subdomain is for everything else.

## Proposed architecture (one codebase, two "editions")

Same `app/` code; it **feature-detects** whether a bridge is present (does
`/api/ping` exist?) and shows/hides the LAN panel accordingly.

1. **Hosted edition — `NAME.sankhacooray.com`** (static, GitHub Pages)
   - Full Studio: drop PDF → pick contours → preview → **Export .plt** / **Save to
     USB stick**. Great for anyone, any machine, no install.
   - A **Download** section: get the bridge for Mac / Windows.
   - LAN panel shows: "To send directly to the machine, download the bridge."

2. **Bridge edition — downloaded self-executable** (Mac/Windows)
   - A single file the user double-clicks. It starts the local server and opens
     `http://localhost:8080/` — the *same* app, now with the **Send to machine**
     panel live (it forwards `.plt` over TCP to the cutter).
   - Works fully offline; no cloud dependency.

The hosted app and the bridge's app are built from the same source, so there's
nothing to keep in sync by hand.

## Naming + subdomain

Pick one short, memorable word (see the decision at the end). It becomes:
- the subdomain `NAME.sankhacooray.com` (new `NAME-sankhacooray-com` repo/folder +
  `CNAME` file, deployed to `gh-pages` like the other sites),
- the app title and the downloaded bridge's name,
- optionally the GitHub repo rename (`flatbed-cutter-control` → `NAME`).

## Packaging the bridge as a self-executable

Turn `server.mjs` + `app/` into one binary per OS. Options:

| Tool | Pros | Cons |
|---|---|---|
| **Bun `--compile`** (rec.) | one command → single binary per OS, cross-compiles Mac↔Win, embeds assets, tiny effort | needs Bun installed to build; verify our `node:net/http/fs` run under Bun (they do) |
| **`pkg`** (Node) | mature, cross-compiles, well-documented asset embedding | project archived (still works) |
| **Node SEA** | official Node feature | fiddly per-OS blob injection; awkward cross-compile |
| **Tauri** (v2 idea) | real app window/tray, nicest UX, auto-update | Rust toolchain, more work |

Recommendation: **Bun compile** for v1 (simplest path to Mac+Windows binaries).
Revisit **Tauri** later if we want a polished tray app with an "IP setup" button.

### Honest caveats (must be in the download page)
- **Unsigned binaries** warn on first run: macOS Gatekeeper ("right-click → Open"),
  Windows SmartScreen ("More info → Run anyway"). Proper signing needs an Apple
  Developer account ($99/yr) + a Windows cert — optional, later.
- **Static IP step still applies.** Users on a direct cable must put their computer
  on the machine's subnet once:
  - macOS: `sudo ifconfig <iface> inet 192.168.1.10 netmask 255.255.255.0`
  - Windows: `netsh interface ip set address "<adapter>" static 192.168.1.10 255.255.255.0`
  v2 idea: a "Set up network" button in the bridge that runs this with elevation.

## Deploy mechanics (matches your existing sites)

- New folder/repo `NAME-sankhacooray-com` containing the built app + `CNAME`
  (`NAME.sankhacooray.com`) + a small landing/download page.
- Deploy `dist/` to `gh-pages` (your `gh-pages-deploy-from-temp-clone` pattern).
- Add DNS `CNAME NAME → <user>.github.io` (same as your other subdomains).
- Bridge binaries hosted as **GitHub Releases** on the code repo; the download page
  links to them (keeps big binaries out of Pages).

## Phasing

- **P1 — Bridge as downloadable binary.** Bun-compile `server.mjs`+`app/` → Mac &
  Windows binaries; test the Mac one locally end-to-end; attach to a GitHub Release.
- **P2 — Feature-detect in the app.** Show the LAN panel only when a bridge is
  present; otherwise show the Download call-to-action. (Small `main.js` change.)
- **P3 — Hosted subdomain.** Create `NAME-sankhacooray-com`, landing + app +
  download links + `CNAME`, deploy to gh-pages, wire DNS.
- **P4 — Rename** repo/folder/title to `NAME`.
- **P5 (later) — polish:** code-signing, "Set up network" button, Tauri tray app,
  auto-update.

## Decisions (LOCKED 2026-09-11)

- **Name: `Kerf`** → `kerf.sankhacooray.com`; app title "Kerf"; rename repo/folder
  `flatbed-cutter-control` → `kerf` when we execute. (Done 2026-10-23 as
  `kerf-studio-app`; the site is the separate `kerf-sankhacooray-com` repo.)
- **Packaging: Tauri** tray app (chosen over Bun/pkg for a polished result). Implies:
  - A small Rust/Tauri shell with a **tray icon** and a webview that loads `app/`.
  - The TCP send + local HTTP can move into Tauri's Rust side (a Rust `TcpStream`
    replaces `server.mjs`'s socket forwarding), OR keep `server.mjs` as a bundled
    Node **sidecar** — decide at build time. Rust-native is cleaner (no Node dep).
  - Room for a **"Set up network"** menu item (runs the static-IP command with
    elevation) and **auto-update**.
  - Cost: Rust toolchain + more build setup; unsigned-app warnings still apply
    until we sign (Apple Developer / Windows cert).
- **Distribution:** bridge app via **GitHub Releases**; download links on the
  hosted subdomain.

## STATUS: P1 + web SCAFFOLDED (2026-09-11) — see docs/06

Done in code (one command from working):
- **Transport shim** `app/lib/transport.js` — same app runs as Tauri / Node bridge /
  hosted web; auto-detects and shows the right send option. Bridge adds `/api/health`.
- **Kerf desktop (Tauri)** in `desktop/` — Rust `ping_machine`/`send_plt`, tray icon,
  loads `../app`. Needs: Rust install + icon generation to build (see docs/06).
- **Cloudflare Worker** in `web/` — serves `../app`; validated with `wrangler --dry-run`.
  Needs: `wrangler login` + confirming the DNS zone for the custom domain.
- **CI** `.github/workflows/release.yml` — builds macOS + Windows installers on tag.

Remaining (needs user creds/tooling): Cloudflare login + DNS zone check; Rust
install + icons + optional code-signing. The local `node server.mjs` bridge + app
remain fully functional now.
