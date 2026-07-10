# Canvas-Editor + Visual-Chrome Comparison — OURS vs MAIN

**Date:** 2026-07-09
**OURS:** branch `research/studio-dnd-architecture`, worktree `/Users/ularkimsanov/Desktop/hyperframes-3/.claude/worktrees/laughing-perlman-594eb3`, live on `http://localhost:3014`
**MAIN:** v0.7.48, checkout `/tmp/hf-main-preview`, live on `http://localhost:3015`
**Shared project (mutable, owned here):** `/tmp/hf-dnd-qa/qa-compare2`

**Method:** Both studios driven live via headless Chrome (puppeteer from `packages/engine`) for screenshots + chrome tokens; canvas _interaction_ details (handles, gestures, snap, context menu, nudge) verified by **code reading** in `packages/studio/src/components/editor/` of both checkouts, because synthetic pointer drags into the sandboxed preview iframe are unreliable (confirmed: mouse-into-iframe selection did not land in the harness). Where a claim is code-only vs live-verified, it is marked.

---

## TL;DR — the two branches diverged on two independent axes

- **OURS = canvas-manipulation + chrome-polish branch.** It added a **4-corner resize** (MAIN has 1), a **right-click canvas context menu** with z-order + delete (MAIN has none on canvas), **arrow-key nudge** (MAIN has none), an **icon rotate handle**, **edge-aware resize snapping + letterbox-accurate guide lines**, and a **CapCut-style shell** (rounded floating panel-cards on a lighter `#18181B` canvas, denser flat timeline toolbar with a snap toggle, violet/teal audio-vs-visual track coloring).
- **MAIN = feature-surface branch.** It ships a whole **Variables panel + promote-to-variable** feature (declare/bind/validate template variables, `◇ var` promote gesture) that **OURS deleted**. MAIN's z-order (#2068) lives in a **draggable LayersPanel**, not on the canvas.
- The **shared editing engine is otherwise identical**: marquee multi-select, crop, inline text edit, aspect-lock (Shift), 15° rotate snap, and the no-reload SDK-persist commit path are byte-for-byte the same on both.

**Net recommendation:** take OURS' canvas + chrome wholesale, and **re-port MAIN's Variables/promote stack onto OURS' shell** — they don't conflict (identical Tailwind token layer).

---

## Verdict table

