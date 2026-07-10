# STAGE 3 — Needed wiring (lane ↔ stacking unification)

The pure lane→stacking computation is DONE and self-contained in files this agent
owns (`timelineStackingSync.ts` + `commitDraggedClipMove` in `timelineClipDragCommit.ts`).
`commitDraggedClipMove` now accepts two OPTIONAL deps that engage the z-sync:

```ts
readZIndex?: (element: TimelineElement) => number;      // read live z (inline/computed; "auto"⇒0)
onStackingPatches?: (patches: StackingPatch[]) => void; // apply z patches in the SAME persist
```

When both are supplied and a lane-change commit happens, it computes the minimal
z-index patch(es) for the edited clip(s) and calls `onStackingPatches`. When either
is absent it is a no-op (fully backward compatible — existing callers/tests unaffected).

The only thing NOT wired is *providing* those two deps at the call site, because the
call site lives in a file another agent owns this stage.

## The 5-line wiring (owned by the concurrent agent)

File: `packages/studio/src/player/components/useTimelineClipDrag.ts` — the single
`commitDraggedClipMove(drag, { … })` call (~line 585).

1. This hook already has access (via context/props) to the preview iframe document
   and to `handleDomZIndexReorderCommit` from `useElementLifecycleOps` /
   `useDomEditActionsContext`. Thread a resolver in that maps a `TimelineElement`
   to its live `HTMLElement` in the iframe (the timeline already resolves elements
   by `hfId` / `id` / `selector` for its DOM patches — reuse that resolver).

2. Add the two deps to the existing `commitDraggedClipMove(drag, { … })` call:

```ts
readZIndex: (el) => {
  const node = resolveIframeElement(el);           // hfId ?? id ?? selector[selectorIndex]
  return node ? readEffectiveZIndex(node) : 0;      // reuse parseZIndex/readEffectiveZIndex
},                                                  // (canvasContextMenuZOrder exports parseZIndex)
onStackingPatches: (patches) => {
  const entries = patches.flatMap((p) => {
    const el = elements.find((e) => (e.key ?? e.id) === p.key);
    const node = el && resolveIframeElement(el);
    if (!el || !node) return [];
    return [{
      element: node,
      zIndex: p.zIndex,
      id: el.domId ?? el.id,
      selector: el.selector,
      selectorIndex: el.selectorIndex,
      sourceFile: el.sourceFile ?? activeCompPath ?? "index.html",
    }];
  });
  if (entries.length) handleDomZIndexReorderCommit(entries);
},
```

`handleDomZIndexReorderCommit` (in `hooks/useElementLifecycleOps.ts`, unchanged) already:
- mutates `element.style.zIndex` optimistically,
- promotes `position: static → relative` so the z takes effect,
- persists an `inline-style` `z-index` patch through `commitPositionPatchToHtml`
  → `persistDomEditOperations` → SDK/HTML soft path with `skipRefresh: true` (no flash),
- coalesces into one undo entry via `coalesceKey`.

So the z patch lands as the SAME kind of inline-style commit the canvas right-click
z-order and the LayersPanel row-drag already produce — one shared persist shape.

### Atomicity note

The lane-change move (`onMoveElements`) and the z patch
(`handleDomZIndexReorderCommit` → `commitPositionPatchToHtml`) are currently TWO
persists. To land them as ONE undo step, give both the same `coalesceKey` (the
edit-history coalescer merges within 300ms — see `editHistory.ts`), or, cleaner,
extend `onMoveElements` to accept optional per-edit style patches so the move and z
land in a single `saveProjectFilesWithHistory` call. Either is a small change local
to the concurrent agent's `hooks/useTimelineEditing.ts` / `timelineElementsMove.ts`.
The pure layer already emits the patches; only the persist-merge is deferred.

## §future — reflecting panel/menu z-edits back into lane ordering

Currently the data flow is ONE-WAY: a timeline lane change now drives z-index
(this stage). The reverse — a z-edit from the canvas right-click menu
(`CanvasContextMenu` → `resolveZOrderChange` → `handleDomZIndexReorderCommit`) or a
LayersPanel row-drag (`LayersPanel.tsx:236-243`, same commit path) — does NOT move
the clip's timeline lane. Both surfaces write z only; the timeline still assigns
lanes purely by authored `track` index via `normalizeToZones` (packs by track, then
first-fit sub-lanes for time overlaps — `timelineZones.ts`). So after a menu/panel
z-edit the clip keeps its timeline row even though it now renders on top/below.

A future two-way enhancement (NOT implemented — design only):

- Introduce a `zIndex` field on `TimelineElement` (today z lives only in the live
  DOM; `TimelineElement` carries no z). Populate it in the element-discovery path
  (`useExpandedTimelineElements` / wherever elements are built) from the same
  `readEffectiveZIndex` read.
- Make `normalizeToZones` (or a thin wrapper) order the VISUAL lanes by descending
  z among time-overlapping clips, so a higher z ⇒ higher (top) lane. Sequential
  (non-overlapping) clips keep sharing a lane regardless of z (z is meaningless
  without a time overlap — mirrors `computeStackingPatches`' overlap gate).
- On a menu/panel z-commit, re-run discovery/normalization so the affected clip's
  row reflects its new z. Guard against oscillation: the z→lane mapping and the
  lane→z mapping (this stage) must agree at a fixed point — i.e. after applying
  lane→z, re-deriving z→lane must not move the clip again. The overlap-gated,
  minimal-z resolution in `timelineStackingSync` is designed to be that fixed point
  (it only patches the edited clip, and only when out of order), but the reverse
  mapping needs its own idempotency test before shipping.
- Risk: `normalizeToZones` currently packs by `track` (authored index); layering by
  z would change lane assignment for existing projects on first load (visual-only,
  no source change, but a UX shift). Gate behind the same product decision as the
  core "vertical drag = lane vs z" fork documented in COMPARE-TIMELINE §11 / hybrid
  notes.
