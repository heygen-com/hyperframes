---
title: "feat: Visual keyframe property editing — write path for all GSAP properties"
status: active
date: 2026-06-04
type: feat
branch: feat/keyframe-property-inspector
---

## Summary

Make every GSAP property editable from the Studio design panel. When a user changes any value (Z, Scale, RotX, RotY, opacity, borderRadius, x, y, width, height, rotation, filter, clipPath), the system commits a keyframe at the current playhead position. If no animation exists on the element, one is created automatically. No HTML editing required.

## Problem Frame

The read path is complete — the design panel shows GSAP-interpolated values from the runtime at the current seek time. But the write path only works for x/y (via drag), width/height (via resize), and rotation (via handle). The 3D Transform fields (Z, Scale, RotX, RotY), opacity, borderRadius, and all other properties in the animation card are display-only. Users must edit HTML to change these values, which defeats the purpose of a visual editor.

---

## Requirements

- R1. Editing any numeric GSAP property (Z, Scale, RotX, RotY, opacity, borderRadius, fontSize, letterSpacing, skewX, skewY) in the design panel commits a keyframe at the current playhead percentage.
- R2. Editing any string GSAP property (filter, clipPath, borderRadius as string) in the animation card commits the value to the current keyframe or flat tween.
- R3. If the element has no GSAP animation, editing any animatable value auto-creates a `tl.to()` tween with percentage keyframes containing the new value.
- R4. If the element has a flat tween (no keyframes), editing a value first converts to keyframes format, then commits.
- R5. The design panel shows interpolated values for ALL animated properties at the current seek time — not just the 5 layout fields.
- R6. All property edits support undo/redo through the existing edit history system.
- R7. The keyframe cache updates immediately after each edit — diamonds on the timeline reflect the change without requiring a page refresh.

---

## Key Technical Decisions

KTD1. **Unified commit pattern**: All property edits flow through a single `commitAnimatedProperty(elementId, property, value)` helper that handles the three cases: (a) animation with keyframes → `add-keyframe`, (b) flat animation → `convert-to-keyframes` then `add-keyframe`, (c) no animation → `addGsapAnimation` then `convert-to-keyframes` then `add-keyframe`. This avoids duplicating the three-case logic across every field's onCommit handler.

KTD2. **Auto-create uses `tl.to()` with `ease: "none"`**: When creating an animation from scratch, the default is `tl.to("#element", { keyframes: { "0%": { ...currentCssValues }, "100%": { ...currentCssValues, [prop]: newValue } }, duration: elementDuration, ease: "none" }, elementStart)`. This gives immediate visual feedback — the property interpolates from CSS defaults to the new value over the element's duration.

KTD3. **3D fields commit via the same keyframe pipeline as 2D fields**: No separate "3D mode" — Z, RotX, RotY, Scale use the same `commitAnimatedProperty` as X, Y, W, H, R. The only difference is the GSAP property name passed to the mutation.

KTD4. **String properties commit via `update-property` for flat tweens and `update-keyframe` for keyframed tweens**: String values (filter, clipPath, complex borderRadius) can't be scrubbed or interpolated in the design panel — they use text input with commit-on-blur. The mutation path is the same as numeric properties.

KTD5. **`readAllAnimatedProperties` includes all properties in backfill**: When committing a keyframe for one property, the commit reads ALL currently animated properties from the runtime and includes them in the keyframe. This prevents other properties from jumping to CSS defaults between keyframes (the backfill pattern already implemented for resize).

---

## Implementation Units

### U1. Extract `commitAnimatedProperty` helper

**Goal:** Create a single function that handles the three-case property commit logic, reusable by all design panel fields.

**Requirements:** R1, R3, R4, R6, R7

**Dependencies:** None

**Files:**
- Create: `packages/studio/src/hooks/useAnimatedPropertyCommit.ts`
- Modify: `packages/studio/src/hooks/useDomEditSession.ts` (expose the helper via context)
- Modify: `packages/studio/src/contexts/DomEditContext.tsx` (add to context)

**Approach:**
- The helper receives `(selection, property, value, options?)` and:
  1. Checks if the element has a GSAP animation via `selectedGsapAnimations`
  2. If no animation: calls `addGsapAnimation("to")`, waits for reload, then proceeds
  3. If flat animation (no keyframes): calls `convertToKeyframes`, then proceeds
  4. Reads all animated properties from runtime via `readAllAnimatedProperties`
  5. Adds the new property value to the properties object
  6. Calls `add-keyframe` mutation with backfillDefaults
