# Shared automation lane rows on a track

Decision taken 2026-08-07. Implemented in `1e21d763b`.

## The bug

Four narration slices sit on one track row. The row's header is named after
whichever clip is selected ("Narration 2"), carries a `4` badge, and lists that
clip's automation lanes ("Peaking EQ 1 kHz / Q"). So a lane belonging to one clip
reads as governing the whole row, and changing the selection silently swaps which
envelopes are visible.

The lane SVG itself is already confined to its clip — `TimelineAutomationLaneSlot`
passes `leftPx={element.start * pps}` and `widthPx={element.duration * pps}`. What
misleads is the label column and the full-width row, not the geometry.

## What was decided, and what was rejected

**Effects stay on the clip.** Track-level FX was considered and rejected: there is
no track to own a chain. `data-track-index` is parsed in exactly one place
(`core/src/runtime/timeline.ts:63`) and only to choose a row; there is no track
element, no manifest, and both runtimes build audio per element — each clip gets its
own source → chain → gain → master. Track FX would mean inventing a storage location
and a bus node in two runtimes. It is also wrong for the domain: two takes on one row
often want different treatment, and a carve names specific clips.

**Clips on one row share a lane row when it is the same property of the same
effect.** One row for `Peaking EQ 1 kHz / Q`, with each clip's envelope drawn over
its own span. A different parameter, or the same parameter on a different effect, is
its own row.

## Implementation notes

- **The grouping key cannot be the lane target.** Targets are `fx.<nodeId>.<param>`
  and node ids are minted per chain, so `fx.n1.q` in one clip and `fx.n1.q` in
  another may be different effects entirely. Key on what identifies the parameter to
  a reader: effect label + distinguishing setting + param — which is exactly what
  `automationLaneLabelParts` in `automationLaneData.ts` already computes (it resolves
  the frequency for peaking-style filters). `volume` groups by itself.
- **Rows come from the track, not the selection.** `TimelineAutomationLaneSlot`
  currently binds one element. It needs the clips on the row, their chains, and the
  union of their grouped lanes — so lanes stop appearing and disappearing as the
  selection moves.
- **Gestures stay per clip.** Each clip keeps its own SVG, its own
  `useAutomationLaneGestures`, and its own selection box; a shared row is a shared
  _lane track_, not a shared envelope. Two clips' envelopes in one row must not be
  draggable as one thing.
- **Row height** is `AUTOMATION_LANE_H` per grouped lane, not per clip-lane, so
  `getTimelineLaneTop` and the header's row positions follow the grouped count.
- **Header labelling**: name the header for the track when it holds several clips
  rather than for one of them, and let the lane label stand for the property (it is
  the group's identity now, so it needs no clip qualifier).

## Worth deciding while implementing

A clip on the row that does _not_ automate a grouped property has empty space in
that row. Leave it empty (the envelope is simply absent there) rather than drawing a
flat line at the stored value — a flat line would claim an envelope exists.
