# Design — Free-form timeline model (drop the magnetic main track)

> Branch `research/studio-dnd-architecture`. Phase 1 of the DnD rework.
> Supersedes the Piece-4 "enforced zones + auto main-track magnet" approach.
> Date: 2026-07-09. Decision made with the user after evidence review.

## Why (evidence)

A survey of 20+ real HyperFrames compositions (registry blocks, examples, user
projects) found HyperFrames content is **~80% a temporal sequence of scenes +
1–5 audio tracks + ~20% z-index-layered overlays**. Key facts:

- Sequences are authored by placing scenes on **separate lanes offset in time**
  (scene1 lane1, scene2 lane2…), NOT by collapsing onto one gapless lane.
- `data-track-index` is sparse **logical grouping** (visuals 1–5, audio 10+),
  editor-only — the renderer ignores it; layering is CSS `z-index` + DOM order.
- The auto-detected magnetic "main track" **fights** this authored structure and
  was the root of the field-test friction (surprise magnetism, videos that
  couldn't share a lane, "which track is main?").

**Decision:** remove the magnetic main track entirely (no auto, no opt-in — no
real use case for HyperFrames). Timeline vertical = free organization + a
kind-based visual/audio zone split. Horizontal = time (the only "real" axis).

## The model

- **Two zones by element KIND (not a magic track number):**
  - **Visual zone** (top): video / image / text / shape / sub-composition. Free lanes.
  - **Audio zone** (bottom): `<audio>` / `data-timeline-role` music·vo·sfx. Visually
    distinct (waveform + accent color).
- **Free placement.** A clip lands on the hovered lane at the hovered time.
  Overlaps allowed in the visual zone (layered overlays are real content). Lane =
  organization; it persists (`data-track-index`) but never rewrites the render.
- **Snapping stays a toggle** (existing S button): edges snap to playhead / clip
  edges / beats. The alignment aid.
- **No magnet / no ripple / no forced re-zoning.** Deleted.

## What changes (concrete)

1. **Zone rendering by kind.** Timeline lane layout groups visual lanes (top) and
   audio lanes (bottom) using element kind (`isAudioTimelineElement` /
   `data-timeline-role`), replacing `resolveMainOriginTrack`-based zoning. Audio
   lanes get distinct styling (waveform emphasis + accent).
2. **Stop force-rezoning.** Remove the main-track branch of `normalizeToZones`
   (or reduce it to the kind-based visual-above-audio ordering only, keeping
   authored track order within each zone). Preserve authored `data-track-index`.
3. **Free placement in the drag preview.** Remove the collision-push
   (`resolvePlacement` bump-to-nearest-free-lane) so a clip lands on the hovered
   lane even over an existing clip (overlap allowed). Snapping still applies when
   the snap toggle is on. → fixes "can't put two on the same track."
4. **Suppress the new-track insert line in the audio zone** (and below the last
   audio lane) — inserting a *visual* track only makes sense in the visual zone.
   → fixes the phantom insertion line under the bottom.
5. **Remove the magnet path.** Delete `reflowMainTrack`, the main-track branch in
   `commitDraggedClipMove`, and `resolveMainOriginTrack`'s use there. A plain move
   is single-clip (existing SDK-aware handler). Track-insert still uses the atomic
   batched persist (multiple lanes shift → one write).
6. **Keep** the atomic batched persist (`handleTimelineElementsMove`,
   `shift-positions-batch`) — it's the no-corruption guarantee for any multi-clip
   write (track-insert today; align/distribute later).

## Primary goal: smooth drag-and-drop

Everything above serves the north star — **dragging/dropping any asset (video,
image, audio, sfx, music, caption, sub-comp) and manipulating clips must feel
smooth and predictable.** Concretely verify smooth, correct behavior for:

- Sidebar asset → timeline (ghost follows, clear drop indicator, lands as shown).
- Sidebar asset → canvas.
- OS file → timeline / canvas.
- Move a clip in time and between lanes (no bump, lands where dropped).
- Drop onto an occupied lane (overlap allowed, or snaps if snap on).
- Selection stays correct through drag start/end.
- No jank: ghost/placeholder/auto-scroll are rAF-smooth.

## Resolves (field-test feedback)

| Feedback | Fix |
|---|---|
| Snap off but magnet still fired | Magnet removed entirely. |
| Couldn't put two videos on one track | Free placement (collision-push removed). |
| Insert line appears under the main track | Suppressed in the audio zone. |
| Audio/bgm/sfx should look different | Kind-based audio zone styling. |
| "Which is main / do we need it?" | No main track. Removed. |

## Non-goals

Canvas parity (8-handle resize, frame highlight) — later phase. Align/distribute,
multi-select drag — later. This phase = the free-form model + drag-drop smoothness.
