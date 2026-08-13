# Automation lane time selection — design

2026-08-05 · builds on stack #3027 (wa-1 … wa-14) · status: approved, awaiting implementation plan

## Context

Audio automation lanes (breakpoint envelopes over `data-automation`) ship point-level
editing: add, drag, curve, snap, type a value, delete one point. Everything range-shaped —
"fade the music here", "duck this under the voiceover", "reuse that swell" — still means
placing points one at a time. Ableton's envelope editor solves this with a time selection;
this design ports the useful subset for video authors. Explicitly not a DAW: no musical
LFO features, no automation recording, no unlinked/looped envelopes.

## Goals

- Select a time range on one lane by dragging its background.
- Delete the points in a range without disturbing the envelope outside it.
- Insert simple shapes (ramp up, ramp down, swell, dip) into a range in one action.
- Copy a range and paste it elsewhere — other time, other lane, other parameter.
- Retime a range by dragging its edges.
- Thin dense point runs (Simplify).

## Non-goals

- Multi-lane or multi-clip selection. One selection, one lane.
- Vertical scaling and skew of a selection.
- Draw mode, automation recording, ADSR/waveform shapes (saw, square).
- Persisting the selection. It is view state, never serialized.

## Model

New store slice `automationSelectionSlice.ts` (own file — `playerStore.ts` sits at the
600-line ceiling; `keyframeSlice.ts` is the precedent):

```ts
interface AutomationSelection {
  elementKey: string; // which clip
  target: string; // which lane ("volume" | "fx.<nodeId>.<param>")
  t0: number; // clip-local seconds
  t1: number; // > t0
}
// automationSelection: AutomationSelection | null
// setAutomationSelection(sel), clearAutomationSelection()
```

Why a slice and not lane-local state: Delete/Cmd+C/V handlers and the shape context menu
live outside the lane component and need to read the active selection —
`useKeyframeKeyboard` already solved this exact problem by going through the store.

Lifecycle: cleared on Escape, on a sub-threshold click in any lane, and automatically when
the element or target it names stops resolving (clip deleted, effect removed). The lane
receives it through `bind()` in `useAutomationLanes` like every other prop.

## Gesture

A plain drag on the lane background range-selects. This surface is free: today a
pointerdown that misses every point and has no Alt falls through and does nothing.

- Pointerdown (no point hit, no Alt): arm at `t`, capture the pointer.
- Move past ~3 px horizontally: live-update the selection (`t0`/`t1` ordered, clamped to
  `[0, duration]`). Endpoints snap to the same beat-grid + neighbour-point targets a point
  drag uses; Alt bypasses, matching the point-drag convention.
- Pointerup under the threshold: clear the selection (it was a click, not a drag).

Renders as a translucent accent rect behind the envelope path with faint vertical edges.
Existing gestures unchanged: point hits win over range-drag; Alt on the line still curves.
Implemented as a third gesture kind in `useAutomationLaneGestures` beside point-drag and
curve-drag.

## Range ops

Pure module `automationLaneSelection.ts` (studio, not core — the render never needs any of
this; core keeps only the envelope model it already has):

```ts
pointsIn(lane, t0, t1): HfAutomationPoint[]
replaceRange(lane, range, t0, t1, inner: HfAutomationPoint[]): HfAutomationLane
```

`replaceRange` is the only mutator, and carries THE invariant: **the envelope outside the
selection never moves.** It samples the lane at `t0` and `t1` first (`sampleAutomationLane`,
log-aware) and pins anchor points at both edges, drops the old interior, inserts `inner`,
sorts, and runs the existing normalize path (dedupe, `MAX_AUTOMATION_POINTS` 512 cap).
Every feature below composes it, and every write flows through the lane's existing
`commitPoints` preview/persist split — undo, drafts, and the quiet-commit path are
inherited, not rebuilt.

## Features

### Delete range (wa-15)

`replaceRange(..., [])` on Delete/Backspace via a new `useAutomationSelectionKeyboard`
hook (sibling of `useKeyframeKeyboard`), inert while the value input or any text field has
focus. Escape clears the selection.

### Shapes (wa-16)