- Returns a promise that resolves after the mutation completes
- Handles the `gsapCommitMutation` null check (returns early if not available)

**Patterns to follow:** The existing `tryGsapResizeIntercept` in `gsapRuntimeBridge.ts` implements the same three-case logic for width/height. Extract and generalize that pattern.

**Test scenarios:**
- Element with keyframed animation: editing Z commits keyframe at current percentage with Z value + all other animated properties
- Element with flat tween: editing Z first converts to keyframes, then adds keyframe
- Element with no animation: editing Z creates new `tl.to()` animation, converts to keyframes, adds keyframe
- After commit: keyframe cache updates, diamond appears on timeline
- Undo after commit: reverts to previous state

**Verification:** All three paths produce correct keyframe entries in the source HTML. The keyframe cache updates after each mutation.

---

### U2. Wire 3D Transform fields to commit pipeline

**Goal:** Make Z, Scale, RotX, RotY fields in the design panel editable — editing commits a keyframe.

**Requirements:** R1, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/studio/src/components/editor/PropertyPanel.tsx` (wire onCommit handlers)
- Modify: `packages/studio/src/components/StudioRightPanel.tsx` (pass new handler prop)

**Approach:**
- Replace the current inline onCommit handlers for Z/Scale/RotX/RotY (which only call `onAddKeyframe` and fail silently when no animation exists) with calls to `commitAnimatedProperty`
- Add `onCommitAnimatedProperty` prop to PropertyPanel, passed from StudioRightPanel via DomEditContext
- Each 3D field's onCommit: `commitAnimatedProperty(element, "z", parsedValue)`
- The MetricField scrub behavior provides immediate visual feedback via the existing preview soft-reload path

**Patterns to follow:** The existing `commitManualOffset` handler in PropertyPanel already does keyframe-aware commits for X/Y — match that pattern for 3D fields.

**Test scenarios:**
- Edit Z field: value commits as keyframe, preview updates, diamond appears
- Edit Scale field: same behavior
- Edit RotX/RotY: same behavior
- Scrub a 3D field: live preview updates via soft reload
- Edit Z on element with no animation: auto-creates animation, then commits

**Verification:** Scrubbing the timeline after editing a 3D field shows the interpolated value change in the design panel.

---

### U3. Wire animation card property rows to commit pipeline

**Goal:** Make numeric property rows in the AnimationCard editable via the same keyframe commit pipeline.

**Requirements:** R1, R2, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/studio/src/components/editor/AnimationCard.tsx` (wire PropertyRow onCommit to keyframe-aware handler)
- Modify: `packages/studio/src/components/editor/PropertyPanel.tsx` (pass handler through)

**Approach:**
- Currently, PropertyRow's `commitProperty` calls `onUpdateGsapProperty` which updates the flat tween's endpoint value. For keyframed animations, this should instead commit a keyframe at the current percentage.
- When the animation has keyframes: `commitProperty` → `commitAnimatedProperty(element, prop, value)` (adds keyframe)
- When the animation is flat: `commitProperty` → `onUpdateGsapProperty` (existing behavior, updates tween endpoint)
- The PropertyRow already handles numeric vs string distinction — this change only affects where the commit goes for keyframed animations

**Patterns to follow:** The existing `commitProperty` function in AnimationCard (line 286-293).

**Test scenarios:**
- Edit opacity in animation card on keyframed animation: commits keyframe at current time with opacity + all other properties
- Edit opacity on flat animation: updates tween endpoint (existing behavior)
- Add new property via "+ Effect" then edit value: commits correctly
- String property (filter): text input commit-on-blur updates the keyframe or tween

**Verification:** Editing a property value in the animation card at different seek times produces different keyframes visible as diamonds.

---

### U4. Auto-create animation on any property edit

**Goal:** When editing any animatable value on an element with no GSAP animation, automatically create one.

**Requirements:** R3

**Dependencies:** U1

**Files:**
- Modify: `packages/studio/src/hooks/useAnimatedPropertyCommit.ts` (auto-create logic)
- Modify: `packages/studio/src/hooks/useGsapScriptCommits.ts` (ensure `addGsapAnimation` returns the new animation ID)

