# 01 — Machine profile (fill this in)

This is the single most valuable doc. The more of it we fill, the faster the rest
goes. No technical skill needed — most of it is *reading labels* and *taking
photos*. Leave blanks where unknown; blanks are fine.

## A. Physical inspection (just look at the machine)

- [ ] **Any text anywhere on the machine?** Front, back, underside. Even a model
      number or a sticker with tiny text helps. → photograph it.
- [ ] **The rating/serial label** (usually a silver sticker on the back/bottom).
      → photograph it. Note anything like `Model:`, `S/N:`, `FCC ID:`.
      - An **FCC ID** is gold: it lets us look up the real manufacturer.
- [ ] **The ports, close up.** Photograph the USB "host" port and the LAN port.
      - Is the direct-connect USB port a **square-ish** connector (USB-B, like a
        printer cable) or a normal flat rectangle (USB-A)? → note which.
- [ ] **Any screen/menu on the machine itself?** If it has buttons/display, note
      what settings it shows (speed, force/pressure, etc.).

## A2. SignMaster settings (Windows) — HIGH VALUE, see docs/02

The machine is driven by SignMaster Pro. Its cutter profile likely names the exact
machine + language. From SignMaster's Cutter/Plotter setup, note:

- [ ] **Exact cutter make + model selected:** _____  ← most important single fact
- [ ] **Connection type:** COM port / USB / Network(IP+port): _____
- [ ] If serial: **baud / parity / flow control:** _____
- [ ] **Units / step size / scale** in the profile: _____

## B. What came with it

- [ ] **A CD, USB stick, or download link** with software? → note the name of the
      software and where to get it.
- [ ] **The software's name / any brand on its window or installer.** This often
      reveals the real machine family even when the hardware is "unbranded".
- [ ] **A cable** — what type? (USB-B-to-A printer cable? Ethernet? Serial?)
- [ ] **A manual / quick-start sheet** → photograph any page mentioning
      "connect to computer", "driver", "baud", "COM", "IP address", "HPGL",
      "GPGL", or a file format.

## C. The current working flow (the USB-A "load a file" port)

- [ ] What file do you put on the stick today to cut something? **What's the file
      extension?** (`.plt`? `.hpgl`? `.dxf`? `.svg`? something else?)
      → **This is a huge clue about the language.** `.plt`/`.hpgl` ≈ HPGL.
- [ ] Where does that file come from — what program exports it?
- [ ] Can you share one such working file? → drop it in `captures/`.

## D. Findings from the Mac (CONFIRMED 2026-09-11)

- **Chip:** FTDI **FT232R USB UART** — a USB-to-serial chip.
- **VID:PID:** `0x0403:0x6001` (1027:24577).
- **Serial device:** `/dev/cu.usbserial-B003M4ST` (name may vary per cable).
- **Driver:** macOS **built-in** (Apple's FTDI driver) — no install needed. On
  first connect macOS shows "Allow accessory to connect?" → click **Allow**.
- **Port opens** fine; default line settings `9600 8N1` (`cs8 -parenb`), no flow
  control shown. Baud the machine actually expects is still TBD (test below).
- **Machine port used:** square USB-B ("connect to computer"). Correct port.
- LAN: not tested — USB-serial enumerates fine, so LAN wasn't needed.

### Serial direct-send: DEAD END (concluded 2026-09-11)

The FT232R enumerates and the port opens/sends fine, but the machine **never
responds and never moves** to anything we send. Exhaustively tried, all silent:

- Baud: 4800, 9600, 19200, 38400, 57600, 115200
- Framing: 8N1, 7E1, 7O1, 8E1, 8O1, 8N2
- Flow control: none and hardware (RTS/CTS)
- DTR/RTS asserted (Web Serial `setSignals`)
- HPGL "output" queries (`OI;OH;OA;OF;`, ESC.@) → zero bytes back at every baud
- Pen-up-only job with `PG;` terminator → no movement

Consistent with the fact that this port **never worked with SignMaster either**.
Conclusion: this unbranded machine's USB-B port is not a usable plot-data path via
software alone. Any further attempt would need vendor docs or opening the machine
to inspect the board (uncertain payoff). **We are not pursuing serial further.**
The proven interface is the **USB flash drive** (Type-A port). Delivery plan
pivots to making that path one-click (File System Access API).

## E. Summary (fill after A–D)

- Best guess at machine family: _____
- Likely transport (USB-serial / USB-printer / LAN): _____
- Likely language (HPGL / GPGL / proprietary / unknown): _____
- Do we think we'll need a Windows box to sniff vendor software? (Y/N): _____
