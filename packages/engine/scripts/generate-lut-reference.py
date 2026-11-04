#!/usr/bin/env python3
"""
Regenerate the byte-exact sRGB -> BT.2020 (HLG/PQ) probe table pinned in
packages/engine/src/utils/alphaBlit.test.ts (SRGB_TO_HDR_REFERENCE).

Usage:
    python3 packages/engine/scripts/generate-lut-reference.py --probes   # paste over the table
    python3 packages/engine/scripts/generate-lut-reference.py            # full 256-entry LUTs as JSON

This file MIRRORS buildSrgbToSignalLut() in alphaBlit.ts: change both together,
then run alphaBlit.test.ts. js_round_nonneg matches JS Math.round, the one
rounding difference from Python.
"""

import argparse
import json
import math
import sys
from collections.abc import Iterable

# HLG OETF constants (Rec. 2100) — keep in sync with alphaBlit.ts
HLG_A = 0.17883277
HLG_B = 1 - 4 * HLG_A
HLG_C = 0.5 - HLG_A * math.log(4 * HLG_A)
# BT.2408 SDR-reference white in HLG: the scene light (relative to peak) at 75% signal
HLG_SDR_WHITE = (math.exp((0.75 - HLG_C) / HLG_A) + HLG_B) / 12

# PQ (SMPTE 2084) OETF constants — keep in sync with alphaBlit.ts
PQ_M1 = 0.1593017578125
PQ_M2 = 78.84375
PQ_C1 = 0.8359375
PQ_C2 = 18.8515625
PQ_C3 = 18.6875
PQ_MAX_NITS = 10000.0
SDR_NITS = 203.0  # BT.2408 SDR-reference white in PQ


def js_round_nonneg(x: float) -> int:
    """
    Match JS Math.round semantics for non-negative inputs.

    JS Math.round rounds half toward +∞ (Math.round(0.5) === 1). Python's
    built-in round() uses banker's rounding (round half to even, so
    round(0.5) === 0 and round(2.5) === 2), which would diverge from
    Math.round for the ~ten or so probe values that fall on a half-integer
    after signal*65535. This helper is only correct for x >= 0 — that's
    fine because signal is always in [0, 1] here.
    """
    return int(math.floor(x + 0.5))


def srgb_eotf(i: int) -> float:
    """sRGB 8-bit code value → linear light in [0, 1] relative to SDR white."""
    v = i / 255
    return v / 12.92 if v <= 0.04045 else math.pow((v + 0.055) / 1.055, 2.4)


def hlg_oetf(linear: float) -> float:
    # Place SDR-reference white at 75% HLG signal (BT.2408), like PQ's 203 nits.
    scene = linear * HLG_SDR_WHITE
    if scene <= 1 / 12:
        return math.sqrt(3 * scene)
    return HLG_A * math.log(12 * scene - HLG_B) + HLG_C


def pq_oetf(linear: float) -> float:
    # Place SDR-reference white at 203 nits within the 10000-nit PQ peak.
    # This is what reserves headroom for HDR highlights above SDR-white.
    lp = max(0.0, (linear * SDR_NITS) / PQ_MAX_NITS)
    lm1 = math.pow(lp, PQ_M1)
    return math.pow((PQ_C1 + PQ_C2 * lm1) / (1.0 + PQ_C3 * lm1), PQ_M2)


def build_lut(transfer: str) -> list[int]:
    out: list[int] = []
    for i in range(256):
        linear = srgb_eotf(i)
        signal = hlg_oetf(linear) if transfer == "hlg" else pq_oetf(linear)
        out.append(min(65535, js_round_nonneg(signal * 65535)))
    return out


# Mirror SRGB_TO_HDR_REFERENCE indices in alphaBlit.test.ts. Endpoints
# (0, 1, 254, 255) catch off-by-one regressions; mid-range values (32, 64,
# 96, 128, 160, 192, 224) sample the middle of both transfer curves.
DEFAULT_PROBES: tuple[int, ...] = (0, 1, 10, 32, 64, 96, 128, 160, 192, 224, 254, 255)


def emit_json(hlg: list[int], pq: list[int]) -> None:
    print(json.dumps({"size": 256, "hlg": hlg, "pq": pq}, indent=2))


def emit_probes(hlg: list[int], pq: list[int], probes: Iterable[int]) -> None:
    # Output is paste-ready TS for SRGB_TO_HDR_REFERENCE in alphaBlit.test.ts.
    print("const SRGB_TO_HDR_REFERENCE: readonly SrgbHdrProbe[] = [")
    for i in probes:
        if not 0 <= i <= 255:
            raise ValueError(f"probe index {i} out of range [0, 255]")
        print(f"  {{ srgb: {i}, hlg: {hlg[i]}, pq: {pq[i]} }},")
    print("];")


def parse_indices(s: str) -> list[int]:
    return [int(x.strip()) for x in s.split(",") if x.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Regenerate sRGB → BT.2020 (HLG/PQ) LUT reference values.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--probes",
        action="store_true",
        help="Emit a TS snippet ready to paste over SRGB_TO_HDR_REFERENCE.",
    )
    parser.add_argument(
        "--probe-indices",
        type=parse_indices,
        default=list(DEFAULT_PROBES),
        help="Comma-separated probe indices (default mirrors alphaBlit.test.ts).",
    )
    args = parser.parse_args()

    hlg = build_lut("hlg")
    pq = build_lut("pq")

    if args.probes:
        emit_probes(hlg, pq, args.probe_indices)
    else:
        emit_json(hlg, pq)
    return 0


if __name__ == "__main__":
    sys.exit(main())
