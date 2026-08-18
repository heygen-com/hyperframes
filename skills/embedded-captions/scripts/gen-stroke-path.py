#!/usr/bin/env python3
"""gen-stroke-path.py — generalized draw-on path generator.

Lays out ANY word in a single-line (pen-path) SVG font — Hershey/EMS — and emits
one continuous-dash-revealable path `d`. The glyph data IS the pen path, so
stroke-order reveal is exact by construction for any text, no per-word tuning.

Usage: gen-stroke-path.py <font.svg> <text> <target_width_px> <baseline_y> <x0>
Prints: the path `d` string + layout info on stderr.
"""
import re, sys

# Windows sizes stdio to the ANSI code page (cp1252). These scripts emit UTF-8 on
# every platform; say so rather than depending on the console's code page. Carry
# `errors` across: reconfigure() resets it to "strict", and CPython deliberately gives
# stderr "backslashreplace" so the diagnostic path can never itself raise.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)

font_path, text, target_w, baseline_y, x0 = (
    sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]))

# SVG fonts are UTF-8 and each glyph's `unicode="…"` attribute IS a literal character.
# Decoded with the platform default, a non-ASCII glyph key silently becomes the wrong
# character (or raises) on Windows, so that glyph never matches the requested text.
svg = open(font_path, encoding="utf-8").read()
glyphs = {}
for m in re.finditer(r'<glyph\s+unicode="(.)"[^>]*?horiz-adv-x="([\d.]+)"(?:[^>]*?d="([^"]*)")?', svg):
    ch, adv, d = m.group(1), float(m.group(2)), m.group(3) or ""
    glyphs[ch] = (adv, d)
# default advance for space
space_adv = glyphs.get(" ", (300, ""))[0]

# total advance width in font units
total = 0.0
for ch in text:
    total += glyphs.get(ch, (space_adv, ""))[0]
s = target_w / total                       # scale font-units → px

out = []
cursor = 0.0
NUM = re.compile(r"[-\d.]+")
for ch in text:
    adv, d = glyphs.get(ch, (space_adv, ""))
    if d:
        # polylines only (M/L): transform every coordinate pair
        toks = re.findall(r"([ML])\s+([-\d.]+)\s+([-\d.]+)", d)
        for cmd, xs, ys in toks:
            x = x0 + (cursor + float(xs)) * s
            y = baseline_y - float(ys) * s          # SVG-font y is UP; flip
            out.append(f"{cmd} {x:.1f} {y:.1f}")
    cursor += adv

print(" ".join(out))
print(f"[gen] chars={len(text)} scale={s:.3f} width={total*s:.0f}px "
      f"subpaths={sum(1 for o in out if o.startswith('M'))}", file=sys.stderr)
