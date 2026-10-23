# kerf-studio-app

Drive an unbranded flatbed blade-cutting machine from a Mac — turn artwork into a
cut file and send it to the machine, with **no vendor software and no Windows PC**.

## What it does

- **Cutter Studio** ([app/](app/)) — a browser app: drop a **PDF** (or SVG), it
  extracts only the `Cut` spot-colour contours, lets you pick which to cut, previews
  them on the bed, and produces a **byte-faithful `.plt`** (HPGL) for this machine.
- **Two ways to deliver the cut:**
  1. **LAN (direct) ✅** — send straight to the machine over the network, one click.
  2. **USB flash drive** — one-click "Save to USB stick", then open on the machine.

This replaces the old workflow (SignMaster on Windows → export `.plt` → flash drive).

## Quick start

```bash
bash scripts/serve.sh          # runs the Node bridge on http://localhost:8080
```

Open <http://localhost:8080/> in **Chrome/Edge**. Drop a PDF → pick contours →
**Save to USB stick** or **Send cut to machine** (LAN).

### LAN setup (one-time)

- Machine LAN → Mac (USB-C hub Ethernet). Note the machine's IP on its **Network**
  screen (default `192.168.1.20`).
- Put the Mac on the same subnet (admin, temporary until reboot):
  `sudo ifconfig en12 inet 192.168.1.10 netmask 255.255.255.0`
- The machine must be on its **main/ready screen** to receive (TCP port 5000 only
  opens there).

## How it was figured out (docs)

- [docs/00-feasibility.md](docs/00-feasibility.md) — feasibility
- [docs/04-plt-format-decoded.md](docs/04-plt-format-decoded.md) — the machine's
  `.plt`/HPGL format, reverse-engineered from working captures
- [docs/01-machine-profile.md](docs/01-machine-profile.md) — connection facts
  (LAN works on TCP 5000; USB-B serial is a confirmed dead end)
- [PLAN.md](PLAN.md) — the full journey and outcome

## Layout

- `app/`      — Cutter Studio web app (PDF/SVG/PLT→`.plt`, preview, save/send).
  Also hosted at <https://kerf.sankhacooray.com/studio/>, deployed from the
  sibling repo `kerf-sankhacooray-com` (it copies this folder at deploy time).
- `server.mjs`— local Node bridge (serves the app + forwards `.plt` to the machine
  over TCP, since browsers can't open raw sockets)
- `scripts/`  — `serve.sh` (run the bridge), `detect.sh` (USB detection)
- `docs/`     — findings and format notes
- `captures/` — sample PDF+PLT pairs (git-ignored; big)
