# Seam law (fixed excerpt — rides with every seam packet)

**Cut at peak velocity, match direction and speed on both sides of the cut.**

1. **Axis** — x stays x, y stays y, Z stays Z. Never trade axes across a cut.
2. **Direction** — never mirror. On Z, direction = the SIGN of scale change: growing =
   push, shrinking = pull. A receding exit answered by a grow-from-small entry is a
   mirrored vector — the most common violation.
3. **Speed** — entry initial velocity ≈ exit final velocity, via mirrored eases (exit
   `power4.in` + entry `power4.out`, same distance and duration).
4. **Phase** — the cut lands mid-motion on BOTH sides. Settling to rest before the cut,
   or starting from rest after it, is a dead beat.

**Blur logic (Z variants):** text-scale peak blur **10px** (20px smears letterforms);
full-frame surface **18–20px** (lighter reads as a rendering hiccup). Same peak blur on
both sides at the swap frame. Blur the WRAPPER, never children.

**Stage ground:** `#root` must be opaque (`background: var(--canvas-deep, var(--canvas, #000))`)
— a mid-window cut opens a summed-opacity < 1 window that flashes white otherwise.

The full law (current, ledger, gate) is `motion-doctrine`; the verifier
(`seam-gate.mjs`) numerically enforces exits/entries — a violated law fails there.
