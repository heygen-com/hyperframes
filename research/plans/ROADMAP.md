# CapCut-Quality Studio Editing — Master Roadmap

> Three sequential implementation plans, derived from
> [research/STUDIO_ARCHITECTURE_AND_DND.md](../STUDIO_ARCHITECTURE_AND_DND.md).
> Each plan ships working, testable software on its own. Plans 2 and 3 get fully
> detailed when their turn comes, informed by what shipping the previous plan taught us.
> Gap ids (G-n) refer to §11 of the research doc.

## Plan 1 — Timeline Drop Experience (DETAILED: `2026-07-07-timeline-dnd-experience.md`)

The core "CapCut feel" for getting media onto the timeline. Ships directly, no feature flags.

- Unified timeline snapping (playhead + clip edges + beats) with a magnet toggle — G-2
- Snapping applied to existing clip move/trim, not just drops — G-2
- Drag-over drop preview: ghost clip, target-row highlight, new-track row, snap guide — G-1
- Block cards become draggable (both existing drop targets light up) — G-6
- Snapped, collision-aware drop placement (never reject; bump to nearest free track) — G-4
- Production markup on insert: `data-hf-id`, `data-volume`, centered fitted geometry — G-8, G-9, G-10
- "Add at playhead" from asset cards — G-3
- Global OS file drop = import **and** place at playhead — G-5
- Edge auto-scroll + cleanup during external drags — G-18

## Plan 2 — Canvas Editing Parity (to be detailed after Plan 1 ships)

- Drop files/assets onto the preview canvas → overlay starting at playhead, centered at the
  drop point (generalize `usePreviewBlockDrop`; reuse Plan 1's insert pipeline) — G-7
- 8-handle resize box on canvas selection (port the captions overlay's corner-handle pattern
  from `captions/components/CaptionOverlay.tsx`), aspect-lock — G-19
- Audio waveforms on timeline clips from the existing `GET …/waveform/*` endpoint — G-12
- Alignment/distribute actions for multi-selection; bring-to-front/back on canvas — G-19
- Optimistic insertion via in-iframe `__player.addElement()` with background source write
  (kills the drop→full-reload lag; flag-gated, riskiest item in this plan) — G-16

## Plan 3 — Track Model & Structural (to be detailed after Plan 2)

- Lightweight persisted track metadata (name/kind/locked/muted per track index) — G-13
- Audio-routes-below / video-above placement rules; per-track drop semantics
- Magnetic main track (CapCut's Main Track Magnet: insert-and-ripple, gap closing) — flag-gated
- Multi-select clips + multi-clip drag (revive the dead `selectedElementIds` store state) — G-14
- Sub-composition-targeted inserts while drilled in — G-11
- Timeline virtualization if project sizes demand it — G-15

## Non-goals (all plans)

- No rebuild of the timeline rendering (DOM/CSS approach stays)
- No migration of internal sidebar drags off HTML5 DnD yet (works; revisit only if ghost
  styling limits bite after Plan 1)
- No stock-media search integration (separate product decision) — G-20
