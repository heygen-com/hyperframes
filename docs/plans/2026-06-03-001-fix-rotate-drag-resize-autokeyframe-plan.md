---
title: "fix: rotation-aware drag + auto-keyframing for resize and rotation"
status: active
date: 2026-06-03
type: fix
depth: standard
---

# fix: rotation-aware drag + auto-keyframing for resize and rotation

## Summary

Fix two auto-keyframing gaps: CSS rotation corrupts the drag offset matrix (elements drift from cursor), and resize/rotate handle changes don't create keyframes (only position drag does). Also documents competitive findings from HyperMotion audit.

---

## Problem Frame

The drag offset probe in `measureManualOffsetDragScreenToOffsetMatrix` measures how changing `translate` affects screen position. But `stripGsapTranslateFromTransform` subtracts the offset from the transform matrix's m41/m42 entries without accounting for rotation — the offset is in pre-rotation space while m41/m42 are post-rotation. This poisons the probe measurements, making the element drift from the cursor.

Separately, auto-keyframing only fires for position (via `handleGsapAwarePathOffsetCommit`). Resize and rotation commits go directly to the CSS patch path with no GSAP intercept, so handle changes never create keyframes.

---

## Requirements

- R1. Dragging a rotated element must track the cursor accurately regardless of rotation angle
- R2. Resizing via bounding box handles must create keyframes when the element has keyframed GSAP animations
- R3. Rotating via the rotation handle must create keyframes when the element has keyframed GSAP animations
- R4. Non-GSAP elements must continue to use the CSS path for resize and rotation (no regression)

---

## Key Technical Decisions

KTD1. **Rotation-aware strip: rotate the offset vector before subtracting.** Extract the rotation angle from the DOMMatrix itself (via `Math.atan2(m.b, m.a)`) rather than parsing CSS rotation values. This is more reliable because it captures the actual rendered rotation regardless of how it was set (CSS `rotate`, `transform`, GSAP).

KTD2. **Resize auto-keyframing targets GSAP `width`/`height` properties**, not `scaleX`/`scaleY`. The studio resize handles change pixel dimensions, which maps directly to GSAP `width`/`height`. If the animation uses `scale` instead, the intercept falls back to CSS (same safe-default pattern as position).

KTD3. **Rotation auto-keyframing targets GSAP `rotation` property.** Read from `gsap.getProperty(el, "rotation")` and compute `newRotation = gsapRotation + deltaAngle`.

KTD4. **Same async pipeline pattern for all three property types.** Resize and rotation intercepts use the same `beforeReload` + `skipReload` + `await` pattern from the position bridge to prevent snap-back.

---

## Implementation Units

### U1. Fix rotation-aware strip in `stripGsapTranslateFromTransform`

**Goal:** Make the transform matrix strip account for CSS rotation so the drag probe produces accurate measurements.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `packages/studio/src/components/editor/manualEditsDom.ts`

**Approach:** In `stripGsapTranslateFromTransform`, before subtracting the offset from m41/m42, extract the rotation angle from the matrix via `Math.atan2(m.b, m.a)`. Rotate the offset vector (offsetX, offsetY) by this angle to get the screen-space contribution, then subtract the rotated vector from m41/m42.

**Patterns to follow:** The existing `stripGsapTranslateFromTransform` structure — read offset from custom properties, modify matrix, write back.

**Test scenarios:**
- Element with no rotation: drag tracks cursor normally (regression check)
- Element rotated 45°: drag tracks cursor without drift
- Element rotated 90°: drag X movement moves element vertically on screen (correct for 90° rotation)
- Element rotated 180°: drag works in reverse directions
- Element with rotation + GSAP transform (e.g., at 50% of a rotation tween): drag still tracks

**Verification:** Drag a rotated element in the preview — the element follows the cursor exactly, with the bounding box overlay aligned.

---

### U2. Add GSAP-aware resize intercept

**Goal:** When resizing a GSAP-animated element via bounding box handles, create width/height keyframes instead of CSS patches.

**Requirements:** R2, R4

**Dependencies:** None

**Files:**
- Modify: `packages/studio/src/hooks/gsapRuntimeBridge.ts`
- Modify: `packages/studio/src/hooks/useDomEditSession.ts`
- Modify: `packages/studio/src/hooks/useDomEditCommits.ts`

