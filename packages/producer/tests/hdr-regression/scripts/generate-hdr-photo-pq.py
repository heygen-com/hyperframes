#!/usr/bin/env python3
"""
Generate the deterministic 16-bit BT.2020 PQ PNG fixture used by the
hdr-regression test (window H scene B).

Why a custom script (instead of ffmpeg)?
  ffmpeg writes 16-bit RGB PNGs but does not embed a cICP chunk, so
  Chromium does not treat the file as HDR. We synthesize a small RGB48
  bitmap and inject a `cICP` chunk (primaries=BT.2020, transfer=PQ,
  matrix=GBR, range=full) right after IHDR.

Output:
  packages/producer/tests/hdr-regression/src/hdr-photo-pq.png
"""

import os
import struct
import sys
import zlib

WIDTH = 256
HEIGHT = 144
OUT_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "src", "hdr-photo-pq.png")
)


def make_image_bytes() -> bytes:
    """A simple horizontal gradient with super-bright PQ peaks at the right edge."""
    rows = []
    for y in range(HEIGHT):
        row = bytearray()
        for x in range(WIDTH):
            t = x / max(WIDTH - 1, 1)
            r = int(20000 + 45000 * t)
            g = int(15000 + 50000 * (1.0 - abs(2 * t - 1)))
            b = int(60000 - 50000 * t)
            r = max(0, min(65535, r))
            g = max(0, min(65535, g))
            b = max(0, min(65535, b))
            row += struct.pack(">HHH", r, g, b)
        rows.append(b"\x00" + bytes(row))
    return b"".join(rows)


def chunk(ctype: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(ctype + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", crc)


def main() -> int:
    raw = make_image_bytes()
    compressed = zlib.compress(raw, level=9)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(
        b"IHDR",
        struct.pack(">IIBBBBB", WIDTH, HEIGHT, 16, 2, 0, 0, 0),
    )
    cicp = chunk(b"cICP", bytes([9, 16, 0, 1]))
    idat = chunk(b"IDAT", compressed)
    iend = chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(sig + ihdr + cicp + idat + iend)
    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