| #   | Feature                              | OURS                                                                                                                                                                                                                                                    | MAIN                                                                                                                                                                          | Verdict                                                                                                             |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Canvas selection / handles           | Selection box + **4 corner dots** (9px visible / 16px hit), teal `studio-accent`; hover affordance; **marquee multi-select** wired                                                                                                                      | Selection box + **1 SE corner** handle (`w-3 h-3` 12px accent square); marquee multi-select wired                                                                             | **OURS** (handles) / TIE (marquee)                                                                                  |
| 2   | Resize                               | **4 corners** (nw/ne/sw/se), each anchors opposite corner via `RESIZE_HANDLE_DEFS.map`; Shift = uniform aspect-lock                                                                                                                                     | **1 corner** (SE only), hard-coded; Shift = uniform                                                                                                                           | **OURS**                                                                                                            |
| 3   | Rotate                               | **18px pill with rotate-arrow SVG icon**, accent border + surface bg + shadow; 15° snap w/ Shift                                                                                                                                                        | 12px solid accent dot on `w-px` stem, `cursor:grab`; 15° snap w/ Shift                                                                                                        | **OURS** (nicer affordance); snap TIE                                                                               |
| 4   | Crop                                 | Shared `DomEditCropHandles` + `domEditOverlayCrop`                                                                                                                                                                                                      | Same (shared)                                                                                                                                                                 | **TIE**                                                                                                             |
| 5   | Snap / guides                        | `snapEngine` gains **`ResizeSnapEdges`** (snaps whichever edges the grabbed corner moves) + **`resolveGuideLineRect`** (guide lines offset into the letterboxed composition rect → accurate)                                                            | `resolveResizeSnapAdjustment` snaps **right/bottom only**; no letterbox-offset guide helper                                                                                   | **OURS**                                                                                                            |
| 6   | Nudge (arrow keys)                   | **Yes** — `domEditNudge` / `useDomEditNudge`: 1px, Shift=10px, one-undo-per-burst (400ms debounce)                                                                                                                                                      | **None** (no canvas nudge module)                                                                                                                                             | **OURS**                                                                                                            |
| 7   | Context menu (z-order)               | **Right-click canvas menu** (`CanvasContextMenu`): Bring forward / Send backward / Bring to front / Send to back + Delete; z-order **wired to persist** via `onApplyZIndex → handleDomZIndexReorderCommit` in `PreviewOverlays`                         | **No canvas menu**; z-order (#2068) via **draggable LayersPanel** rows (`useLayerDrag` → `computeReorderZValues` → `handleDomZIndexReorderCommit`) + `useElementLifecycleOps` | **OURS** for canvas UX; MAIN's LayersPanel drag is a _different, also-good_ surface → **HYBRID** worth keeping both |
| 8   | Inline text edit / duplicate / other | Inline text edit shared (`domEditingTextFields`); no dedicated canvas element-duplicate in either                                                                                                                                                       | Same                                                                                                                                                                          | **TIE**                                                                                                             |
| 9   | No-reload commit                     | Style/timing/z change persists via SDK cutover path, **suppresses iframe reload** (`useDomEditCommits`)                                                                                                                                                 | Identical code                                                                                                                                                                | **TIE**                                                                                                             |
| 10  | Visual chrome                        | CapCut shell: `#18181B` canvas, **rounded bordered** preview & timeline cards, `px-px` seams, borderless transport, **dense flat timeline toolbar** (16px glyphs, snap-magnet "N" toggle, always-rendered keyframe btn), violet/teal audio track colors | Flat `neutral-950` everywhere, **no card framing**, hard `border-t/border-r` seams, "TIMELINE" label, boxed 11px toolbar glyphs, `Fit/−/100%/+` stepper                       | **OURS**                                                                                                            |
| 11  | Right / inspector panel              | Tabs: **Design / Layers / Renders / Slideshow** (inlined CapCut tab buttons, rounded panel card). **No Variables.**                                                                                                                                     | Tabs: **Design / Layers / Renders / Slideshow / Variables**; `PanelTabButton`; Design wrapped in `DesignPanelPromoteProvider`; **full Variables stack**                       | **MAIN** (feature) / OURS (chrome) → **HYBRID**                                                                     |

---

## Evidence

### 1–2. Selection & resize handles

`packages/studio/src/components/editor/DomEditOverlay.tsx`

- **OURS** L47–60: `RESIZE_HANDLE_DEFS` = `[nw(nwse), ne(nesw), sw(nesw), se(nwse)]`, comment "Corner resize handles, Canva-style: one per corner, diagonal cursors. Non-SE corners anchor the opposite corner by translating the element." L62–64: "Visible dot is 9px; the pointer target is a 16px invisible square." L619 renders `RESIZE_HANDLE_DEFS.map(...)`; L627 `gestures.startGesture("resize", e, { resizeHandle: def.handle })`.
- **MAIN** L477–488: a _single_ JSX handle `className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-studio-accent border border-studio-accent/60"`, `cursor: "se-resize"`, `gestures.startGesture("resize", e)`. No `RESIZE_HANDLE_DEFS` constant exists.
- File size reflects the divergence: OURS `DomEditOverlay.tsx` = 705 lines, MAIN = 543.
- Marquee: `MarqueeOverlay.tsx` + `marqueeCommit.ts` present & byte-comparable in both; wired at the call site in both — OURS `nle/PreviewOverlays.tsx:145 onMarqueeSelect={applyMarqueeSelection}`, MAIN `components/StudioPreviewArea.tsx:462 onMarqueeSelect={applyMarqueeSelection}`.
- _Live note:_ the teal selection/scrubber dot (`rgb(60,230,172)`, `border-radius:9999px`, 12px) seen in the live DOM probe is the **transport scrubber**, not a canvas handle — canvas overlay handles only mount after a real element selection, which the synthetic click could not produce.

### 3. Rotate handle

`DomEditRotateHandle.tsx` — **OURS** L40: `h-[18px] w-[18px] rounded-full border border-studio-accent/70 bg-studio-surface text-studio-accent shadow-...` containing an SVG rotate arrow (`path d="M21 3v5h-5"`). **MAIN** L30–34: a `w-px` accent stem + `h-3 w-3 rounded-full border border-studio-accent bg-studio-accent`, `cursor:"grab"`. Both: `domEditOverlayGestures.ts` `const ROTATION_SNAP_DEGREES = 15` with `Math.round(angle/15)*15` gated by `snap: e.shiftKey`.

### 5. Snap engine + guide rendering

`snapEngine.ts` diff (MAIN→OURS): OURS adds `export interface ResizeSnapEdges { x: "left"|"right"; y: "top"|"bottom" }` and rewrites `resolveResizeSnapAdjustment` to snap the _moving_ edges per grabbed corner (`edges.x === "left" ? mr.left+dx : ...`), where MAIN's comment reads "resize variant (only right/bottom snap)". OURS also adds `resolveGuideLineRect(guide, composition)` — offsets guide-line rects by the composition's letterbox `left/top` so guides render on the actual canvas, not the overlay origin. `SnapGuideOverlay.tsx` differs to match; `SnapToolbar.tsx` is **identical** in both.

### 6. Nudge

OURS-only files: `domEditNudge.ts`, `domEditNudge.test.ts`, `useDomEditNudge.ts`. `domEditNudge.ts`: `CANVAS_NUDGE_STEP_PX = 1`, `CANVAS_NUDGE_SHIFT_STEP_PX = 10`, `CANVAS_NUDGE_COMMIT_DEBOUNCE_MS = 400` ("One undo entry per key burst"), modifier chords pass through. MAIN's `DomEditOverlay.tsx` has no `ArrowUp`/nudge handling (grep empty).

### 7. Context menu / z-order

OURS-only files: `CanvasContextMenu.tsx`, `canvasContextMenuZOrder.ts(.test.ts)`. Menu = 4 z-actions + Delete, portaled to `document.body`, dismiss via `useContextMenuDismiss`, acts on `pointerDown` to beat the overlay's marquee `preventDefault`. **Persistence is wired** (despite the stale "wiring gap" comment in the file header): `nle/PreviewOverlays.tsx:128-131` passes `onDeleteSelection={handleDomEditElementDelete}` and `onApplyZIndex={(sel,z)=>handleDomZIndexReorderCommit([...])}`. MAIN's #2068 z-order is a **draggable LayersPanel** instead: `LayersPanel.tsx:16 useLayerDrag`, `:232 computeReorderZValues`, `:243 handleDomZIndexReorderCommit`; commit in `hooks/useElementLifecycleOps.ts` (inline `z-index` style patches via `commitPositionPatchToHtml`, coalesced under `z-reorder:` key).

### 9. No-reload commit

`hooks/useDomEditCommits.ts` — lines 66–203 byte-identical in both. Comment (both): the SDK "cutover persist serializes only the patched DOM… suppresses the reload even if the [preview] event arrives before the handler." So on **both**, a canvas move/resize/z-change applies optimistically and persists **without blinking/reloading** the player.

### 10. Visual chrome (live, `/tmp/chrome-ours.png` vs `/tmp/chrome-main.png`)

Body bg on both = `rgb(10,10,10)` = `studio.bg #0a0a0a` (tokens identical; `styles/tailwind-preset*.js` byte-identical).

- **Shell:** OURS `components/EditorShell.tsx:209` canvas `bg-[#18181B]` (`panel.surface`, one step lighter than the near-black panels so gaps read as seams), `px-px pt-px` gaps; MAIN `nle/NLELayout.tsx:433` `bg-neutral-950` uniform, hard `border-t/border-r`.
- **Preview stage:** OURS `nle/PreviewPane.tsx:111` `rounded-lg border border-neutral-800/50 bg-neutral-950` (floating card); MAIN `NLELayout.tsx:440` bare `flex-1 relative overflow-hidden`, no bg/border. _Live screenshots confirm:_ OURS preview is a rounded bordered card; MAIN is a flat black rectangle butting the shell.
- **Timeline:** OURS drops the "TIMELINE" label for density, flat `h-7 w-7` buttons with 16px glyphs (`flatBtn/flatIdle/flatActive`), adds a **snap-magnet toggle ("N")**, zoom **slider**, and a rounded timeline card (`TimelinePane.tsx:166`). `styles/studio.css:144-190` (OURS-only) adds violet audio-clip tint `rgba(167,139,250,0.16)` vs teal visual + drag/selection states. MAIN keeps the "TIMELINE" label, boxed 11px glyphs, and a `Fit/−/100%/+` stepper. _Live screenshots confirm all of the above._
- **Transport:** OURS removes MAIN's top hairline (`borderTop 1px rgba(255,255,255,0.04)`) so it blends onto the preview card, and stores `timeDisplayMode` in the player store (MAIN uses ephemeral `useState`). Otherwise identical (`player/components/PlayerControls.tsx`).

### 11. Right panel / Variables + promote (MAIN-only feature)

`components/StudioRightPanel.tsx` — MAIN imports & renders `VariablesPanel`, `PanelTabButton`, `usePreviewVariablesStore`, wraps Design in `DesignPanelPromoteProvider`, and rides variable overrides in the preview payload (`variables: usePreviewVariablesStore.getState().values`). OURS removed all of these; tab buttons inlined (`h-8 rounded-xl px-3 text-[11px]`), no Variables tab. `grep -ri variable` over OURS `components/` hits only unrelated GSAP/font/test files.
MAIN-only files that constitute the feature:

- `components/panels/VariablesPanel.tsx` (+ `VariablesDeclarationForm`, `VariablesValueControls`, `VariablesBindElement`, `VariablesOtherCompositions`, `VariablesRowAction`) — declare/preview/bind/validate template variables.
- `components/DesignPanelPromoteProvider.tsx` — opens an SDK session keyed on `selection.sourceFile` so a promoted variable lands in the sub-composition's own file.
- `components/editor/PromotableControl.tsx` — the `◇ var` promote button on a property control (declares a var defaulted to current value → binds property → shows `◆ {id}` chip; warns on dangling `data-var-*`).
- supporting: `hooks/previewVariablesStore`, `useVariablesPersist`, `components/PanelTabButton.tsx`.

---

## Recommended adoption plan

**Base = OURS.** Its canvas manipulation and chrome are strictly ahead; MAIN's only true lead is the Variables feature it deleted.

1. **Keep all of OURS' canvas work** — 4-corner resize + `ResizeSnapEdges` + `resolveGuideLineRect`, arrow-key nudge, the icon rotate handle, and the right-click `CanvasContextMenu` (already wired to persist). These are the branch's reason to exist.
2. **Keep all of OURS' chrome** — `EditorShell`/`PreviewPane`/`TimelinePane` CapCut shell, flat dense `TimelineToolbar` with the snap-"N" toggle, refined `w-[3px]`/`w-2`-hit resize dividers, borderless transport, and the `studio.css` audio/visual track coloring.
3. **Re-port MAIN's Variables + promote stack onto OURS' shell** — copy `components/panels/Variables*.tsx`, `DesignPanelPromoteProvider.tsx`, `editor/PromotableControl.tsx`, `hooks/previewVariablesStore` + `useVariablesPersist`; add a "Variables" entry to OURS' inlined tab buttons (no need for `PanelTabButton`); wrap OURS' `PropertyPanel` in `DesignPanelPromoteProvider`; add `variables: usePreviewVariablesStore.getState().values` to OURS' preview payload in `StudioRightPanel`. No token changes needed — `tailwind-preset*` is identical, so the ported panels inherit OURS' palette cleanly.
4. **Consider HYBRID for z-order:** OURS' canvas context menu and MAIN's **draggable LayersPanel** reorder are complementary (canvas-first vs list-first). Both commit through the same `handleDomZIndexReorderCommit`, so shipping both is low-risk and covers both interaction styles.
5. **Housekeeping:** the "Wiring gap (z-order persistence)" comment block atop OURS' `CanvasContextMenu.tsx` is **stale** — the call site _is_ wired in `PreviewOverlays.tsx`. Update or delete that comment to avoid future confusion.

---

## qa-compare2 state at end

Not mutated. The comparison was observation-only (screenshots + code reading); no canvas edits were committed to `/tmp/hf-dnd-qa/qa-compare2`. Both studios still serve it; MAIN's timeline shows a leftover composition label "INSIDE: QA-CLEAN" (harmless project naming, pre-existing). The `qa-clean` project owned by another agent was not touched.