**Approach:**
- In `commitAnimatedProperty`, when `selectedGsapAnimations.length === 0`:
  1. Call `addGsapAnimation("to")` — this creates `tl.to("#element", { x: 0, y: 0, opacity: 1, duration: D, ease: "power2.out" }, start)`
  2. Wait for the preview to reload (the mutation triggers a reload)
  3. After reload, the tween cache will find the new animation
  4. Call `convertToKeyframes` on the new animation
  5. After reload, add the keyframe with the user's value
- This is a 3-step async sequence. To avoid visible flicker, batch the mutations: `addGsapAnimation` + `convertToKeyframes` with `skipReload: true`, then the final `add-keyframe` with `softReload: true`
- The `addGsapAnimation` function already handles ensuring the element has an ID (`ensureElementAddressable`)

**Patterns to follow:** The existing `handleGsapAddAnimation("to")` in `useDomEditSession.ts` creates animations from scratch for the toolbar diamond button.

**Test scenarios:**
- Select a plain `<div>` with no GSAP animation, edit Z in design panel: animation created, keyframe added, diamond appears
- The auto-created animation uses the element's `data-duration` if present, falls back to composition duration
- The auto-created animation's `data-start` matches the element's position
- Undo reverts the entire creation (animation + keyframe)
- The runtime auto-discovers the new animation (auto-inject `data-track-index`)

**Verification:** A completely plain HTML element can be animated entirely from the design panel — no code editing required.

---

### U5. Show all animated properties in design panel

**Goal:** Display interpolated values for ALL animated properties (not just the 5 layout fields + 4 3D fields) in the design panel.

**Requirements:** R5

**Dependencies:** U2, U3

**Files:**
- Modify: `packages/studio/src/components/editor/PropertyPanel.tsx` (add dynamic property display)

**Approach:**
- The `gsapRuntimeValues` IIFE already reads ALL animated properties from the runtime. Currently only X/Y/W/H/R and Z/Scale/RotX/RotY are displayed.
- Add a "Animated Properties" section below 3D Transform that shows any remaining animated properties not already covered by the Layout or 3D sections (opacity, borderRadius, skewX, skewY, fontSize, etc.)
- Each property renders as a MetricField (for numbers) or text display (for strings) with a keyframe navigation control
- This section is hidden when there are no additional animated properties

**Patterns to follow:** The existing Layout section's MetricField + KeyframeNavigation pattern.

**Test scenarios:**
- Element with opacity keyframes: opacity value shows in "Animated Properties" section, updates when scrubbing
- Element with borderRadius string animation: borderRadius displays as text, updates when scrubbing
- Element with only x/y: no "Animated Properties" section shown (covered by Layout)
- Element with no animation: no section shown

**Verification:** Scrubbing the timeline on an element with opacity, borderRadius, or filter keyframes shows the interpolated values updating in real-time in the design panel.

---

## Scope Boundaries

### In Scope
- Write path for all numeric GSAP properties via design panel
- Write path for string properties via animation card text inputs
- Auto-create animation from scratch when editing any property
- Keyframe cache immediate update after edits
- Undo/redo support for all edits

### Deferred to Follow-Up Work
- 3D container setup (perspective, transform-style) via UI — users still set these in HTML
- Per-keyframe easing UI — currently only tween-level ease can be set
- Bezier curve editor for custom easing
- Drag handles for 3D properties in the preview viewport
- Creating `from()` or `fromTo()` tweens from the UI (auto-create always uses `to()`)

### Out of Scope
- Runtime adapter changes — all work is in the studio layer
- Parser changes beyond what's already shipped
- GSAP plugin integration (MorphSVG etc.) from the UI

---

## Open Questions

- Q1. (Deferred to implementation) The 3-step auto-create sequence (add → convert → add-keyframe) may cause visible flicker if not batched correctly. The `skipReload` option should prevent intermediate reloads, but this needs verification during implementation.
- Q2. (Deferred to implementation) When auto-creating an animation, the default properties (`x: 0, y: 0, opacity: 1`) may not be the right defaults for every element. The implementer should read CSS computed values from the iframe and use those as the 0% keyframe values.

---

## Sources & Research

- Existing codebase patterns: `tryGsapResizeIntercept` in `gsapRuntimeBridge.ts` implements the three-case commit logic for width/height
- `commitManualOffset` in `PropertyPanel.tsx` shows the keyframe-aware commit pattern for 2D fields
- `addGsapAnimation` in `useGsapScriptCommits.ts` handles animation creation from scratch
- `readAllAnimatedProperties` in `gsapRuntimeBridge.ts` reads all animated props for backfill
