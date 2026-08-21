---
name: cursor-drag
description: The drag verb for driven cursors — grab, lift, travel, drop-snap. A semi-transparent ghost chip rides the cursor in exact lockstep and snaps into a placed field with selection chrome; variants cover fill-handle auto-fill down rows, corner-handle proportional resize (uniform scale only), and grab-lift-reorder with the neighbor springing into the vacated slot.
metadata:
  tags: cursor, drag, drop, ghost, handle, resize, reorder, snap, interaction, mouse
---

# Cursor Drag

> Cursor look, sizing, off-screen entry, and tip-targeting defer to the **oversized-cursor house doctrine** — this rule owns the drag _mechanics_ only.

THE held-journey verb: the cursor presses down on a payload, carries it, and releases it somewhere else. The load-bearing law is **lockstep**: the cursor tip and the payload's grip point move as one rigid object for the entire travel — a one-frame drift reads as the chip slipping out of the hand. Distinct from [cursor-click-ripple.md](cursor-click-ripple.md) (move → point event at a single location): a drag is a _sustained hold across space_, and the payload is the co-star. Reuse [physics-press-reaction.md](physics-press-reaction.md) for the grab's press dip (cursor + payload compress together); for N simultaneous actors see [multi-cursor-choreography.md](multi-cursor-choreography.md) — this rule is one protagonist performing a workflow beat.

## How It Works

