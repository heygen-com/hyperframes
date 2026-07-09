# Timeline & Canvas Interaction UX — industry spec, current inventory, gap plan

> Produced 2026-07-09 from a 3-agent sweep: (1) industry-standard research across
> CapCut / Premiere / FCP / Resolve / Descript / Canva / Clipchamp / Remotion,
> (2) a full inventory of our current interaction surface, (3) root-cause of the
> playhead-reset-on-drop bug. Goal (user, verbatim): "maximum nice interactions
> and experience and convenience in timeline and canvas dragging resizing and etc."

## 1. The two invariants we currently violate

1. **The playhead NEVER moves as a side effect of an edit.** Universal pro-NLE
   behavior. We violate it on every drop (see §4). Sole sanctioned exception:
   clamping the playhead when content shrinks past it.
2. **New media lands at drop-x, not at the playhead.** Playhead-insert is only
   for button/shortcut-driven adds. Our `useTimelineAssetDrop` lands everything
   at the playhead (deliberate "CapCut-like" choice at the time, but the industry
   convention for an actual *drag* is drop-x with a ghost preview).

## 2. Numeric defaults (converged industry values)

- Snap threshold: **5 px screen-space** (timeline and canvas smart guides), frame-quantized commit.
- Drag-start threshold: **3–4 px** (below = click-select).
- Edge auto-scroll zone: **40–50 px**, speed eased ~2 → 20+ px/frame across the zone, scaled by zoom.
- Rotation soft-snap: 0/90/180/270 at ~2–3° tolerance; Shift = 15° increments.
- Nudge: 1 px arrows, 10 px Shift+arrows (canvas); coalesce per key-burst into one undo.
- Invalid-drop return animation ≤ 200 ms; snap lines appear instantly (no fade-in).
- One gesture = exactly one undo entry, recorded on pointer-up; Esc cancels with no entry.
- 60 fps drags via `transform` on compositor layers; commit to store on pointer-up only.

## 3. Current inventory (verified, file:line in packages/studio/src)

WORKS: clip drag w/ zone model (`useTimelineClipDrag`, `timelineCollision.resolveZoneDropPlacement`),
snapping w/ playhead/clip-edge/beat targets 8px (`timelineSnapping.ts`), snap/grid toolbar (S/G keys),
trim handles (`TimelineClip.tsx`), split at playhead, shift-range select, delete, in/out points,
zoom 10–2000% + pinch, track hide + headers, marquee (canvas), 8-handle resize + rotate + crop
(canvas `DomEditOverlay` et al.), off-canvas indicators, JKL/space/frame-step transport,
undo/redo/copy/paste/group hotkeys.

TOP GAPS (ranked by CapCut-user impact):
1. Canvas arrow-key nudge (absent for DOM elements)
2. Multi-select alignment tools (absent)
3. Z-order controls (absent)
4. Inline text editing on canvas (absent — property panel only)
5. Playhead-neutral edits (violated — §4 bug)
6. Drop-at-drop-x with ghost preview for new media (lands at playhead, no ghost)
7. Drag past timeline edge (clamped; produced a runaway 110s fling — pixel→time blowup)
8. Track mute/solo (only hide)
9. Live marquee preview during drag
10. Numeric in/out fields on clips

## 4. Playhead-reset-on-drop root cause (verified)

`pendingSeekRef` is a single-slot queue that is not safe across overlapping reloads:

- `saveSeekPosition` (`useTimelinePlayer.ts:467-476`) stores adapter time into
  `pendingSeekRef`, once, at `refreshPlayer` (:477-485).
- `initializeAdapter` (`useTimelineSyncCallbacks.ts:209-244`) consumes it and
  **nulls it immediately** (:222). Falls back to `startTime = 0` when null (:224).
- Drop handlers end with `reloadPreview()`; App.tsx ALSO has staggered
  `refreshPreviewDocumentVersion` timers (80/300 ms, App.tsx:108-116). Any second
  reload after consumption seeks to **0**; any second `saveSeekPosition` while the
  iframe is mid-load overwrites the slot with a stale/not-ready value → "random" jumps.

Fix direction (minimal): make seek restoration resilient to overlapping reloads —
e.g. don't null the ref until the adapter is actually ready, or carry the seek
through the reload explicitly (`?_seek=` param or generation-counter on the ref).
Additionally, per §1, a drop should not need seek restoration at all if the edit
never disturbs the playhead.

## 5. Implementation order (agreed direction)

P0 — correctness of what exists:
  a. Playhead-neutral edits (fix §4 race; test: every edit op leaves playhead unchanged)
  b. Drag-past-edge auto-scroll + extend (kill the 110s runaway; task #2)
  c. External OS drop == internal asset drop, both at drop-x with ghost (tasks #3 + gap 6)
P1 — feel: ghost previews post-snap, snap-line polish, cursor vocabulary, escape-cancels-drag,
  one-undo-per-gesture audit, invalid-drop return animation.
P2 — canvas: nudge keys, alignment palette, z-order controls, inline text edit.
P3 — timeline power: mute/solo, rolling trim, live marquee, numeric fields.

## 6. Test-infra note

happy-dom 20.9.0 MutationObserver stores its delivery callback as a bare WeakRef
(`MutationObserverListener.js:29`) → GC can silently kill observers mid-test.
`offCanvasIndicatorRefresh.test.tsx` pins WeakRef→StrongRef for this reason
(commit 55b194271). Any future MutationObserver-dependent test needs the same
guard until happy-dom is upgraded past the bug.
