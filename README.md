# Kerf Studio

**[kerf.sankhacooray.com](https://kerf.sankhacooray.com)**

Turn **artwork into cut files** for a camera print-and-cut flatbed cutter and
send them over the network — no SignMaster, no Windows PC.

It runs as a small local web app: you start a Node server on your own machine,
open `http://localhost:8080` in Chrome or Edge, drop in a PDF, SVG or `.plt`,
pick the contours, check them on a true-scale picture of the bed, and hit
**Cut**. The cutter scans the four printed corner marks, then cuts.

```text
   PDF / SVG / PLT  ──▶  pick contours  ──▶  .plt (HPGL)  ──▶  Cut (LAN) or USB stick
```

* Works on macOS, Windows and Linux. The only interface is your browser.
* Nothing leaves your machine. The server only talks to the cutter on your own
  network.
* No dependencies: plain Node, no `npm install`, no build step.

---

## ⚠️ Before anything else

* Kerf was decoded against **one unbranded camera print-and-cut flatbed** that
  takes HPGL `.plt` over **TCP port 5000** (see [docs/04](docs/04-plt-format-decoded.md)).
  Other cutters may speak a different dialect or port. **Test on scrap first.**
* The bed size and origin in **Machine settings** are the calibration of *one
  specific machine*. Check them against yours before the first cut.
* This software is provided as-is, with no warranty (see [LICENSE](LICENSE)).
  You are responsible for what your cutter does.

---

## Requirements

| What | Why | Notes |
| --- | --- | --- |
| **Node.js 18+** | runs the local server | `node --version` |
| **Chrome or Edge** | the Studio, and one-click Save to USB | Safari/Firefox work, minus USB save |
| **The cutter on your network** | receives the job on TCP 5000 | you need its IP address |

---

## Install and run

```sh
git clone https://github.com/bsc2fast/kerf-studio-app.git
cd kerf-studio-app
node server.mjs            # or: bash scripts/serve.sh
```

Open **<http://localhost:8080>**. Another port: `node server.mjs 8090`.

### Point it at your cutter

1. On the cutter, open its **Network** screen and note the IP (factory default
   `192.168.1.20`).
2. In the Studio, open **⚙ Machine settings**, enter that IP (port `5000`) and
   press **Test**. The chip in the app bar turns green when the cutter answers.
3. The cutter only listens on its **main/ready screen**. In any menu, port 5000
   is closed and the chip shows *offline*.

**Cutter on a router** (recommended): set its IP to a free address in your
router's range (e.g. `192.168.8.20`) so your computer reaches it with no extra
setup.

**Cutter cabled straight to your computer** (no router): give your Ethernet
adapter a fixed address on the cutter's subnet, once per boot:

```sh
sudo ifconfig en12 inet 192.168.1.10 netmask 255.255.255.0                          # macOS (find the adapter with: ifconfig)
netsh interface ip set address "Ethernet" static 192.168.1.10 255.255.255.0         # Windows (admin)
```

---

## Use it

1. **Load** a file: drag it anywhere onto the window.
   * **PDF**: only paths in the spot colour named **`Cut`** are extracted; the
     printed artwork is ignored.
   * **SVG**: every path, curves sampled at 0.3 mm.
   * **PLT**: previewed, then sent **byte-for-byte as it is**.
2. **Pick contours**: tick the ones to cut; hover one to find it on the bed.
3. **Layout**: rotation (Auto fits the bed), centre or origin, Flip Y.
4. **Cut** sends it over the network. Or **USB** writes the `.plt` straight to a
   flash drive (pick the stick once; shift-click to change it), or **.plt**
   downloads it.

Print your sheet with the four corner registration marks; the cutter's camera
scans them before every cut.

---

## Layout

* `server.mjs` — the local server: serves `app/` and forwards `.plt` to the
  cutter over TCP (browsers can't open raw sockets)
* `app/` — the Studio (plain HTML/JS modules)
* `docs/` — how the machine and its `.plt` format were figured out
* `captures/` — sample PDF+PLT pairs (git-ignored)

The marketing site lives in a separate repo, `kerf-sankhacooray-com`.
