# downloads/

Installer binaries served by the hosted site (the Worker uploads whatever is in
`app/` at deploy time). These files are **git-ignored** — they live here only on
the build machine and get pushed to Cloudflare on `wrangler deploy`.

Stable download URLs (referenced by `app/index.html`):

- `Kerf-macOS-AppleSilicon.dmg` → https://kerf.sankhacooray.com/downloads/Kerf-macOS-AppleSilicon.dmg
- `Kerf-macOS-Intel.dmg` (when built)
- `Kerf-Windows-Setup.exe` (when built via CI)

## Refresh after a new build

```bash
cp desktop/src-tauri/target/release/bundle/dmg/Kerf_*_aarch64.dmg \
   app/downloads/Kerf-macOS-AppleSilicon.dmg
cd web && npx wrangler deploy
```

For Intel Mac + Windows, build via CI (`git tag vX.Y.Z && git push --tags`), then
download the release artifacts into this folder and redeploy — or later move
distribution to a public GitHub Release / Cloudflare R2 bucket.
