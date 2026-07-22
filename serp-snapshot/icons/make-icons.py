#!/usr/bin/env python3
"""
make-icons.py — generate SERP Snapshot's PNG icons with zero dependencies.

Draws a Google-blue rounded square with a white "spreadsheet" grid glyph (rows +
columns), evoking "SERP to spreadsheet". Pure stdlib (zlib + struct), so it runs
anywhere Python 3 does. Regenerate after editing colors/geometry:

    python3 icons/make-icons.py

Produces icon16.png, icon32.png, icon48.png, icon128.png in this folder.
These are functional placeholders — swap in brand art before Web Store submission.
"""
import os
import struct
import zlib

BG = (26, 115, 232, 255)      # Google blue #1a73e8
GRID = (255, 255, 255, 255)   # white grid lines
CELL = (255, 255, 255, 60)    # faint cell fill
TRANSPARENT = (0, 0, 0, 0)


def rounded(x, y, w, h, r):
    """Is pixel (x,y) inside a w*h rounded rect with corner radius r?"""
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    # Corner circles
    for cx, cy in ((r, r), (w - 1 - r, r), (r, h - 1 - r), (w - 1 - r, h - 1 - r)):
        in_corner_zone = (
            (x < r and y < r and cx == r and cy == r)
            or (x > w - 1 - r and y < r and cx == w - 1 - r and cy == r)
            or (x < r and y > h - 1 - r and cx == r and cy == h - 1 - r)
            or (x > w - 1 - r and y > h - 1 - r and cx == w - 1 - r and cy == h - 1 - r)
        )
        if in_corner_zone:
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                return False
    return True


def make(size):
    px = [[TRANSPARENT for _ in range(size)] for _ in range(size)]
    radius = max(2, size // 6)

    # Background rounded square.
    for y in range(size):
        for x in range(size):
            if rounded(x, y, size, size, radius):
                px[y][x] = BG

    # Grid geometry: an inset table with 3 rows x 3 cols.
    margin = max(2, size // 5)
    inner = size - 2 * margin
    if inner < 6:
        inner = size - 2 * max(1, size // 8)
        margin = (size - inner) // 2
    line = max(1, size // 32)
    rows = cols = 3
    step = inner / rows

    def in_table(x, y):
        return margin <= x < margin + inner and margin <= y < margin + inner

    # Faint cell fill for the table body.
    for y in range(size):
        for x in range(size):
            if in_table(x, y) and px[y][x] == BG:
                px[y][x] = blend(BG, CELL)

    # Grid lines (horizontal + vertical, including outer border).
    for i in range(rows + 1):
        gy = int(round(margin + i * step))
        for x in range(margin, margin + inner + 1):
            for t in range(line):
                yy = min(size - 1, gy + t)
                if in_table(x, yy) or yy == int(round(margin + inner)):
                    if 0 <= x < size and 0 <= yy < size and px[yy][x] != TRANSPARENT:
                        px[yy][x] = GRID
    for j in range(cols + 1):
        gx = int(round(margin + j * step))
        for y in range(margin, margin + inner + 1):
            for t in range(line):
                xx = min(size - 1, gx + t)
                if in_table(xx, y) or xx == int(round(margin + inner)):
                    if 0 <= xx < size and 0 <= y < size and px[y][xx] != TRANSPARENT:
                        px[y][xx] = GRID

    return px


def blend(base, over):
    """Alpha-composite `over` onto opaque `base`."""
    a = over[3] / 255.0
    return (
        int(base[0] * (1 - a) + over[0] * a),
        int(base[1] * (1 - a) + over[1] * a),
        int(base[2] * (1 - a) + over[2] * a),
        255,
    )


def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None) per scanline
        for x in range(size):
            r, g, b, a = px[y][x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

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
