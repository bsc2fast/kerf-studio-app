#!/usr/bin/env python3
"""make-sample.py — build app/samples/kerf-sample-a4.pdf, the test sheet.

An A4 print-and-cut sheet the way Illustrator would hand it to the cutter:
CMYK artwork, the 4 camera registration dots, and cut lines stroked in a spot
colour (Separation) named "Cut" — the only thing Kerf extracts from a PDF.

The cut layout is symmetric left-right and top-bottom, and centred on the
frame the dots define (their centres are 190 x 277 mm apart = the bed). So it
cuts true whichever way the artwork is rotated or flipped onto the bed: a safe
first sheet for a new machine. No dependencies:  python3 scripts/make-sample.py
"""
import math
import os
import zlib

MM = 72 / 25.4
W, H = 210.0, 297.0                                    # A4 portrait, mm
# registration dots (cutter-registration-marks skill, A4): centres, Ø5 mm, #272525
MARKS = [(10.070, 10.158), (200.070, 10.158), (10.070, 287.158), (200.070, 287.158)]
MARK_D = 5.0
CX = (MARKS[0][0] + MARKS[1][0]) / 2                   # centre of the mark frame
CY = (MARKS[0][1] + MARKS[2][1]) / 2
BLEED = 2.0                                            # print runs past the cut
K = 0.5522847498                                       # circle Bezier constant


def pt(x, y):  # mm, Y-down -> PDF points, Y-up
    return f"{x * MM:.3f} {(H - y) * MM:.3f}"


def circle(cx, cy, r):
    k = r * K
    return "\n".join([
        f"{pt(cx + r, cy)} m",
        f"{pt(cx + r, cy - k)} {pt(cx + k, cy - r)} {pt(cx, cy - r)} c",
        f"{pt(cx - k, cy - r)} {pt(cx - r, cy - k)} {pt(cx - r, cy)} c",
        f"{pt(cx - r, cy + k)} {pt(cx - k, cy + r)} {pt(cx, cy + r)} c",
        f"{pt(cx + k, cy + r)} {pt(cx + r, cy + k)} {pt(cx + r, cy)} c",
        "h"])


def rrect(cx, cy, w, h, r):
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    k = r * (1 - K)
    return "\n".join([
        f"{pt(x0 + r, y0)} m", f"{pt(x1 - r, y0)} l",
        f"{pt(x1 - k, y0)} {pt(x1, y0 + k)} {pt(x1, y0 + r)} c", f"{pt(x1, y1 - r)} l",
        f"{pt(x1, y1 - k)} {pt(x1 - k, y1)} {pt(x1 - r, y1)} c", f"{pt(x0 + r, y1)} l",
        f"{pt(x0 + k, y1)} {pt(x0, y1 - k)} {pt(x0, y1 - r)} c", f"{pt(x0, y0 + r)} l",
        f"{pt(x0, y0 + k)} {pt(x0 + k, y0)} {pt(x0 + r, y0)} c", "h"])


def polygon(points):
    return "\n".join([f"{pt(*points[0])} m"] + [f"{pt(*p)} l" for p in points[1:]] + ["h"])


def hexagon(cx, cy, r):  # flat top/bottom
    return polygon([(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in range(0, 360, 60)])


def star4(cx, cy, r, ri):  # 4-point star
    return polygon([(cx + (r if i % 2 == 0 else ri) * math.cos(math.radians(-90 + 45 * i)),
                     cy + (r if i % 2 == 0 else ri) * math.sin(math.radians(-90 + 45 * i))) for i in range(8)])


# (shape fn, cut args, bleed args, CMYK fill) — mirror pairs keep it symmetric
DY, DX = 82.0, 48.0
STICKERS = []
for sy in (-1, 1):
    for sx in (-1, 1):
        STICKERS.append((hexagon, (CX + sx * DX, CY + sy * DY, 32), (CX + sx * DX, CY + sy * DY, 32 + BLEED / math.cos(math.radians(30))),
                         (0.62, 0.10, 0, 0) if sy < 0 else (0, 0.55, 0.62, 0)))
    STICKERS.append((circle, (CX, CY + sy * DY, 11), (CX, CY + sy * DY, 11 + BLEED), (0, 0.18, 0.85, 0)))
for sx in (-1, 1):
    STICKERS.append((rrect, (CX + sx * DX, CY, 70, 56, 12), (CX + sx * DX, CY, 70 + 2 * BLEED, 56 + 2 * BLEED, 12 + BLEED),
                     (0.70, 0, 0.42, 0)))
STICKERS.append((star4, (CX, CY, 9, 3.4), (CX, CY, 9 + BLEED * 1.4, 3.4 + BLEED * 0.6), (0, 0.85, 0.30, 0)))


def content():
    out = []
    for fn, cut, bleed, cmyk in STICKERS:                     # print: CMYK fills
        out += [f"{cmyk[0]} {cmyk[1]} {cmyk[2]} {cmyk[3]} k", fn(*bleed), "f"]
    out += ["0 0 0 0.75 k", "BT /F1 8 Tf",                    # caption, clear of the dots
            f"1 0 0 1 {(CX - 41) * MM:.3f} {(H - 278) * MM:.3f} Tm",
            "(Kerf sample sheet  -  print at 100% / Actual size, then cut) Tj", "ET"]
    out += ["0.15463 0.14662 0.14664 rg"]                     # registration dots
    out += [circle(x, y, MARK_D / 2) + "\nf" for x, y in MARKS]
    out += ["/CS0 CS 1 SCN", f"{0.25 * MM:.3f} w"]            # cut lines: spot colour "Cut"
    out += [fn(*cut) + "\nS" for fn, cut, bleed, cmyk in STICKERS]
    return "\n".join(out).encode()


def build(path):
    data = zlib.compress(content(), 9)
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W * MM:.3f} {H * MM:.3f}] "
         "/Resources << /ColorSpace << /CS0 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>").encode(),
        b"<< /Length " + str(len(data)).encode() + b" /Filter /FlateDecode >>\nstream\n" + data + b"\nendstream",
        b"[/Separation /Cut /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0 0] /N 1 >>]",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Title (Kerf sample sheet, A4) /Producer (kerf-studio-app scripts/make-sample.py) >>",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    with open(path, "wb") as f:
        f.write(out)


if __name__ == "__main__":
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "samples", "kerf-sample-a4.pdf")
    build(dest)
    print("wrote", os.path.normpath(dest))