Right-click the selection rect → context menu: **Ramp up · Ramp down · Swell · Dip**, plus
**Simplify**. Pure generators in `automationShapes.ts`, one shape scaled to the selection,
values computed in unit space so log knobs behave:

| Shape     | Points | Semantics                                                                      |
| --------- | ------ | ------------------------------------------------------------------------------ |
| Ramp up   | 2      | `range.min` at `t0` → envelope's own value at `t1` (fade in)                   |
| Ramp down | 2      | envelope's own value at `t0` → `range.min` at `t1` (fade out)                  |
| Swell     | 3      | edge values, peak at `range.max` at the midpoint, `curve`-smoothed             |
| Dip       | 3      | edge values, midpoint at 25 % of the edge value in unit space (duck), smoothed |

Point counts are tiny; the 512 cap is never approached.

### Copy/paste (wa-17)

Module-level clipboard `{ sourceRange: AutomationRange, span: number, points }`, times
rebased to `t0`. Not the OS clipboard — points aren't text, and `useClipboard` is already
the DOM-element channel.

- **Cmd+C**: copy `pointsIn` the active selection.
- **Cmd+V**: paste at the active selection's start when one exists, else at the playhead's
  clip-local position, onto the selected clip's active lane. Inserted via `replaceRange`
  over the pasted span.
- Cross-parameter values map through unit space: `toUnit(sourceRange, v)` →
  `fromUnit(targetRange, u)` — a volume duck pasted onto a log-scaled `wet` lands sanely.
- Registered in `useAppHotkeys` and active only while an automation selection exists (copy)
  or clipboard content exists with an audio clip selected (paste), so clip-level
  copy/paste is never shadowed.

### Stretch (wa-18)

8 px grab zones just inside the selection's left/right edges (points win hits over
handles). Dragging an edge retimes interior points proportionally:
`t' = t0' + (t − t0) · span'/span`, then `replaceRange` over the union of old and new
spans. One more gesture kind in the hook. Vertical scaling deliberately cut.

### Simplify (wa-16, shares the menu)

Ramer–Douglas–Peucker in unit space over the selection, ε ≈ 2 % of lane height. Exists for
carve output and dense hand edits.

## Testing

- `replaceRange`: assert `sampleAutomationLane` outside the range is identical before and
  after every op — the invariant, tested directly. Anchor pinning, cap, dedupe.
- Generators: point counts, unit-space values on a log lane, edge continuity.
- RDP: dense sine in → few points out, max deviation < ε.
- Clipboard mapping: volume → wet round-trip on a log range.
- Gestures: existing harness (synthetic pointers, stubbed box, assert `onPreview`/
  `onCommit` payloads). New: drag selects; sub-threshold click clears; Escape clears;
  Delete empties the range and pins anchors; edge drag retimes; menu insert writes a swell.
- Keyboard hook inert while a text input has focus.
- Nothing below the attribute changes → no engine/render tests.

## PR breakdown

Stacked on wa-14 (stack #3027), each under the 1000-LOC convention:

| PR    | Content                                                                 | ~LOC |
| ----- | ----------------------------------------------------------------------- | ---- |
| wa-15 | slice, drag gesture, rect render, `replaceRange`/`pointsIn`, Delete/Esc | 400  |
| wa-16 | shape generators, selection context menu (ramp/swell/dip), Simplify     | 380  |
| wa-17 | clipboard, Cmd+C/V in `useAppHotkeys`, unit-space mapping               | 300  |
| wa-18 | edge-handle stretch gesture                                             | 250  |

wa-16/17/18 are independent once wa-15 lands. File-size note: `useAutomationLaneGestures`
grows in wa-15 and wa-18 (310 lines today — headroom exists); the menu is a new file.

## Decisions log

- One cycle per shape, scaled to the selection (per-beat cycles rejected: not a music tool).
- Shape set is the utility four (ramp up/down, swell, dip); saw/square/ADSR rejected.
- Paste anchor: selection start when active, else playhead.
- Selection state in a store slice (approach A); component-local and DomEditContext rejected.
- Internal clipboard, not OS clipboard.
- All range math pure, in studio; core untouched.
- Vertical scale and skew cut from stretch.
