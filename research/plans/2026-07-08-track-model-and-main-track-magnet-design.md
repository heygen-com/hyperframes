# Design — Standardized Track Model + Main-Track Magnet (R2 Piece 4 / Piece 3 track model)

> User asked to standardize the timeline's track structure CapCut-style (overlays
> above, main video in the middle, audio below) as the foundation for the
> main-track magnet (no-overlap + ripple). This folds the deferred Piece-3 track
> model INTO Piece 4. Analysis done 2026-07-08 (Explore agent, file:line-verified).
> **This design needs a user decision (§4) before build; it is a large, staged
> effort recommended as its own focused pass.**

## 1. The element taxonomy that lands on the timeline (what exists)

From `packages/core/src/runtime/timeline.ts` (kind assignment) + `packages/studio/
src/player/lib/timelineDOM.ts` (parse) + `utils/timelineInspector.ts`:

| Kind (`tag`/`kind`)                                 | How detected                                                                                     | CapCut zone it maps to              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `video`                                             | `<video>` / manifest `kind:"video"`                                                              | **main** (primary) or overlay       |
| `img`                                               | `<img>` / `kind:"image"`                                                                         | overlay (above main)                |
| `div`/`element` (text, graphics, effects, stickers) | default non-media                                                                                | overlay (above main)                |
| `audio` (music / VO / SFX)                          | `<audio>` or audio src ext; `isMusicTrack()` splits music via `timelineRole="music"` or id regex | **audio** (below main)              |
| `composition` (sub-comp, incl. captions)            | `data-composition-id` ≠ root; `compositionSrc`                                                   | overlay, or its own lane (captions) |
| role `overlay`/`persistent-overlay`                 | `data-timeline-role`                                                                             | full-duration overlay               |

Doesn't fit cleanly: **captions** (a sub-comp whose word edits live in JS, no native
caption lane), **effects/filters** (CSS/GSAP on elements, not surfaced as clips),
**text vs sticker vs generic div** (all just `element` — indistinguishable).

## 2. Current track behavior

- `track` (`data-track-index`) is **display-only, honored verbatim**; producer/engine
  never read it (`timeline.ts:568-573`). Track order = indices sorted **ascending**,
  **track 0 at top** (`Timeline.tsx:189-207`). Drops default to the hovered row (or
  `track:0`).
- **No "main track" concept.** No kind-based grouping in rendering.

## 3. The removed precedent (load-bearing context)

`normalizeTrackAssignments` (removed in `904adea0`) did _exactly_ kind-based zoning
with `KIND_ORDER = {composition:0, video:1, image:2, element:3, audio:4}`, splitting
mixed-kind tracks apart on reload. **Removed because it overrode authored placement**
— dropping on track 5 could silently persist as track 7, breaking "drop where I
point." Re-standardizing means re-introducing this trade-off deliberately.

## 4. THE DECISION (needed before build)

How strongly should the track model enforce CapCut zones?

- **A. Advisory (recommended):** New _drops_ auto-route by kind into the right zone
  (video→main, img/text→overlay above, audio→below), but once placed, a clip stays
  where the user puts it — no reload-time renormalization. Keeps placement freedom
  (respects the `904adea0` fix); CapCut-like on the happy path.
- **B. Enforced zones:** Re-introduce reload-time normalization so kinds are always
  segregated into zones (audio always below main, etc.), overriding authored index.
  Most CapCut-faithful; re-opens the exact problem `904adea0` fixed.
- **C. Enforced main track only:** Only the _main_ track is special (one designated
  video track, no-overlap + ripple); all other tracks stay free/authored-verbatim.
  Smallest model that still delivers the "magnet."

## 5. Proposed model (assuming A — advisory zones + magnetic main)

- **Track metadata** (lightweight, persisted — the deferred Piece-3 model): a per-track
  `kind: "main" | "overlay" | "audio"` inferred from its clips (+ overrideable later).
  Vertical order top→bottom: **overlays → main → audio** (assign index ranges so
  ascending index = this order; main is a single designated video track).
- **Which track is main:** the base video track (lowest video track index). New video
  drops target it unless dropped onto an overlay lane.
- **Drop routing:** video→main (or overlay if aimed above); img/text/div→overlay zone
  (above main); audio→audio zone (below main). Uses the existing collision-push +
  insert (2a/2c) within the target zone.
- **Main-track magnet (Piece 4 proper), staged:**
  - **4a no-overlap:** the main track rejects overlaps — a dropped/moved clip snaps
    flush to the neighbor edge instead of stacking.
  - **4b gap-close (ripple):** deleting/moving a main clip shifts _following_ main
    clips left to close the gap.
  - **4c insert-and-ripple:** dropping into the middle of the main track pushes
    following main clips right.
  - 4b/4c require **multi-clip horizontal persist** — shifting many clips' `data-start`
    **and** their GSAP tween positions (`shiftGsapPositions`), the riskiest persist in
    the effort (start-time changes affect rendering, unlike 2c's display-only track
    reindex). Reuse per-clip `handleTimelineElementMove` first; batch later.

## 6. Why this is its own focused effort (recommendation)

This is Piece-3 (track model + persisted meta) **and** Piece-4 (magnet + ripple)
combined — a large, semantics-changing build with the riskiest persist yet, on top of
an already-42-commit unpushed branch. Recommend: **push a checkpoint PR of the current
work first**, then build this model in stages (track-kind inference + drop routing →
4a → 4b → 4c), each verified live. Not a tail-of-session build.

## 7. Open questions for the user

1. Which enforcement level — **A / B / C** (§4)?
2. Confirm the vertical order: overlays top, main middle, audio bottom (ascending index)?
3. Captions lane: leave captions as today (sub-comp footer), or give them a dedicated
   bottom lane in the model? (Recommend: leave as-is this pass.)
