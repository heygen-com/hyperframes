# Design — Magnetic Vertical Ghost (R2, piece 1 of 4)

> First piece of the CapCut drag-physics work (R2). The full "main-track magnet"
> decomposes into: **(1) magnetic vertical ghost** ← this doc, (2) collision-aware
> placement, (3) main-track designation, (4) main-track no-overlap + ripple.
> Brainstormed 2026-07-08. User approved staged approach, magnetic ghost first.

## 1. Goal

Make moving a clip vertically feel like CapCut: the drag ghost **quantizes to track
lanes** (it sits _in_ a lane rather than floating freely under the cursor) and commits to
an adjacent lane only after the pointer crosses a threshold fraction of a track height into
it. Horizontal drag stays direct (pointer-following) with the existing snap guide.

## 2. Current behavior (what changes)

- `resolveTimelineMove` (`packages/studio/src/player/components/timelineEditing.ts`) commits
  the track at `deltaTrack = Math.round(trackDeltaRaw)` — i.e. the 50% midpoint.
- The drag ghost (`TimelineCanvas.tsx`, `activeDraggedPosition`) renders its `top` from the
  **raw pointer** (`pointerClientY − canvasTop + scrollTop − pointerOffsetY`), so it floats
  freely in both axes. `previewTrack` (the rounded landing track) is computed but only used
  for the commit-on-drop and the horizontal snap guide, not the ghost's vertical position.

## 3. Design

Two focused changes; no new files.

### 3.1 Threshold-based vertical commit (`timelineEditing.ts`)

Replace `const deltaTrack = Math.round(trackDeltaRaw)` with a threshold commit governed by a
new exported constant `MAGNETIC_TRACK_THRESHOLD` (initial value `0.5`, a single tunable
number). The clip stays on its current track until `|trackDeltaRaw|` exceeds
`threshold` into a neighbor, then commits one lane at a time:

```ts
export const MAGNETIC_TRACK_THRESHOLD = 0.5;

// commit to the Nth neighbor once dragged past (N-1 + threshold) track-heights
const magnitude = Math.max(0, Math.floor(Math.abs(trackDeltaRaw) - MAGNETIC_TRACK_THRESHOLD) + 1);
const deltaTrack = trackDeltaRaw === 0 ? 0 : Math.sign(trackDeltaRaw) * magnitude;
```

At `threshold = 0.5` this reproduces today's `round()` behavior exactly (regression-safe
default); lowering it makes lane changes more eager (your ~0.3 memory), raising it makes the
current lane stickier. `EDGE_TRACK_CREATE_THRESHOLD` (0.55, new-track creation past the
first/last lane) and the `trackOrder` index resolution are unchanged.

### 3.2 Lane-quantized ghost `top` (`TimelineCanvas.tsx`)

The ghost's vertical position becomes the lane Y of `previewTrack` instead of the raw
pointer Y. In the same canvas coordinate space already used for track rows:

```ts
top: RULER_H + displayTrackOrder.indexOf(draggedClip.previewTrack) * TRACK_H + CLIP_Y;
```

Ghost `left` stays pointer-following (`pointerClientX − canvasLeft + scrollLeft −
pointerOffsetX`) — horizontal remains direct. If `previewTrack` isn't in
`displayTrackOrder` yet (a just-created edge track), fall back to today's pointer-based
`top` so the ghost still tracks during edge-track creation.

## 4. Non-goals (later pieces)

Collision detection / push-to-free-lane, any "main track" concept, no-overlap enforcement,
ripple/gap-closing. Horizontal snap behavior is unchanged (already shipped in Plan 1).

## 5. Testing

- Unit (`timelineEditing.test.ts`, extend existing): with `threshold = 0.5`, a `trackDeltaRaw`
  of 0.4 stays on the current track and 0.6 commits to the next (parity with old `round`);
  assert one-lane-at-a-time for larger deltas; edge-track creation past the first/last lane
  still fires. If the constant is later retuned, these tests pin the mapping.
- The existing move/snap suites (`useTimelineClipDrag`, `Timeline`) stay green — horizontal
  and commit-on-drop paths are unchanged.
- **Live (the real gate):** rebuild, restart preview, drag a clip up/down over multiple
  tracks — confirm the ghost snaps lane-to-lane (doesn't float vertically), the threshold
  feel matches CapCut, and the drop lands on the shown lane. Tune `MAGNETIC_TRACK_THRESHOLD`
  in the browser with the user.

## 6. Risks

- `displayTrackOrder.indexOf(previewTrack)` returning −1 for a pending edge track → guarded
  by the pointer-Y fallback (3.2).
- Coordinate-space mismatch between lane Y and the scrolled canvas → both use the same
  `RULER_H + row*TRACK_H` basis the track rows already render with; verify live.
- `TRACK_H` is a shared constant (R3 will make heights per-track) — this piece keeps the
  single-constant assumption; R3 will revisit the lane-Y math alongside every other
  `TRACK_H` site.
