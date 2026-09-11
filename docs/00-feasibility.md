# 00 — Is this feasible and worth it?

Short answer: **yes, worth exploring** — but how hard it is depends almost
entirely on *what protocol the machine speaks*, which we don't know yet. This
doc explains the choices in plain language so we know what we're betting on.

## The core idea, restated simply

A flatbed cutter is basically a robot arm that holds a blade and moves it around
a flat bed. To control it, we send it a stream of instructions like:

```
lift blade → move to (x1, y1) → drop blade → move to (x2, y2) → lift blade → ...
```

Our whole project is: **produce that instruction stream from a design, and get it
into the machine.** Everything else is packaging.

## The two things we must discover

### 1. The "language" (protocol)

Most cutters speak one of a few known languages:

- **HPGL** — an old, well-documented pen-plotter language (`PU`, `PD`, `PA`...).
  If it's this, we're in great shape — it's public and simple.
- **GPGL** — Graphtec's plotter language (Silhouette/Graphtec-style machines use
  it). Also documented well enough by the open-source community.
- **A proprietary/undocumented format** — worst case. Then we have to *watch* the
  vendor software talk to the machine and copy what it says (reverse engineering).

We find out which by identifying the machine and, if needed, capturing traffic.

### 2. The "pipe" (transport) — how bytes physically reach it

Candidates, best-first for a Mac:

- **USB acting as a serial port** (most likely). The direct-connect USB port
  probably contains a USB-to-serial chip (FTDI / CH340 / CP210x / Prolific).
  macOS needs the matching driver, and then the machine shows up as
  `/dev/cu.usbserial-XXXX`. **This is very likely why "the drivers didn't work" —
  it needed a specific chip driver.** Once it appears, sending bytes is easy.
- **USB acting as a printer** (USB printer class). Then we send data to it like a
  raw print job. Also workable on Mac.
- **LAN / Ethernet** (plan B). Many machines accept a raw TCP stream on a port
  (often 9100, the "raw print" port). Mac has no Ethernet socket, but a cheap
  USB-C→Ethernet adapter fixes that. Slightly more setup, so it's our fallback.

## Honest difficulty assessment

| Scenario | Likelihood | Difficulty | Notes |
|---|---|---|---|
| USB-serial + HPGL/GPGL | Medium-High | **Easy–Medium** | The happy path. A weekend-scale build. |
| USB-serial + proprietary | Medium | **Medium–Hard** | Needs traffic capture from vendor software (usually Windows). |
| USB-printer class | Medium | **Medium** | Send raw job; still need to know the language. |
| LAN raw socket | Medium | **Medium** | Great once found; needs adapter + finding the IP/port. |
| No documented anything + Mac-only | Low-ish | **Hard** | Might need a Windows box just to sniff the vendor app once. |

### The one real risk to name up front

If the machine is fully proprietary **and** its vendor software only runs on
Windows, we will likely need a Windows machine (or VM) **once**, to record how
the official software talks to the cutter. After that one capture, we can rebuild
everything on Mac. This is the step most likely to add friction. We'll know
whether we need it only after Phase 1 (identification).

## Recommendation

Proceed. Phase 1 (identify the machine + see how it shows up on the Mac) is cheap,
fast, and non-destructive, and it tells us which branch of the table above we're
on. We commit to the bigger build only after that.