**Approach:** Add `tryGsapResizeIntercept` to the runtime bridge — mirrors `tryGsapDragIntercept` but looks for animations with `width`/`height` properties. Reads current values via `gsap.getProperty(el, "width"/"height")`, computes new values, commits via `add-keyframe` at current percentage. Create `handleGsapAwareBoxSizeCommit` wrapper in `useDomEditSession` following the position wrapper pattern. Add `isElementGsapTargeted` guard to `handleDomBoxSizeCommit`.

**Patterns to follow:** `handleGsapAwarePathOffsetCommit` in `useDomEditSession.ts`, `tryGsapDragIntercept` in `gsapRuntimeBridge.ts`.

**Test scenarios:**
- Non-GSAP element: resize persists via CSS (existing behavior)
- GSAP element with width/height tween: resize creates keyframe at current percentage
- GSAP element without width/height: resize falls through to CSS path
- Resize at t=0 vs t=50%: keyframe percentage matches playhead
- Undo after resize keyframe: reverts correctly

**Verification:** Resize a GSAP-animated element → keyframe diamond appears on timeline at the resize time.

---

### U3. Add GSAP-aware rotation intercept

**Goal:** When rotating a GSAP-animated element via the rotation handle, create rotation keyframes instead of CSS patches.

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Modify: `packages/studio/src/hooks/gsapRuntimeBridge.ts`
- Modify: `packages/studio/src/hooks/useDomEditSession.ts`
- Modify: `packages/studio/src/hooks/useDomEditCommits.ts`

**Approach:** Add `tryGsapRotationIntercept` to the runtime bridge — looks for animations with `rotation` property. Reads `gsap.getProperty(el, "rotation")`, computes `newRotation = gsapRotation + studioAngle`, commits via `add-keyframe`. Create `handleGsapAwareRotationCommit` wrapper. Add `isElementGsapTargeted` guard to `handleDomRotationCommit`.

**Patterns to follow:** Same as U2, substituting rotation for width/height.

**Test scenarios:**
- Non-GSAP element: rotation persists via CSS (existing behavior)
- GSAP element with rotation tween: rotation creates keyframe
- Rotation at various percentages: keyframe placed at correct %
- Combined rotation + drag: both produce separate keyframes

**Verification:** Rotate a GSAP-animated element → keyframe diamond appears on timeline.

---

## Scope Boundaries

### In scope
- Rotation-aware transform strip fix
- GSAP-aware resize and rotation intercepts
- CSS path guards for GSAP elements on all three property types

### Deferred to Follow-Up Work
- HyperMotion-inspired features: record-mode toggle, marquee multi-select, batch drag, named chapters, preset-origin tagging, strength slider on easing, bezier graph editor
- GSAP `scale`/`scaleX`/`scaleY` auto-keyframing via resize handles (currently only pixel `width`/`height`)
- Live interpolated values in the design panel inspector (HyperMotion's `useAnimatedValues` pattern)
- 10ms epsilon dedup on keyframe add

---

## Sources & Research

### HyperMotion Competitive Audit

HyperMotion (github.com/psiddharthdesign/hypermotion) is a 3-week-old Electron+React+PixiJS motion design tool. Not GSAP-based — owns its full render pipeline. Key differences:

| Feature | HyperFrames | HyperMotion | Winner |
|---------|-------------|-------------|--------|
| Engine | GSAP in browser, HTML/CSS source | Custom PixiJS, no GSAP | Different targets |
| Spring physics | Real damped oscillator solver | Stubbed (falls back to ease-out) | **HF** |
| Easing levels | 3 (tween, easeEach, per-kf) | Bezier graph editor + strength slider | Tie (different strengths) |
| Auto-keyframe | Drag-based (this PR adds resize/rotation) | Record-mode toggle (AE semantics) | **HM** (more explicit) |
| clip-path/filter | Supported | Not supported | **HF** |
| Multi-select | Shift-click on diamonds | Marquee + Cmd-click + range | **HM** |
| File format | HTML (human-readable, agentable) | .hype (Yjs CRDT binary) | **HF** (openness) |
| Collaboration | None | Yjs CRDT backbone (future) | **HM** (planned) |
| Export | MP4/WebM via headless Chrome | MP4/WebM/GIF/Lottie | **HM** (more formats) |
| Chapters | None | Named chapters + isolated playback | **HM** |
| Agent integration | Native (skills, CLI, MCP) | MCP server | Tie |

**Features worth adopting (prioritized):**
1. Record-mode toggle for explicit auto-keyframe control
2. Epsilon dedup on keyframe add (10ms tolerance)
3. Marquee multi-select on timeline diamonds
4. Strength slider abstraction over easing presets
5. Live interpolated values in the inspector panel
