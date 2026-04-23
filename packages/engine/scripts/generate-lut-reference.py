#!/usr/bin/env python3
"""
Regenerate the sRGB → BT.2020 (HLG/PQ) LUT reference values pinned by
packages/engine/src/utils/alphaBlit.test.ts.

This is a paste-helper for the *very rare* case the LUT genuinely needs to
shift — e.g. a spec update changes one of the OETF constants, or we change
the SDR-white reference level in the PQ branch. The reference values in
alphaBlit.test.ts are byte-exact integers, and updating ~12 hand-edited
literals (or all 256 of them, if the test grows) is exactly the kind of
mechanical churn we want to keep out of the diff.

Usage:
    # Regenerate the probe table that lives in alphaBlit.test.ts (paste over
    # the SRGB_TO_HDR_REFERENCE literal):
    python3 packages/engine/scripts/generate-lut-reference.py --probes

    # Dump the full 256-entry LUTs as JSON (for ad-hoc analysis or new tests):
    python3 packages/engine/scripts/generate-lut-reference.py

    # Override the probe set:
    python3 packages/engine/scripts/generate-lut-reference.py --probes \
        --probe-indices 0,32,64,128,192,255

## How to use this when the LUT changes

1. Edit buildSrgbToHdrLut() in packages/engine/src/utils/alphaBlit.ts.
2. Mirror the same edit here (constants, branch logic — keep them in sync).
3. Run with --probes and paste the output over SRGB_TO_HDR_REFERENCE in
   alphaBlit.test.ts. Update the asymmetric-R/G/B and BT.2408-invariant
   tests by hand if those probe values shifted.
4. Re-run `bun test src/utils/alphaBlit.test.ts` to confirm the engine LUT
   and the test-pinned values still agree.

## Why Python (not TS)?

A standalone script avoids dragging the engine's bun/Node/build environment
into a one-off codegen flow, and matches the existing fixture-generation
pattern at packages/producer/tests/hdr-regression/scripts/generate-hdr-photo-pq.py.
Python's math.log / math.pow are libm-backed and produce IEEE-754-equivalent
results to JS's Math.log / Math.pow for these inputs — see js_round_nonneg
below for the one rounding quirk we have to match by hand.

## Drift contract

This file MIRRORS buildSrgbToHdrLut() in alphaBlit.ts. If the two diverge,
this script silently emits wrong values. Any change to one MUST be reflected
in the other; run the script and the test suite together to catch drift.
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
    if linear <= 1 / 12:
        return math.sqrt(3 * linear)
    return HLG_A * math.log(12 * linear - HLG_B) + HLG_C


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
