# 06 — Build & deploy (Kerf)

Three editions, **one `app/` codebase**. The app auto-detects which one it's in
(`app/lib/transport.js`) and shows the right send option.

| Edition | Where | Send to machine? | Build/host |
|---|---|---|---|
| Hosted web | `kerf.sankhacooray.com` | ❌ (export / USB stick only) | Cloudflare Worker (`web/`) |
| Node bridge | `localhost` (dev) | ✅ LAN | `node server.mjs` |
| Kerf desktop | downloaded app | ✅ LAN + tray | Tauri (`desktop/`) |

---

## A. Hosted web — Cloudflare Worker (`web/`)

Serves `../app` as static assets. Already validated with `--dry-run`.

```bash
cd web
npm install                     # done (wrangler installed locally)
npx wrangler login              # one-time: opens browser to authorize your Cloudflare account
#   (or set CLOUDFLARE_API_TOKEN in the environment instead of login)
npx wrangler deploy             # → https://kerf.<your-subdomain>.workers.dev
```

### Custom domain `kerf.sankhacooray.com`
Requires the **sankhacooray.com zone to be on Cloudflare**.
- If yes: uncomment the `routes` block in `web/wrangler.jsonc`, then `npx wrangler deploy`.
- If the zone is elsewhere (your other subdomains use GitHub Pages via CNAME):
  either move the zone to Cloudflare, or keep the `*.workers.dev` URL, or add a
  CNAME `kerf → …workers.dev` at your DNS host (works for a Worker only if the zone
  is on Cloudflare — otherwise use Cloudflare for DNS on this subdomain).

**Blocking item:** your Cloudflare login + confirming where the DNS zone lives.

---

## B. Kerf desktop — Tauri (`desktop/`)

### One-time toolchain
```bash
# Rust (required by Tauri):
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# macOS also needs Xcode command line tools:
xcode-select --install
```

### Icons (once)
Tauri needs icon files. Convert the logo and generate them:
```bash
cd desktop
# turn assets/logo.svg into a 1024px PNG (any tool); e.g. with rsvg/Chrome/Figma, then:
npm install
npm run icon        # tauri icon assets/logo.png → fills src-tauri/icons/
```

### Run / build locally (macOS)
```bash
cd desktop
npm install
npm run dev         # live dev window
npm run build       # → src-tauri/target/release/bundle/… (.app + .dmg)
```

### Mac + Windows installers via CI (recommended)
Cross-compiling Windows from a Mac is painful; use the bundled workflow:
```bash
git tag v0.1.0 && git push origin v0.1.0
```
`.github/workflows/release.yml` builds macOS (arm64 + x64) and Windows and creates a
**draft GitHub Release** with the installers attached. Publish it, then link the
assets from the hosted site's Download section.

**Blocking items:** Rust install, icon generation, and (for no-warning installs)
code-signing — macOS needs an Apple Developer cert, Windows a code-signing cert.
Unsigned is fine for testing: macOS "right-click → Open", Windows "More info → Run anyway".

---

## Notes
- The desktop app talks to the cutter via Rust (`ping_machine`, `send_plt` in
  `desktop/src-tauri/src/main.rs`) — no Node needed in the shipped app.
- The user still sets a static IP once to reach the machine on a direct cable
  (see README). A future tray menu item can automate this.