Five beats: **approach** (cursor glides to the source chip, `power2.inOut`) → **grab** (press dip on cursor + chip together; on the down-beat `tl.set` reveals the **ghost** — a pre-rendered semi-transparent clone at the chip's position — plus a small lift `fromTo` to `GHOST_LIFT_SCALE` with a soft shadow, `immediateRender: false`) → **travel** (cursor and ghost move as **matched tweens**) → **drop** (ghost off, placed field pops in with selection chrome) → **adjust / exit** (optional handle resize, then the cursor glides to the next target).

Matched tweens = same timeline position, same duration, same ease, over straight lines — that keeps the pair rigidly locked at every eased midpoint. A shared `[cursor, ghost]` targets array only works when both need identical deltas; with different start points, use two matched `fromTo`s. Rule-specific corollary of the contract's absolute-values law: a relative `+=` travel on either partner breaks the lockstep under seek.

Measure chip and slot rects at build time — a 4 px miss on the drop line reads as a failed drag (montage: authored CSS-matched constants, per the contract). `TIP_OFFSET_X/Y` aligns the cursor's TIP (not its bbox) with the grip point.

## Recipe

```html
<!-- Ghost = clone of the chip AT the chip's position, in DOM from t=0, opacity: 0.
     Same silhouette as the chip — or hand and payload read as different objects.
     Placed field sits at the slot's final position, opacity: 0, with a .select-box
     and four corner .handle elements inside. -->
<div class="tray-chip" id="source-chip"><span class="grip-dots">⋮⋮</span> {chipLabel}</div>
<div class="drag-ghost" id="drag-ghost"><span class="grip-dots">⋮⋮</span> {chipLabel}</div>
<div class="placed-field" id="placed-field">
  {placedLabel}
  <!-- + selection chrome -->
</div>
<div class="cursor" id="cursor"><!-- arrow SVG --></div>
```

```js
const chipRect = document.querySelector("#source-chip").getBoundingClientRect();
const slotRect = document.querySelector("#placed-field").getBoundingClientRect();
const TRAVEL_DX = slotRect.left - chipRect.left;
const TRAVEL_DY = slotRect.top - chipRect.top;

// Travel — MATCHED tweens: same position, duration, ease; absolute endpoints.
tl.fromTo(
  "#drag-ghost",
  { x: 0, y: 0 },
  { x: TRAVEL_DX, y: TRAVEL_DY, duration: TRAVEL_DUR, ease: TRAVEL_EASE, immediateRender: false },
  TRAVEL_AT,
);
tl.fromTo(
  "#cursor",
  { x: chipRect.left + TIP_OFFSET_X, y: chipRect.top + TIP_OFFSET_Y },
  {
    x: chipRect.left + TIP_OFFSET_X + TRAVEL_DX,
    y: chipRect.top + TIP_OFFSET_Y + TRAVEL_DY,
    duration: TRAVEL_DUR,
    ease: TRAVEL_EASE,
    immediateRender: false,
  },
  TRAVEL_AT,
);

// Drop is a state commit: ghost off + placed field on at the SAME position.
tl.set("#drag-ghost", { opacity: 0 }, DROP_AT);
tl.fromTo(
  "#placed-field",
  { opacity: 0, scale: 0.92 },
  { opacity: 1, scale: 1, duration: SNAP_DUR, ease: "power3.out" },
  DROP_AT,
);
tl.fromTo(
  [".select-box", ".handle"],
  { opacity: 0, scale: 0.6 },
  { opacity: 1, scale: 1, duration: 0.18, ease: "power3.out", stagger: 0.02 },
  DROP_AT + SNAP_DUR * 0.4,
);
```

## Variations

- **Corner-handle proportional resize** — width/height tweens are forbidden, so the resize renders as uniform `scale` with `transform-origin` at the **opposite (anchor) corner**: the anchor stays put, the dragged corner travels. The corner's position is _linear in scale_ (`corner = anchor + scale × (corner₀ − anchor)`), so a cursor tween to the corner's end position with the **same duration and ease** stays glued to the handle exactly:

  ```js
  tl.to(
    "#placed-field",
    { scale: RESIZE_SCALE, transformOrigin: "0% 0%", duration: RESIZE_DUR, ease: "power2.inOut" },
    RESIZE_AT,
  );
  tl.to(
    "#cursor",
    { x: CORNER_END_X, y: CORNER_END_Y, duration: RESIZE_DUR, ease: "power2.inOut" },
    RESIZE_AT,
  );
  ```

  One-axis resizes are `scaleX`/`scaleY` on the same origin logic — stretch-safe boxes only; route to [anchored-layout-expand.md](anchored-layout-expand.md)'s counter-scale when content must stay undistorted.

- **Fill-handle auto-fill** — the spreadsheet verb: the cursor drags a cell's fill handle straight down on a `"none"` (linear) ease; each row commits via a snapped `tl.set` (never a fade) keyed to the handle's linear progress, so the fill edge and cursor never separate:

  ```js
  tl.fromTo(
    "#cursor",
    { y: HANDLE_Y },
    { y: HANDLE_Y + FILL_DIST, duration: FILL_DUR, ease: "none", immediateRender: false },
    FILL_AT,
  );
  gsap.utils.toArray(".fill-cell").forEach((cell, i) => {
    tl.set(cell, { opacity: 1 }, FILL_AT + ((i + 1) / CELL_COUNT) * FILL_DUR);
  });
  ```

- **Grab-lift-reorder** — lift = `y: -LIFT_RISE` + `rotation: LIFT_TILT` (sign from index parity) + shadow on; as the carried item crosses the neighbor's midpoint, the **neighbor springs into the vacated slot** (a `fromTo` translate at `TRAVEL_AT + TRAVEL_DUR * 0.5`, `power3.out`); drop = rotation → 0, shadow off, settle. The neighbor's counter-move sells the reorder — without it the list reads as broken.
- **Component grab between surfaces** — a chip dragged mockup-to-mockup, swapping identity on drop (`tl.set` recolor + label swap at `DROP_AT`, tiny settle pop); the drop chrome is just the identity swap, no handles.

## Values

| token                       | range                                        | notes                                                                                                                          |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| approach / press            | per cursor-click-ripple                      | approach 0.4–1.0 s; press-dip halves 0.06–0.12 s; cursor compresses more than the payload                                      |
| GHOST_OPACITY               | 0.5–0.75                                     | below 0.5 vanishes on busy documents; ~1.0 reads as the original moving — then hide `#source-chip` at the grab                 |
| GHOST_LIFT_SCALE / LIFT_DUR | 1.03–1.08 / 0.12–0.2 s                       | the shadow is the "off the surface" cue; the scale is garnish                                                                  |
| TRAVEL_DUR / TRAVEL_EASE    | 0.6–1.2 s / `power2.inOut`                   | a considered drag decelerates into the slot; `power1.inOut` for a calmer carry. `TRAVEL_AT ≥ GRAB_AT + 2×PRESS_DUR + LIFT_DUR` |
| DROP_AT / SNAP_DUR          | `TRAVEL_AT + TRAVEL_DUR` exactly / 0.2–0.3 s | a gap between arrival and snap reads as the drop failing                                                                       |
| RESIZE_SCALE / RESIZE_DUR   | by story (≈0.4–0.6) / 0.6–1.0 s              | `power2.inOut`                                                                                                                 |
| LIFT_RISE / LIFT_TILT       | 6–12 px / 2–4°                               | reorder pickup; index-derived tilt sign                                                                                        |

## Critical Constraints

- **Lockstep is the law** — matched tweens over straight lines (or one shared tween when deltas are identical); verify at the eased midpoint, not just the endpoints. Absolute endpoints on both partners.
- **The ghost is pre-rendered** — a DOM clone at the source position from t=0, `opacity: 0`, revealed by `tl.set`; placed field and chrome likewise. Never cloned at runtime, never conditionally rendered.
- **Grab has weight** — press dip + lift shadow before any travel; a chip departing without a press reads as telekinesis.
- **Drop is a state commit** — ghost off and placed field on at the same timeline position, `DROP_AT = TRAVEL_AT + TRAVEL_DUR`.
- **Resizes are uniform `scale`, origin at the anchor corner** — never width/height; one-axis stretch on stretch-safe boxes only.
- **Linear ease on the fill-handle travel** — the evenly-spaced `tl.set` reveals depend on it; an eased handle bunches them at the ends.
- **One verb per beat** — drag, then resize, then exit; overlapping a travel with a resize turns choreography into mush.
- **`pointer-events: none`** on cursor, ghost, and chrome.

## See also

`physics-press-reaction` (the grab's press dip) · `cursor-click-ripple` (a plain click before/after) · `spring-pop-entrance` (the placed field's snap-settle) · `waterfall-entry` (kinetic fill cascade) · `multi-phase-camera` (the zoom-breathing carrier shot golden drag demos ride) · `multi-cursor-choreography` (this verb inside an ensemble).
