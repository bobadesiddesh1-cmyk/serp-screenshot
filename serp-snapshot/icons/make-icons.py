#!/usr/bin/env python3
"""
make-icons.py — generate SERP Snapshot's PNG icons with zero dependencies.

Design: a bold "SS" monogram in white on a near-black (#111827) rounded square,
with a single emerald (#10b981) accent underline. Rendered with 4x supersampling
and averaged down, so edges are clean even at 16px. Pure stdlib (zlib + struct).

Regenerate after editing colors/geometry:

    python3 icons/make-icons.py

Produces icon16.png, icon32.png, icon48.png, icon128.png in this folder.
These are functional placeholders — swap in brand art before Web Store submission.
"""
import os
import struct
import zlib

BG = (17, 24, 39)        # near-black slate  #111827
INK = (255, 255, 255)    # monogram          white
ACCENT = (16, 185, 129)  # accent underline  #10b981 emerald

SS = 4  # supersampling factor


def in_rounded(x, y, w, h, r):
    """Point-in-rounded-rectangle test."""
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    for cx, cy in ((r, r), (w - r, r), (r, h - r), (w - r, h - r)):
        left = cx == r
        top = cy == r
        if (left and x < r or (not left) and x > w - r) and (
            top and y < r or (not top) and y > h - r
        ):
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                return False
    return True


def in_rect(x, y, rx, ry, rw, rh):
    return rx <= x < rx + rw and ry <= y < ry + rh


def s_glyph(x, y, bx, by, bw, bh, th):
    """
    Is (x,y) inside an 'S' drawn in box (bx,by,bw,bh) with stroke thickness th?
    Built from five bars (7-segment style S): top, upper-left, middle,
    lower-right, bottom.
    """
    half = (bh - th) / 2.0
    # top bar
    if in_rect(x, y, bx, by, bw, th):
        return True
    # middle bar
    if in_rect(x, y, bx, by + half, bw, th):
        return True
    # bottom bar
    if in_rect(x, y, bx, by + bh - th, bw, th):
        return True
    # upper-left vertical (top -> middle)
    if in_rect(x, y, bx, by, th, half + th):
        return True
    # lower-right vertical (middle -> bottom)
    if in_rect(x, y, bx + bw - th, by + half, th, half + th):
        return True
    return False


def sample(x, y, W):
    """Return (r,g,b,a) for a supersample-space pixel at (x,y) on a WxW canvas."""
    radius = W * 0.22
    if not in_rounded(x, y, W, W, radius):
        return (0, 0, 0, 0)

    margin = W * 0.17
    inner = W - 2 * margin
    inner_x = margin
    inner_y = margin

    # Reserve the bottom strip for the accent underline.
    letters_h = inner * 0.66
    gap = inner * 0.10
    letter_w = (inner - gap) / 2.0
    th = max(SS, letter_w * 0.26)

    ly = inner_y + inner * 0.02
    l1x = inner_x
    l2x = inner_x + letter_w + gap

    if s_glyph(x, y, l1x, ly, letter_w, letters_h, th):
        return INK + (255,)
    if s_glyph(x, y, l2x, ly, letter_w, letters_h, th):
        return INK + (255,)

    # Accent underline: centered bar below the monogram.
    acc_w = inner * 0.78
    acc_h = max(SS, th * 0.85)
    acc_x = inner_x + (inner - acc_w) / 2.0
    acc_y = ly + letters_h + inner * 0.10
    if in_rect(x, y, acc_x, acc_y, acc_w, acc_h):
        return ACCENT + (255,)

    return BG + (255,)


def make(size):
    W = size * SS
    # Supersample buffer.
    buf = [[sample(x, y, W) for x in range(W)] for y in range(W)]

    out = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    n = SS * SS
    for oy in range(size):
        for ox in range(size):
            ar = ag = ab = aa = 0
            for sy in range(SS):
                for sx in range(SS):
                    r, g, b, a = buf[oy * SS + sy][ox * SS + sx]
                    ar += r * a
                    ag += g * a
                    ab += b * a
                    aa += a
            if aa == 0:
                out[oy][ox] = (0, 0, 0, 0)
            else:
                out[oy][ox] = (
                    int(ar / aa),
                    int(ag / aa),
                    int(ab / aa),
                    int(aa / n),
                )
    return out


def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        for x in range(size):
            r, g, b, a = px[y][x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 32, 48, 128):
        write_png(os.path.join(here, "icon%d.png" % s), make(s))
        print("wrote icon%d.png" % s)


if __name__ == "__main__":
    main()
