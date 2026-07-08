# HyperFrames Studio — Complete Architecture Map & Drag-and-Drop Gap Analysis

> Research document. Branch `research/studio-dnd-architecture`, based on `main @ cebce603d` (2026-07-07).
> Everything below was read directly from source by seven parallel deep-read agents and spot-verified.
> All file paths are relative to the repo root; line numbers are as of this commit.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Overall studio layout & boot](#2-overall-studio-layout--boot)
3. [The runtime contract the timeline sits on](#3-the-runtime-contract)
4. [Preview hosting & the player bridge](#4-preview-hosting--the-player-bridge)
5. [The NLE timeline — exhaustive](#5-the-nle-timeline)
6. [Canvas selection, move, resize, rotate](#6-canvas-selection-move-resize-rotate)
7. [Sidebars & panels](#7-sidebars--panels)
8. [State, persistence, undo, and the backend API](#8-state-persistence-undo-backend)
9. [Existing drag & drop — complete inventory](#9-existing-drag--drop-inventory)
10. [CapCut & industry research](#10-capcut--industry-research)
11. [Gap analysis: what's missing for CapCut-grade DnD](#11-gap-analysis)
12. [Recommendations & suggested build order](#12-recommendations)

---

## 1. Executive summary

**The big surprise: drag & drop already ~60% exists.** You can already drag an image or
audio row from the Assets tab onto the timeline, or drop OS files from Finder onto the
timeline, and the studio uploads them, builds `<img>/<video>/<audio>` markup, computes a
`{start, track}` placement from the drop pixel, patches the composition HTML on disk, and
reloads the preview. What's missing is the *feel*: no drop ghost, no playhead/edge snapping
during drag, no track-row highlight, elements land at (0,0) on canvas, no canvas file-drop,
no waveforms on timeline clips, and the block catalog can't be dragged at all (its drop
targets exist but no drag source sets the MIME).

**Architecture in one paragraph.** The studio is a React app (Vite) with the composition
HTML file **on disk as the single source of truth** — there is no in-memory document model.
The preview is a `<hyperframes-player>` web component wrapping a same-origin iframe; the
studio reaches directly into `iframe.contentWindow` (`__player`, `__timelines`, `__hf`) for
seek/play and hit-testing — postMessage is only used for a couple of narrow controls and for
the runtime's outbound clip manifest. The timeline is pure DOM/CSS (no canvas element, no
virtualization), driven by a Zustand `usePlayerStore` whose `TimelineElement[]` is populated
from the runtime's clip discovery inside the iframe. Every edit is a **string patch of the
HTML source** (regex-based `sourcePatcher`, or the new flag-gated `@hyperframes/sdk`
"cutover" path) written through `PUT /api/projects/:id/files/*`, with undo history in
IndexedDB as before/after file snapshots. GSAP-only edits avoid full iframe reloads via a
script-swap "soft reload"; timing/HTML edits trigger a full preview reload.

**CapCut is native Qt/QML, not web** (verified on the installed app: Qt 6.2.2, QML timeline,
CEF/Lynx only for secondary panels). Its feel comes from a fully custom pointer-driven
canvas — the industry consensus for web editors is the same: use native HTML5 DnD *only* at
the OS-file boundary, and pointer-events + custom ghost + custom snap math for everything
inside the app. HyperFrames' existing internal drags already use HTML5 DnD end-to-end,
which is part of why they feel rough.

---

## 2. Overall studio layout & boot

### 2.1 Screen regions

```
┌─────────────────────────────────────────────────────────────┐
│                    StudioHeader (h-10)                       │
├──────────┬────────────────────────────────┬──────────────────┤
│ Left     │  Main stage (flex-1)           │  Right panel     │
│ Sidebar  │  Preview iframe OR Storyboard  │  Design/Layers/  │
│ 240px    │  + Timeline strip below        │  Renders/Slides  │
│ (40px    │                                │  400px default   │
│ collapsed)│                               │  (starts hidden) │
└──────────┴────────────────────────────────┴──────────────────┘
```

- `packages/studio/src/contexts/PanelLayoutContext.tsx` wraps `hooks/usePanelLayout.ts`:
  - `leftWidth`: default 240px, range 160px–50vw; keyboard resize 16px/step; collapse → 40px icon strip; collapsed state persisted to localStorage via `readStudioUiPreferences`/`writeStudioUiPreferences`.
  - `rightWidth`: default 400px, range 160–600px. `rightCollapsed` default **true** (panel starts hidden), not persisted.
  - `rightPanelTab`: `"design" | "layers" | "renders" | "slideshow" | "block-params"`, default `"renders"`.
  - `rightInspectorPanes`: `{design, layers}` — both can be open simultaneously, split by a draggable separator (layers pane 20–75%, default 40%); guard prevents disabling both (`usePanelLayout.ts:91`).
  - Panel resize handles: 8px `div[role=separator]` with `setPointerCapture`.
- `contexts/ViewModeContext.tsx`: `"timeline" | "storyboard"`, persisted to `?view=` URL query param via `replaceState`; `popstate` listener syncs.
- `components/StudioHeader.tsx`: logo + project id (left), `ViewModeToggle` segmented control (center, lines 146–201), right toolbar (lines 232–399): Undo/Redo (disabled off `editHistory.canUndo/canRedo`), frame Capture (PNG download), Inspector toggle (disabled entirely if `STUDIO_INSPECTOR_PANELS_ENABLED=false`), Export (opens right panel `renders` tab).
- Timeline strip height: `TimelineResizeDivider` (`components/nle/TimelineResizeDivider.tsx`) — pointer drag + ArrowUp/Down; clamps `MIN_TIMELINE_H=100` to `containerH − MIN_PREVIEW_H(120)`; persists to studio UI preferences.

### 2.2 Boot sequence (`App.tsx`, `main.tsx`)

1. `main.tsx:94` → `createRoot` → `StudioApp`.
2. `useServerConnection` (`App.tsx:65`): polls `GET /api/projects` every 2s until the server answers; extracts `projectId` from URL hash (`parseProjectIdFromHash`); shows `StudioSplash` while waiting.
3. `useFileManager`/`useFileTree`: fetches `GET /api/projects/:id` → file tree, project dir, compositions list; `fileTreeLoaded=true`.
4. `activeCompPath` hydration (`App.tsx:156–165`): reads `comp=` from URL hash, validates against the file tree.
5. Preview URL: `/api/projects/:id/preview` for root, `/api/projects/:id/preview/comp/:path` for sub-comps (`App.tsx:100–102`).
6. `useStudioUrlState` continuously syncs hash params: `v=1`, `comp`, `t` (time), `tab`, `rc` (right collapsed), `tv` (timeline visible), `selFile/selId/selSelector/selIndex` (selection deep-link).

### 2.3 Context split (performance-motivated)

`contexts/StudioContext.tsx` defines **two** contexts, not one:
- `StudioShellContext` (line 50): stable — `projectId`, `activeCompPath`, `editHistory`, `renderQueue`, `compositionDimensions`, `previewIframeRef`, `waitForPendingDomEditSaves`, `timelineVisible`.
- `StudioPlaybackContext` (line 51): volatile — `captionEditMode`, `compositionLoading`, `refreshKey`, `timelineElements`, `isPlaying`, `refreshPreviewDocumentVersion`.
- `useStudioContext()` (line 67) is deprecated; split hooks are the norm.

DomEdit is similarly split: `DomEditActionsContext` (stable callbacks) + `DomEditSelectionContext` (state) — `contexts/DomEditContext.tsx:92–93`.

---

## 3. The runtime contract

The timeline's authoritative "what exists" comes from the **runtime inside the iframe**, which
discovers clips from the composition DOM and posts a manifest. Everything the studio edits
must round-trip through the HTML source file.

### 3.1 Every timing/track/media `data-*` attribute

Clip discovery query (runtime): `document.querySelectorAll("[data-start], [data-track-index], [data-composition-id], video, audio, img")` — `packages/core/src/runtime/timeline.ts:370`.
Studio parser scope: `doc.querySelectorAll("[data-start]")` — `packages/parsers/src/htmlParser.ts:199`.

**Root element** (`data-composition-id` host):

| Attribute | Read at | Semantics |
|---|---|---|
| `data-composition-id` | `htmlParser.ts:315`, `init.ts:153` | Identity; maps to `window.__timelines[id]`. Required. |
| `data-composition-duration` | `htmlParser.ts:858` | Authored root duration (s); timeline length floor. |
| `data-composition-variables` | `htmlParser.ts:795` | JSON array of variables (string/number/color/boolean/enum/font/image). |
| `data-resolution` | `htmlParser.ts:134` | `landscape/portrait/(-4k)/square(-4k)`. |
| `data-composition-width/height`, `data-width/height` | `htmlParser.ts:149`, `init.ts:337` | Pixel dims; override/inline sizing. |
| `data-root="true"` | `init.ts:152` | Forces root when multiple `[data-composition-id]` exist. |

**Clip elements:**

| Attribute | Read at | Semantics / default |
|---|---|---|
| `data-start` | `htmlParser.ts:205`, `startResolver.ts:124` | Seconds **or reference expression** (`"intro + 2"`, `"intro - 0.5"` — grammar in `runtime/startExpression.ts`). Required for media discovery. |
| `data-end` | `htmlParser.ts:209` | Absolute end (s). **Takes precedence over `data-duration`**; the parsers' `updateElementInHtml` (`htmlParser.ts:547–557`) normalizes writes to `data-end` and removes `data-duration`. |
| `data-duration` | `startResolver.ts:9`, `timeline.ts:22` | Duration (s), fallback after `data-end`. For sub-comps, stripped and stashed as `data-hf-authored-duration` (`init.ts:356`). |
| `data-track-index` / `data-track` | `timeline.ts:432–433` | Integer track row. Default: DOM insertion order index. |
| `data-name` / `data-timeline-label` | `htmlParser.ts:70`, `timeline.ts:429` | Display name. |
| `data-hf-id` | `htmlParser.ts:224`, `clipTree.ts:46` | Stable id minted by `ensureHfIds`; preferred patch target. |
| `data-layer` | `htmlParser.ts:90` | z-index (falls back to `style.zIndex`). |
| `data-keyframes` | `htmlParser.ts:229` | JSON keyframes `{id, time, properties}`. |
| `data-x/y/scale/opacity` | `htmlParser.ts:243–249` | Static transforms. |
| `data-hidden` | (studio) | Element hidden; toggled by the track eye button. |
| `data-timeline-role` | `timeline.ts:444` | `"overlay"` / `"persistent-overlay"` (also studio roles like `"music"`). |
| `data-timeline-group` / `data-timeline-priority` | `timeline.ts:447–448` | Studio grouping/order hints. |
| `data-timeline-locked` | — | Blocks timeline editing (propagated from sub-comp roots). |
| `data-hf-autostamped="1"` | `init.ts:1278` | Runtime-stamped on GSAP targets in studio preview (not render) so animated elements appear on the timeline without authored timing. |

**Media elements** (`<video>/<audio>/<img>`) — `htmlParser.ts:355–385`, `runtime/media.ts:53–58`:

| Attribute | Semantics |
|---|---|
| `data-media-start` / `data-playback-start` | Trim in-point within the source file (s). Default 0. |
| `data-volume` | 0–1; default 1 (no attr = full volume). |
| `data-source-duration` | Cached media duration (avoids metadata race on seek). |
| `data-has-audio`, `data-aroll` | Studio hints. |
| `muted playsinline` | Required on `<video>` for autoplay. |

**Sub-composition hosts**: `data-composition-src` (external file → `loadExternalCompositions`),
`data-variable-values` (JSON overrides merged at mount, `compositionLoader.ts:539`),
`data-source-width/height`, `data-hf-original-composition-id` (dedup: 2nd instance of
`scene-1` becomes `scene-1__hf1`, `compositionLoader.ts:141`). Inline `<template id="x-template">`
variant handled by `loadInlineTemplateCompositions()` (`compositionLoader.ts:595`). On mount the
inner root is stripped of its timing attrs (`FLATTENED_INNER_ROOT_STRIP_ATTRS`, line 176), CSS is
scoped, scripts wrapped so `getVariables()` reads `window.__hfVariablesByComp[runtimeId]`.

**Fact check:** `class="clip"` is **not** required for runtime clip discovery — the runtime
queries by `[data-start]`/tags; `"clip"` only appears in `timeline.ts:124` as a class-name to
*skip* when deriving labels. It remains the documented convention (CLAUDE.md, linter), but a
DnD implementation should treat `data-start` as the real contract while still emitting
`class="clip"` for lint/convention.

### 3.2 Tracks are integers, not objects

There is **no track data structure anywhere**. A track is `track: number` on each clip.
- `normalizeTrackAssignments()` (`runtime/timeline.ts:56–93`): when clips of different *kinds* share a track number, they're split onto separate rows by kind priority `composition(0) > video(1) > image(2) > element(3) > audio(4)`.
- GSAP-discovered scene elements get `max(existing)+1` (`timeline.ts:524`).
- No audio-vs-video track types, no locked tracks, no track headers/names — purely emergent from clip attributes. The studio timeline renders one flat style for all rows (`getTrackStyle(tag)` returns a constant).

### 3.3 The manifest the studio consumes

`RuntimeTimelineClip` (`packages/core/src/runtime/types.ts:48–65`): `{id, label, start, duration, track, kind, tagName, compositionId, compositionAncestors, parentCompositionId, nodePath, compositionSrc, assetUrl, timelineRole/Label/Group/Priority}`. Posted as `{type:"timeline", durationInFrames, clips, scenes, compositionWidth/Height}` (`types.ts:195–208`). A `ClipTree` (`runtime/clipTree.ts:16–23`) exposes parent/child nesting for sub-comp expansion.

Parsed model types live in `packages/parsers/src/types.ts`: `TimelineElementBase` (`id, type, name, startTime, duration, zIndex, x?, y?, scale?, opacity?`), `TimelineMediaElement` (`src, mediaStartTime?, sourceDuration?, volume?, hasAudio?…`), `TimelineTextElement` (full text styling), `TimelineCompositionElement` (`src, compositionId, variableValues…`).

### 3.4 Media playback ownership & determinism

`syncRuntimeMedia()` (`runtime/media.ts`) runs per transport tick over `video,audio` elements that have `data-start`:
- Active window: `time ∈ [start, end]` with `relTime = (t − start) · playbackRate + mediaStart` (`media.ts:175–179`).
- Drift correction tiers: hard >0.5s; strict >40ms over 2 samples; force >20ms one-shot on transport transitions (`media.ts:230–323`). Playing `<video>` skips strict/force to avoid decoder stutter.
- Volume precedence: GSAP volume keyframes > GSAP-seeked `el.volume` > `data-volume` (`media.ts:193–213`).
- Autoplay-block fallback: on `NotAllowedError` runtime posts `media-autoplay-blocked` once → player promotes to **parent-proxy audio** (mirrored elements in the host frame produce sound; iframe media stay muted but time-driven) — `player/src/runtime-message-handler.ts:97–109`.
- Determinism: `quantizeTimeToFrame = Math.floor(t·fps + 1e-9)/fps` (`core/src/inline-scripts/parityContract.ts:35–40`); no Date.now/random/network at render.

### 3.5 Minimal markup a drop must produce

```html
<video id="my-clip" class="clip" src="assets/clip.mp4" muted playsinline
       data-start="5" data-duration="3" data-track-index="2"
       style="position:absolute; left:0; top:0; width:1920px; height:1080px; object-fit:contain; z-index:3"></video>

<audio id="bgm" class="clip" src="assets/music.mp3"
       data-start="0" data-duration="30" data-track-index="4" data-volume="0.8"></audio>
```
No GSAP registration is needed for media clips — media sync is independent of `__timelines`.
Insertion container preference in the parsers helper `addElementToHtml`: `#stage-zoom-container > .container > #stage > body` (`htmlParser.ts:636–642`). The studio's own drop path instead inserts right after the composition root open tag (see §9.2).

---

## 4. Preview hosting & the player bridge

- **Not a bare iframe**: `player/components/Player.tsx:107–383` creates `<hyperframes-player>` imperatively, `src=/api/projects/:id/preview`, `width/height` 1920×1080 (or portrait). The web component hosts an iframe in its shadow DOM; the studio extracts `player.iframeElement` into `previewIframeRef` and does **direct same-origin DOM access** for nearly everything. Shadow-DOM `pointer-events` forced to `auto` (`enableInteractiveIframe()`, lines 45–53).
- **Seek/play adapter** (`player/hooks/useTimelinePlayer.ts:130`): resolves `iframe.contentWindow.__player` → `__timeline` → `__timelines[rootId]` → a rAF static-seek fallback (`playbackAdapter.ts:59`). `wrapTimeline()` (`playbackAdapter.ts:203`) adapts GSAP timelines to `{play,pause,seek,getTime,getDuration,isPlaying}`.
- **postMessage is used only for**: `set-muted`, `set-playback-rate` outbound (`timelineIframeHelpers.ts:104–108`), and inbound `{source:"hf-preview", type:"state"|"timeline"}` manifest updates (`useTimelinePlayer.ts:488`).
- Full parent→runtime control verbs exist in `core/src/runtime/bridge.ts:41–63` (`play/pause/seek(frame)/tick/stop-media/set-*/enable-pick-mode/flash-elements`) — mostly for cross-origin embeds; the studio bypasses them.
- **The clock**: a 60fps rAF loop reads `adapter.getTime()` and pushes to `liveTime.notify(t)` — a tiny pub/sub **outside Zustand** (`playerStore.ts:216–223`) that drives the playhead and timecode by direct DOM writes, zero React renders per frame.
- **Known latent bug**: the web component's postMessage seek path hardcodes 30fps (`Math.round(t*30)` in `hyperframes-player.ts`); the runtime itself uses the real canonical fps. Irrelevant for the studio (same-origin direct path) but real for cross-origin embeds.
- In-iframe `window.__player` implements the full `PlayerAPI` (`parsers/src/types.ts:296–376`) including — importantly for DnD — **`addElement(data: AddElementData)`, `removeElement(id)`, `setElementTiming/Position/Scale/Volume`, `updateElementSrc`, `markTimelineDirty`, `rebuildTimeline`** — a live, in-preview mutation surface that the current drop flow does *not* use (it writes source + full-reloads instead).

---

## 5. The NLE timeline

### 5.1 Component tree

```
NLELayout (components/nle/NLELayout.tsx)
├─ NLEPreview (pan/zoom; writes stageRef.style.transform directly)
├─ CompositionBreadcrumb (drill-down, visible when stack.length > 1)
├─ PlayerControls (transport)
├─ TimelineResizeDivider
├─ [slot] TimelineToolbar (components/TimelineToolbar.tsx — injected by parent)
└─ Timeline (player/components/Timeline.tsx)
   ├─ TimelineEmptyState (also a drop target)
   ├─ TimelineCanvas (player/components/TimelineCanvas.tsx)
   │  ├─ TimelineRuler (SVG grid + DOM ticks; beat lines when avgBeatInterval·pps ≥ 5)
   │  ├─ per-track row: gutter (32px, eye/hide button) + BeatBackgroundLines + BeatStrip? + TimelineClip[]
   │  │  └─ TimelineClip (pill: trim handles, label, timecodes, ClipLintDot, TimelineClipDiamonds)
   │  ├─ drag ghost (floating TimelineClip with isDragging)
   │  ├─ range-selection blue rect
   │  └─ PlayheadIndicator (1px line + diamond; positioned imperatively)
   ├─ razor guide line, TimelineShortcutHint
   ├─ EditPopover (player/components/EditModal.tsx — agent-prompt handoff, no direct edit)
   ├─ ClipContextMenu / KeyframeDiamondContextMenu (portals)
```

NLELayout props (lines 29–78) include the full DnD callback surface: `onFileDrop`, `onAssetDrop`, `onBlockDrop`, `onPreviewBlockDrop`, plus `onDeleteElement`, `onBlockedEditAttempt`, `renderClipContent`.

### 5.2 State model

`usePlayerStore` (Zustand, `player/store/playerStore.ts`) is the single store:

- `elements: TimelineElement[]` (lines 23–63): `{id, label?, key?, tag, start, duration, track, domId?, hfId?, selector?, selectorIndex?, sourceFile?, src?, playbackStart?, playbackStartAttr? ("media-start"|"playback-start"), playbackRate?, sourceDuration?, volume?, compositionSrc?, timingSource ("authored"|"implicit"), timelineLocked?, hidden?, timelineRole?, expandedParentStart?}` — populated by the player bridge from the runtime clip manifest.
- `duration`, `currentTime`, `liveTime` (pub/sub, non-Zustand), `zoomMode: "fit"|"manual"`, `manualZoomPercent` (10–2000).
- `beatAnalysis` (from `useMusicBeatAnalysis` decoding the music track), `beatEdits` (+ in-store `beatUndo/beatRedo`), `keyframeCache: Map<elKey, KeyframeCacheEntry>`, `selectedKeyframes`.
- `clipManifest`, `clipParentMap`, `domClipChildren` → `useExpandedTimelineElements` (`player/hooks/useExpandedTimelineElements.ts`) flattens one sub-comp's children inline (target: selected element → paused playhead → none), stamping `expandedParentStart`.
- **Dead state** (implemented, unused by UI): `selectedElementIds: Set<string>` multi-select (lines 127–130, 269–276) and `inPoint/outPoint` work-area markers (85–87, 359–379). No timeline component reads either.

### 5.3 Time↔pixel math (constants and formulas)

All in `player/components/timelineLayout.ts`, `timelineZoom.ts`:

- `GUTTER=32`, `TRACK_H=48`, `RULER_H=24`, `CLIP_Y=3`, `CLIP_HANDLE_W=18`, min clip width 4px.
- Fit: `fitPps = (viewportWidth − GUTTER − 2)/effectiveDuration` (`Timeline.tsx:262–264`); manual: `pps = fitPps · manualZoomPercent/100` (`timelineZoom.ts:21–29`). Zoom steps ×1.25 / ×0.8; pinch `exp(−deltaY·0.0035)`; pointer-anchored scroll compensation `getTimelineScrollLeftForZoomAnchor` (`timelineLayout.ts:104–127`).
- Clip: `left = start·pps`, `width = max(duration·pps, 4)` (`TimelineClip.tsx:48–49`). Playhead: `left = GUTTER + max(0,t)·pps` (`timelineLayout.ts:130–133`).
- Drop pixel→time: `x = clientX − rect.left + scrollLeft − GUTTER; t = clamp(round(x/pps·100)/100, 0, duration)` (`timelineLayout.ts:186–211`) — i.e. **centisecond rounding**, not frame quantization (frame snapping happens downstream in the engine).
- Ruler ticks: target major spacing 88px from intervals `[0.02…600]`, minor at midpoints if ≥12px, max 2000 ticks (`generateTicks`).
- Beat snap: `BEAT_SNAP_PX = 8` → `8/pps` seconds; applied to clip move and both trim edges (`useTimelineClipDrag.ts`, music track excluded from snapping to itself, lines 213/349); matched beat glows via `BeatBackgroundLines`.

### 5.4 Playhead & scrubbing

- Position written imperatively (`playheadRef.current.style.left`) from `liveTime.subscribe` — zero renders during playback; React path only on `currentTime`/`pps` change (`timelinePlayhead.ts:85–91`).
- Auto-scroll during manual-zoom playback when playhead nears the right 12% margin (`timelinePlayhead.ts:125–133`).
- Scrub: pointer-down on empty canvas (no shift) → `useTimelineRangeSelection.handlePointerDown` → `seekFromX(clientX)` rAF-throttled (`useTimelineRangeSelection.ts:85–109`; `useTimelinePlayhead.ts:139–150`) → `onSeek` → adapter seek. `requestSeek(time)` on the store is the alternate path (used by BeatStrip).
- `useTimelineActiveClips` also bypasses React: on each `liveTime` tick it toggles `data-active` on `[data-clip]` DOM nodes by reading their `dataset.clipStart/clipEnd`.

### 5.5 Every existing interaction, with commit path

| Interaction | Handler | Commit |
|---|---|---|
| Scrub | empty-canvas pointerdown → `seekFromX` | none (transport) |
| Select clip | `TimelineClip.onClick` → `setSelectedElementId` (toggles off if re-clicked) | none |
| Move clip | `TimelineClip.onPointerDown` → `useTimelineClipDrag`; `resolveTimelineMove` (`timelineEditing.ts:72–112`): `Δt = Δpx/pps`, `Δtrack = round(Δy/TRACK_H)`, **edge-track creation at 0.55 row threshold** (drag past top/bottom mints `minTrack−1`/`maxTrack+1`; ghost row added via `displayTrackOrder`, `Timeline.tsx:238–246`); beat snap; ghost preview | optimistic `updateElement` → `onMoveElement` → app `persistTimelineEdit` (`hooks/timelineEditingHelpers.ts:115–142`): GET file → `buildPatchTarget` (domId > hfId > selector) → `applyPatchByTarget` textual patches of `data-start`/`data-duration`/`data-track-index` → `saveProjectFilesWithHistory`; GSAP position shift via `POST /api/projects/:id/gsap-mutations/:file` `{type:"shift-positions"}`; rollback on failure |
| Trim edge | `onResizeStart(edge)`; `resolveTimelineResize` (`timelineEditing.ts:142–181`) clamps and, for start-trim on media, adjusts `playbackStart` proportionally; beat-snaps edges | same persist path + `data-media-start`/`data-playback-start` patch |
| Split | toolbar button / razor click (`splitTime = start + clickX/pps`, boundary epsilon `SPLIT_BOUNDARY_EPSILON_S=0.03`) / razor shift-click = split-all | app-level; server `POST …/file-mutations/split-element/*` clones element with adjusted timing. Gate: `canSplitElement` (`utils/timelineElementSplit.ts`) — not locked, not implicit timing, not a sub-comp, finite duration |
| Delete | ClipContextMenu → `onDelete`; `shouldHandleTimelineDeleteKey` helper exists but key wiring is app-side | `POST …/file-mutations/remove-element/*` |
| Range select | shift-drag ≥0.2s → blue rect → `EditPopover` (agent prompt only, `buildTimelineAgentPrompt`) | none — copy-to-agent |
| Keyframe diamonds | `TimelineClipDiamonds` (`STUDIO_KEYFRAMES_ENABLED`): click=select+seek, shift=multi, drag=move (threshold `KEYFRAME_DRAG_THRESHOLD_PX`), context menu (Move to Playhead / Delete / Delete All; `onChangeEase`+`onCopyProperties` declared but **not rendered**) | GSAP mutation endpoints |
| Track hide (eye) | gutter button → `toggleTimelineTrackHidden` (`hooks/timelineTrackVisibility.ts`): optimistic live-DOM `data-hidden` + re-seek → source write → revert on failure | `saveProjectFilesWithHistory` |
| Beat dots | `BeatStrip` pointer drag / dblclick delete → `moveUserBeat`/`removeUserBeat` → `commitBeatEdits` | `beatPersist()` callback — **null by default; beats are lost on reload if the host never registers it** |
| Drill-down | double-click composition clip → `useCompositionStack` pushes level, preview switches to `…/preview/comp/:path`; Escape or empty-area double-click pops | none |
| Tools | Selection (V) / Razor (B) toggle, `STUDIO_RAZOR_TOOL_ENABLED` | — |

### 5.6 Rendering & performance

Pure DOM/CSS; **no `<canvas>`, no virtualization** — all clips always mounted (risk at 50+
clips each with diamonds). Hot paths deliberately skip React: playhead (liveTime), active-clip
class toggling, preview pan/zoom (`applyTransform` writes style directly), snap guides (§6).
`memo()` on every major component. Several functions carry `// fallow-ignore-next-line complexity`
exemptions (NLELayout:95, TimelineClip:27, TimelineCanvas:200/299/353, useTimelineClipDrag:302) —
already at the complexity ceiling.

### 5.7 Half-built / dead / flagged

- Flags (all in `components/editor/manualEditingAvailability.ts`): `STUDIO_KEYFRAMES_ENABLED` (default true), `STUDIO_RAZOR_TOOL_ENABLED` (true), `STUDIO_INSPECTOR_PANELS_ENABLED`, `STUDIO_BLOCKS_PANEL_ENABLED`, `STUDIO_GSAP_PANEL_*`, `STUDIO_SDK_CUTOVER_ENABLED` (**false**), `STUDIO_SDK_RESOLVER_SHADOW_ENABLED` (true).
- Dead store state: multi-select set; in/out points (§5.2).
- `EditPopover` is agent-handoff only.
- `beatPersist` null-by-default trap.
- `timelineMotionStyles.test.ts` exists with no implementation file (orphan).
- Expanded sub-comp children: move/resize rebased by NLELayout, but `implicit` timing and missing patch targets surface as "blocked edit" toasts; split always rejected for them.

---

## 6. Canvas selection, move, resize, rotate

### 6.1 Hit testing across the iframe boundary

Overlay div lives in the **host page** (`components/editor/DomEditOverlay.tsx:387–388`,
`pointer-events-auto absolute inset-0`). Click path: `handleOverlayPointerDown` →
`handlePreviewCanvasMouseDown` (`hooks/usePreviewInteraction.ts:87–233`) →
`getPreviewTargetFromPointer` (`utils/studioPreviewHelpers.ts:196–234`):
- Translates host coords to iframe-local via `(clientX − iframeRect.left)/scaleX`.
- **Injects a temporary `<style>` forcing `*{pointer-events:auto !important}`** into the iframe so `elementsFromPoint` can't miss `pointer-events:none` elements; removes it immediately.
- Scores candidates via `resolveAllVisualDomEditTargets` (`domEditingElement.ts:178`); skips elements covering ≥95% of the composition (`FULL_BLEED_RATIO=0.95`); falls back to `[data-hf-group]` union-rect hits.
- Identity: `DomEditSelection` (`domEditingTypes.ts:78–95`) = `{id, hfId, selector, selectorIndex, sourceFile}`; priority `hfId > id > selector+index`.
- Click-cycling through the z-stack: repeat clicks within 6px/600ms advance through candidates (`usePreviewInteraction.ts:74, 176–183`). Double-click detection is manual (overlay re-render resets `e.detail`); double-click drills into groups. Shift-click = additive.

### 6.2 Marquee

`useMarqueeGestures` (`components/editor/marqueeCommit.ts:111`): starts on empty-canvas
pointer-down (threshold 4px), synchronous overlay-space `rectsOverlap` hits during drag
(`utils/marqueeGeometry.ts:8`), async precise re-resolution on pointer-up, then
`applyMarqueeSelection(hits, shift)`. Rectangular only.

### 6.3 Handles & gestures

- **Move**: whole selection box; `startGesture("drag")`.
- **Resize**: a **single SE-corner handle only** (12×12, `DomEditOverlay.tsx:519–534`); `resolveDomEditResizeGesture` (`domEditOverlayGestures.ts`) — Shift = uniform. No N/S/E/W/NE/NW/SW handles.
- **Rotate**: `DomEditRotateHandle` above the box; Shift snaps 15° (`ROTATION_SNAP_DEGREES`); change threshold 0.05°.
- **Crop**: `DomEditCropHandles`, entered by double-click on croppable elements.
- **Group**: multi-select drag moves all (`startGroupDrag`), but **no group scale/rotate handles**.

### 6.4 Live DOM writes vs source commits (the clever part)

`components/editor/manualEditsDom.ts`:
- Move: if GSAP animates x/y → `gsap.set(el, {x: base+Δx, …})`; else CSS custom props `--hf-studio-offset-x/y` composed into `translate: calc(...)`. Draft variants during drag don't touch the base snapshot (prevents compounding).
- Resize: `--hf-studio-width/height` + width/height/min/max + `box-sizing:border-box`, flex-basis aware. Rotation: `--hf-studio-rotation`, `transform-origin: center center` **always** (no movable pivot).
- **Seek re-apply**: GSAP re-bakes transforms on every seek, so `installStudioManualEditSeekReapply` (`manualEdits.ts:266–282`) monkey-patches `__hf.seek`, `__player.*`, `__timeline.*`, and **all `__timelines[*]` via a Proxy** (catches future registrations) to re-apply studio edits after each seek.
- Commit: pointer-up → `buildPathOffsetPatches`/`buildBoxSizePatches`/`buildRotationPatches` (`manualEditsDomPatches.ts`) → `POST /api/projects/:id/file-mutations/patch-element/*`.

### 6.5 Snapping on canvas

`components/editor/snapEngine.ts` (pure): `SNAP_THRESHOLD_PX=6`; targets = sibling edges +
centers + composition bounds (`snapTargetCollection.ts`); optional grid; equidistant-spacing
guides (tolerance 1px, distance labels); max 6 guides; rendered by `SnapGuideOverlay` on a rAF
loop reading a ref — React-free. **This engine is exactly what a canvas-drop ghost should reuse.**

### 6.6 Coordinate systems

Host page space → overlay space (`toOverlayRect`, `domEditOverlayGeometry.ts:101–145`) →
composition space. `rootScale = iframeRect.width / declaredWidth` (declared `data-width/height`,
deliberately not the root rect, to dodge GSAP transform contamination — lines 117–119).
Sub-comp nesting: `findSourceBoundary` walks to `[data-composition-file|src]` ancestors and
compounds the scale. `editScaleX/Y` converts pointer deltas to composition deltas.

### 6.7 Text and misc

No in-canvas text editing — text edits flow through the right-panel property fields
(`collectDomEditTextFields`, `domEditingLayers.ts:87–133`; `data-hf-text-key` for stable field
identity). Off-canvas elements shown as dashed edge indicators (`OffCanvasIndicators`).
`MotionPathOverlay` exists behind the keyframes flag. Save-queue: `createDomEditSaveQueue`
(`utils/domEditSaveQueue.ts`) — promise-chain serialization + circuit breaker (5 consecutive
failures → paused banner).

---

## 7. Sidebars & panels

### 7.1 Left sidebar (`components/sidebar/LeftSidebar.tsx`) — 4 tabs, persisted to localStorage `hf-studio-sidebar-tab`

- **Code**: 160px `FileTree` (create/rename/delete/move/duplicate/import; internal drag-move of files, `FileTree.tsx:165–169, 301–303`) + `SourceEditor` or `MediaPreview`.
- **Comps** (`CompositionsTab.tsx`): `CompCard` rows with live 80×45 iframe thumbnails (CSS-scaled; hover-plays after 300ms via `win.__player`), active highlight, per-comp render button, lint badge.
- **Assets** (`AssetsTab.tsx`) — the media bin:
  - Scope toggle "This project" / "All projects" (global `~/.media` via `GET /api/assets/global` — **read-only, not draggable**: `GlobalAssetsView.tsx`).
  - Import button (`<input type=file multiple>`) + whole-panel drop zone (lines 356–362).
  - Search (filename + `.media/manifest.jsonl` descriptions), chips All/Images/Video/Audio/Fonts, In-use/Unused (via `deriveUsedPaths` diffing `playerStore.elements[].src`).
  - `ImageCard` (lines 29–175): draggable (sets `TIMELINE_ASSET_MIME`), hover video preview, click copies path, context menu Copy/Delete/Rename.
  - `AudioRow` (`AudioRow.tsx:111–117`): draggable, play button with live Web Audio waveform bars.
- **Catalog** (`BlocksTab.tsx`, behind `STUDIO_BLOCKS_PANEL_ENABLED`): search + 9 category pills (`utils/blockCategories.ts`), `BlockCard` grid with poster/hover-video, duration badge, WebGL badge, and two actions: **"Add" button** (click-only → `addBlockToProject`) and **"Ask agent"** (prompt modal). **No `draggable`, no `onDragStart` — blocks cannot be dragged today.**
- Pinned Lint button at bottom with finding count.

### 7.2 Right panel (`StudioRightPanel.tsx`)

Tabs Design / Layers / Renders / Slideshow (+ hidden `block-params`, opened programmatically
after installing parameterized blocks). Design+Layers can split vertically. When
`captionEditMode` is on, the entire panel is replaced by `CaptionPropertyPanel`.

- **PropertyPanel** (props at lines 347–405): inline style, `data-*` attrs (live + commit), position/size/rotation, text fields, full GSAP CRUD (~20 callbacks incl. keyframes, arc paths, eases), color-grading scope, background removal (`POST …/media/background-removal` + SSE poll), visibility toggle, Ask-agent.
- **LayersPanel**: layer stack with drag-to-reorder (`useLayerDrag`) → `handleDomZIndexReorderCommit`.
- **RenderQueue** (`components/renders/`): format MP4/MOV-ProRes/WebM, resolution Auto/1080p/4K (integer-upscale aspect check), fps 24/30/60, quality; settings in localStorage `hf-studio-render-settings`; jobs with progress/cancel/download/delete; export waits `waitForPendingDomEditSaves()`.
- **SlideshowPanel** (`components/panels/SlideshowPanel.tsx`): slides from live `__clipManifest.scenes`, reorder via arrows, notes (450ms debounce via a pure closure controller), branches, hotspot tool bound to current dom selection; persists via `parseSlideshowManifest` + `writeProjectFile`.

### 7.3 Storyboard view (`components/storyboard/`)

Contact sheet from STORYBOARD.md (`useStoryboard`); Board/Source toggle; frame tiles with
status (Outline/Built/Animated), focus view with status write-back (`setFrameStatus` from
`@hyperframes/core/storyboard`), debounced voiceover editing, keyboard nav. **No drag-to-reorder**
— order comes from the markdown.

### 7.4 Captions (`captions/`)

Zustand `useCaptionStore` (segments/groups model, full CRUD). `CaptionOverlay` polls the
iframe every 66ms for word boxes; per-word move/scale(×4 corners)/rotate handles via
`gsap.set` on the iframe's GSAP; arrow-key nudge. `generator.ts` serializes the model to a
`captions.html` composition (template + CSS + GSAP in/hold/out timelines); `parser.ts`
round-trips. Notably: **the captions overlay already implements richer multi-handle
transforms than the main canvas** (4 scale corners vs. 1).

### 7.5 blockInstaller (`utils/blockInstaller.ts`)

`addBlockToProject()`: `POST /api/projects/:id/registry/install {blockName}` → server copies
files → build a sub-comp host `<div data-composition-id data-composition-src data-start
data-duration data-track-index data-width/height style="…; z-index: maxDomZ+1">` →
`insertTimelineAssetIntoSource` → extend root `data-duration` if overflowing →
`saveProjectFilesWithHistory` → refresh tree + reload. Blocks go to track 0; components to
`maxTrack+1`. Accepts an optional `visualPosition` (used by the preview block-drop handler).

---

## 8. State, persistence, undo, backend

### 8.1 Source of truth & data flow

The HTML file **on disk** is the model. `useFileManager`'s `editingFile` is a fetch cache,
not reactive. Flow: interaction → new HTML string → `writeProjectFile` (`PUT /api/projects/:id/files/*`)
→ `editHistory.recordEdit` (IndexedDB) → `reloadPreview()` (bump `refreshKey`, `App.tsx:147`)
or GSAP soft reload. A file watcher SSE (`GET /api/events`) reports external changes;
`domEditSaveTimestampRef` + `markSelfWrite` suppress self-write echoes.

### 8.2 sourcePatcher (`utils/sourcePatcher.ts`) — the legacy write path

Pure **regex string patching**, no HTML parser. Ops (`line 89`): `inline-style`, `attribute`
(auto `data-` prefix), `html-attribute` (boolean-attr aware, line 419), `text-content`
(depth-counted close-tag search, line 400 — **comment-unaware**, unlike the equivalent in
`htmlEditor.ts:129`). Target resolution (`findTagByTarget`, line 271): `data-hf-id` → `id` →
`[data-composition-id=…]` → class selector + `selectorIndex`. **Failure mode: silent no-op** —
if nothing matches, the source is returned unchanged with no error.

### 8.3 SDK cutover (the future write path, dark-launched)

`@hyperframes/sdk` models the composition as a typed object graph (`getElement(hfId)`,
`setTiming`, `addGsapTween`, `dispatch(op)`, `serialize()`, `batch`). Flag
`STUDIO_SDK_CUTOVER_ENABLED` **defaults to false** (mirrored server-side as
`isAcornGsapWriterEnabled()`, `files.ts:80`). Mapped ops in `utils/sdkCutover.ts`: style/attr/
text persists, timing persists, ~10 GSAP tween/keyframe persists, delete. Eligibility gate
(`sdkCutoverEligibility.ts:105`): flag + session + **hfId present** + all ops in
`CUTOVER_OP_TYPES` + no child-scoped ops + no reserved attrs. `sdkResolverShadow.ts`
(default **on**) runs every op through the SDK, diffs against the legacy result, undoes, and
emits `sdk_resolver_shadow` divergence telemetry to PostHog. **DnD-relevant: elements
inserted without `data-hf-id` are permanently ineligible for the SDK path** (see gap G-9).

### 8.4 Undo/redo

`utils/editHistory.ts` + `editHistoryStorage.ts`: IndexedDB (`hyperframes-studio-edit-history`),
max 100 entries, entry = `{label, kind: manual|motion|timeline|source, coalesceKey?, files:
{path: {before, after, beforeHash, afterHash}}}`. Coalescing: same key within 300ms merges.
Apply-safety: FNV-1a hash check → `{ok:false, reason:"content-mismatch"}` if the file changed
externally. `saveProjectFilesWithHistory` (`studioFileHistory.ts:19`) reads before, writes,
records, and rolls back written files on partial failure.

### 8.5 Save pipeline

`optimisticUpdate.ts` (`apply/persist/rollback`), `studioPendingEdits.ts` (module-level
promise set + `hf-studio-flush-pending-edits` event; `waitForPendingDomEditSaves` used before
renders), circuit-breaker DOM-edit queue (§6.7). **gsapSoftReload** (`utils/gsapSoftReload.ts`):
swaps the GSAP `<script>` in the live iframe without reload; scopes teardown to the timelines
the script registers (regex over `__timelines["…"]`, line 194); restores playhead, calls
`__hfForceTimelineRebind` + `__hfStudioManualEditsApply`; returns
`applied | verify-failed (do NOT escalate) | cannot-soft-reload`. Timing/HTML edits always
full-reload; GSAP-only edits soft-reload.

### 8.6 Backend HTTP API (Hono app from `packages/studio-server`, mounted by `packages/cli/src/server/studioServer.ts`)

Files: `GET/PUT/POST/DELETE/PATCH /api/projects/:id/files/*` (PUT backs up to
`.hyperframes/backups/`; PATCH rename rewrites references project-wide),
`POST …/duplicate-file`, **`POST …/upload`** (multipart, `?dir=`, 500MB/file,
`validateUploadedMediaBuffer` MIME sniffing, name auto-dedup `foo (2).png`, async waveform
cache for audio — `studio-server/src/routes/files.ts:1496–1578, 1962`).

Mutations: `POST …/file-mutations/{patch-element,remove-element,split-element,wrap-elements,unwrap-elements,probe-element}/*`.
GSAP: `GET …/gsap-animations/*` (acorn parse), `POST …/gsap-mutations/*` (30+ mutation types incl. `shift-positions`, `scale-positions`; acorn writer behind the cutover flag, recast default).
Preview: `GET …/preview` (bundled, hf-ids injected, ETag by project signature), `…/preview/comp/*`, `…/preview/*` (static, **range requests / 206** for AV seeking).
Other: thumbnails (Puppeteer, content-hash cached), render job CRUD + SSE progress, lint, storyboard, **`GET …/waveform/*` (audio amplitude JSON — exists, unused by the timeline)**, media probe (`GET …/media/probe/*`), background removal jobs, selection get/set (CLI bridge), registry list/install, fonts, `GET /api/events` (SSE file watcher), `GET /__hyperframes_config`.

---

## 9. Existing drag & drop inventory

MIME constants (`utils/timelineAssetDrop.ts:5–6`, verified):
`TIMELINE_ASSET_MIME = "application/x-hyperframes-asset"`,
`TIMELINE_BLOCK_MIME = "application/x-hyperframes-block"`.

### 9.1 The seven flows

| # | From → To | Status | Path |
|---|---|---|---|
| A | Assets tab (ImageCard/AudioRow) → timeline | **works** | HTML5 DnD: `dataTransfer.setData(TIMELINE_ASSET_MIME, {path})` (`AssetsTab.tsx:64–67`, `AudioRow.tsx:111–117`) → `useTimelineAssetDrop` on the scroll div + empty state (`Timeline.tsx:384–391, 415–417`; `timelineDragDrop.ts:59–65`) → `resolveTimelineAssetDrop` → `{start, track}` → `NLELayout.tsx:527` → `useTimelineEditing.handleTimelineAssetDrop` (`useTimelineEditing.ts:408–491`): read source → classify → probe duration → build id/src/HTML → insert after root open tag → `writeProjectFile` → `reloadPreview()` |
| B | OS Finder → timeline | **works** | same drop target, `e.dataTransfer.files` branch (`timelineDragDrop.ts:35–57`) → `handleTimelineFileDrop` (`useTimelineEditing.ts:494–542`): `uploadProjectFiles` (`POST …/upload`) → `buildTimelineFileDropPlacements` (sequences multiple files end-to-end; bumps to `maxTrack+1` if target row occupied; 5s fallback duration) → per-file flow A |
| C | OS Finder → anywhere in the shell | **works (import only)** | `useDragOverlay` (`useStudioContextValue.ts:106–134`, `Files` type, depth counter) → `StudioGlobalDragOverlay` (pure visual, z-90 "Drop files to import") → if no inner target claimed the drop, `handleImportFiles` → upload → refresh tree. **Does not place on the timeline.** |
| D | OS Finder → Assets tab | **works (import only)** | panel-level `onDrop` (`AssetsTab.tsx:356–362`) → upload |
| E | Block card → timeline | **half-built** | drop consumer fully wired (`timelineDragDrop.ts:73–85` → `onBlockDrop` → `handleTimelineBlockDrop`, `NLELayout.tsx:526`); **no drag source exists** — `BlockCard` isn't draggable |
| F | Block card → preview canvas | **half-built** | `usePreviewBlockDrop` (`components/nle/usePreviewBlockDrop.ts`; dashed overlay; maps drop px → normalized composition `{left, top}`; `NLELayout.tsx:455–458`) → `handlePreviewBlockDrop` → `addBlockToProject(visualPosition)`; **same missing drag source** |
| G | File tree → file tree | **works** | `text/plain` path drag, folder drop → rename/move API (`FileTree.tsx:165–169, 301–303`) |

Precedence: the timeline's `preventDefault()` beats the global overlay (checked via `e.defaultPrevented`).

### 9.2 What `timelineAssetDrop.ts` produces

- `getTimelineAssetKind` → image/video/audio by extension regex (no fonts, no LUTs).
- `buildTimelineAssetId` → slug + `_2/_3` dedup; `resolveTimelineAssetSrc` → correct relative path from the composition file's directory.
- `buildTimelineAssetInsertHtml` → the §3.5 markup, with geometry from
  `resolveTimelineAssetInitialGeometry` (root `data-width/height`, fallback 640×360), always at
  **left:0; top:0**, `object-fit: contain`; audio gets no geometry **and no `data-volume`**;
  no `data-media-start`; **no `data-hf-id`**.
- `insertTimelineAssetIntoSource` → after composition root open tag, indentation-preserving. Root-composition only — no sub-comp targeting.

### 9.3 Drop-position math

`resolveTimelineAssetDrop` (`timelineLayout.ts:186–211`): `start` from x (centisecond
rounding), `track` from `floor((y − RULER_H)/TRACK_H)` mapped through the display track
order. **No snapping of any kind during drag-over; no ghost; the only feedback is
`isDragOver` styling on the empty state.**

---

## 10. CapCut & industry research

### 10.1 CapCut desktop, inspected locally (verified)

`/Applications/CapCut.app` v8.9.1, bundle `com.lemon.lvoverseas`. **Native Qt 6.2.2 / QML**
(QtQuick/QtQml/QtQuickControls2 via `otool -L`), in-house "FusionUI" QML kit (`qrc:/FusionUI/src/*.qml`
strings in `libFusionUI.dylib` — including `QUICollectionAdsorptionHeader`; "adsorption" 吸附 =
snapping as a first-class UI-kit concept). CEF 121 + ByteDance Lynx present but only for
secondary web panels (sticker/effect publishing, intelligent crop). Engine: bundled FFmpeg,
ByteDance VE libs, Metal renderer. **Not Electron; timeline not readable; nothing decompiled.**
Takeaway: the CapCut feel is a custom pointer-driven scene graph — the web equivalent is
pointer-events + custom ghost, not HTML5 DnD.

### 10.2 CapCut behaviors to replicate (from docs/tutorials; * = consistent-but-unofficial)

- Media bin → timeline: first video lands on the **main track**; anything dragged above becomes an overlay track **created automatically on drop**; audio auto-routes **below** the main track; tracks are unlimited and materialize where you drop.*
- **Main Track Magnet** toggle: magnetic main track only (delete/move ripples to close gaps; drops insert-and-ripple); overlay tracks stay free-form. This one-magnetic-storyline hybrid is CapCut's signature simplification of FCP.
- **Auto Snapping** toggle: snap to clip edges, playhead, markers while dragging/trimming. Plus **Linkage** (linked audio/captions travel with video) and **Preview Axis** (hover scrub line).
- Translucent drag ghost showing the exact drop slot; main-track drops open an insertion gap.*
- OS files drag directly onto the timeline (import + place in one motion).
- Canvas: bounding box with **corner scale handles**, rotation handle outside the corner, drag to reposition, center/edge alignment guides,* numeric mirror in the inspector. Overlays are added via upper tracks, then positioned on canvas.
- Audio: waveform on clip; right-click → Auto-mark beats; clips snap to beat markers. (HyperFrames already has beat snap — ahead of parity here.)

### 10.3 Cross-editor pattern matrix

| Pattern | Premiere | Resolve | FCP | CapCut | Web editors | Remotion Editor Starter |
|---|---|---|---|---|---|---|
| Default drop | Overwrite; modifier = insert-ripple (cursor switches) | Mode-based (insert/overwrite/place-on-top) | Magnetic insert/connect | Main: insert+ripple; overlays: free | Place-where-dropped, push on collision | Place; new layer per drop |
| Magnetic | optional | optional | always | main-track toggle | varies | no |
| Auto new track on drop | drag above top track | no | lanes materialize | **yes** | yes | yes |
| Snap toggle | `S` | `N` (mid-drag) | `N` | toolbar | always-on | `Shift+M` |
| Ghost | translucent clip + track highlight | outline + viewer overlay | gap animates open | translucent slot* | slot highlight | shadow overlay |
| Collision (free lanes) | overwrite | mode | bump to new lane, never reject | push to adjacent track* | push or reject | overlap via layers |

Kdenlive names the trichotomy explicitly: Normal (reject on collision) / Overwrite / Insert.
**Remotion Editor Starter is the closest prior art** and worth copying nearly feature-for-feature:
drop on timeline → type auto-detect → new layer; **drop on canvas → starts at current time,
positioned at the drop point**; auto durations; shadow ghost; multi-select drag; playhead-edge
auto-scroll; snap to items/playhead/grid; canvas snap to edges/center; Shift axis-lock;
marquee; corner+edge resize handles; waveforms with draggable dB line.

### 10.4 Web implementation best practice (consensus)

- **Never build the internal timeline drag on HTML5 DnD**: no touch, suppressed mouse events/scrolling mid-drag, unstylable OS ghost, `getData()` unavailable until `drop` in Chrome/Safari. Use `pointerdown` + `setPointerCapture` + ~4px threshold + own absolutely-positioned ghost + own snap math — exactly the pattern `useTimelineClipDrag` already uses for clip move/trim.
- **Use native DnD only at the boundary** (OS files, cross-window): `dragover`+`preventDefault`, on drop iterate `dataTransfer.items`, `kind==='file'` → `getAsFile()`/`webkitGetAsEntry()`; during dragover only MIME hints are visible — enough for a typed ghost. Atlassian **pragmatic-drag-and-drop** is the best current wrapper (headless, `external` file adapter, auto-scroll addon) if a library is wanted.
- Table stakes: Esc cancels + animate-home, grab/grabbing cursors, edge auto-scroll with proximity-proportional velocity (don't fire at drag start near an edge), ~100ms drop-settle animation, keyboard alternative for a11y.

---

## 11. Gap analysis

Ordered roughly by user-perceived impact. "G-n" ids are referenced in §12.

**Drop experience (the CapCut delta)**
- **G-1 No drop ghost / no track highlight / no time indicator during drag-over.** `isDragOver` exists but only styles the empty state. Everything needed to render a ghost is already there (pps, `resolveTimelineAssetDrop`, the drag-ghost rendering used by clip-move) — it's simply not wired for external drags. Root cause: flows A/B/E ride HTML5 DnD, where you only get `dragover` events and MIME hints; the ghost must be drawn from those.
- **G-2 No snapping on drop.** Clip move/trim snap to beats; drops snap to nothing — not the playhead, not clip edges, not beats. No snap toggle exists anywhere (CapCut/Premiere/FCP all have one).
- **G-3 No playhead-targeted insertion.** No "click asset → insert at playhead" affordance and no snap-to-playhead during drag. CapCut users live at the playhead.
- **G-4 Collision handling is crude.** `buildTimelineFileDropPlacements` bumps the *whole sequence* to `maxTrack+1` if the target row has any overlap. No insert-vs-overwrite semantics, no ripple, no per-clip nearest-free-row logic, no FCP-style "never reject, bump one lane".
- **G-5 Global OS drop imports but doesn't place** (flow C). Uploading is silent-ish; users expect import+place or at least a "place at playhead?" affordance.
- **G-6 Blocks can't be dragged** (flows E/F): consumers wired, producers missing — `BlockCard` needs `draggable` + `onDragStart` setting `TIMELINE_BLOCK_MIME`. Probably the single cheapest high-visibility win.
- **G-7 Canvas file/asset drop missing.** Only blocks have a preview drop handler. Remotion's pattern (drop on canvas → overlay at playhead, positioned at drop point) is the exact CapCut-style behavior wanted; `usePreviewBlockDrop` already contains the px→composition coordinate mapping to generalize.

**Inserted-markup quality**
- **G-8 Dropped visuals land at (0,0) full-frame** (`object-fit: contain`, geometry = composition size). CapCut centers media at natural size (or fitted) — and canvas drops should center on the cursor.
- **G-9 No `data-hf-id` stamped on insert** → new elements are ineligible for the SDK cutover path and get weaker patch targeting (selector fallbacks). One-line fix in `buildTimelineAssetInsertHtml`.
- **G-10 Audio inserts without `data-volume`** and nothing sets `data-media-start`; there's no post-drop trim/volume UI. Also `getTimelineAssetKind` ignores fonts/LUTs (silent no-op on drop).
- **G-11 Root-composition-only inserts.** Dropping while drilled into a sub-comp still patches the root (`insertTimelineAssetIntoSource` has no sub-comp targeting), which is surprising in the breadcrumb-drill-down world.

**Timeline platform gaps (would need touching for a full CapCut experience)**
- **G-12 No audio waveforms on timeline clips** — the backend already serves `GET …/waveform/*` and generates the cache at upload; the timeline just never draws it.
- **G-13 No track model**: no headers, names, mute/solo, lock, or type identity; the eye-toggle is the only track op. Fine for auto-track creation; blocking for "magnetic main track", per-track drop rules, and audio-below/video-above routing.
- **G-14 Multi-select is dead state** (`selectedElementIds` unused) — no multi-clip drag, no group ripple.
- **G-15 No virtualization** and per-clip diamond buttons — a media-heavy CapCut-style project (100+ clips) will hurt; also `EDGE_TRACK_CREATE_THRESHOLD` ghost-row logic assumes small track counts.
- **G-16 Full preview reload after every drop.** `reloadPreview()` bumps the iframe; a drop costs a full composition reload (seconds on heavy comps). The in-iframe `__player.addElement()` API (§4) exists precisely for optimistic live insertion but is unused by this path. Aggravated by G-17.
- **G-17 Silent-failure write path**: sourcePatcher returns unchanged HTML on target miss with no error; drop → "nothing happened" bugs will be hard for users to diagnose.
- **G-18 No drag cancel/UX affordances**: no Esc-cancel for external drags, no auto-scroll at timeline edges during drag-over, no drop-settle animation, no keyboard alternative.

**Canvas gaps (the "selection/resizing on screen" part of the ask)**
- **G-19 Single SE resize handle** (no 8-handle box), no aspect-lock toggle, no movable rotation pivot, no group scale/rotate, no alignment/distribute actions (snap engine covers guides but not commands), no in-canvas text editing, no bring-to-front/back context actions on canvas (z-reorder lives in the Layers panel). The captions overlay already has 4-corner scaling — the main canvas lags the captions editor.

**Sidebar/library gaps**
- **G-20 Global assets view is read-only** (no drag, no "copy into this project"); no stock/search integration (the `/media-use` machinery is CLI-only); no effects/transitions browser for timeline clips; blocks are click-to-add only (G-6).

---

## 12. Recommendations

### 12.1 Strategy

Keep the two-layer split the industry converged on, which HyperFrames is already halfway into:
1. **Native HTML5 DnD only at the boundaries** — OS files in, and (for now) the existing asset/block MIME drags from sidebars. Longer term, migrate sidebar→timeline drags to pointer-based (or pragmatic-drag-and-drop) for a stylable ghost; the boundary handlers stay.
2. **Pointer-events for everything inside the timeline/canvas** — already true for clip move/trim; extend the same `useTimelineClipDrag` ghost machinery to render external-drag previews.

Do **not** rebuild the timeline. The store, math, and persist paths are sound; the deltas are
feedback (ghost/snap), placement semantics (collision/tracks), markup quality, and canvas drop.

### 12.2 Suggested build order

**Phase 1 — cheap wins, days:**
1. G-6: make `BlockCard` draggable (set `TIMELINE_BLOCK_MIME`) — both consumers light up.
2. G-9/G-10: stamp `data-hf-id`, emit `data-volume="1"` on audio, handle unknown kinds with a toast.
3. G-3: "insert at playhead" — context-menu/button on asset cards calling `handleTimelineAssetDrop(path, {start: currentTime, track: auto})`.
4. G-5: after a global-overlay drop, offer/auto-place at playhead.

**Phase 2 — the drop feel, ~1–2 weeks:**
5. G-1: drag-over ghost — track the `dragover` position, reuse the existing floating `TimelineClip` ghost + a pending-track row; MIME hints (`items[i].type`) give kind before drop.
6. G-2: snap engine for drops — reuse beat-snap plus new playhead + clip-edge snap targets, with a toolbar snap toggle (persist to studio UI prefs); apply the same targets to clip move/trim so the whole timeline gets edge snapping, not just beats.
7. G-4: placement semantics — per-clip nearest-free-track (FCP "never reject"), and define overlap policy on the target row (default overlap/overwrite like today, no ripple until a track model exists).
8. G-18: Esc cancel, edge auto-scroll during drag-over, settle animation.

**Phase 3 — canvas drop + parity, ~2–3 weeks:**
9. G-7/G-8: generalize `usePreviewBlockDrop` into a canvas asset/file drop (start at playhead, natural-size-fitted, centered at cursor via the existing px→composition mapping); fix timeline-drop geometry to centered/fitted.
10. G-12: waveforms on audio clips from the existing waveform endpoint.
11. G-19: 8-handle resize on the canvas selection box (port the captions overlay's corner-handle pattern), alignment actions on multi-select.
12. G-16: optimistic insertion via `__player.addElement()` with source write in the background, falling back to reload on failure — kills the drop→reload lag.

**Phase 4 — structural (design first):**
13. G-13: a real (still lightweight) track model — likely a `data-track-meta` sidecar or root attribute mapping track index → `{name?, kind?, locked?, muted?}` — unlocking main-track magnet semantics, audio-below routing, and per-track drop rules.
14. G-14: wire multi-select + multi-clip drag; G-15: virtualization if projects grow; G-11: sub-comp-targeted inserts using the breadcrumb context.

### 12.3 Verify-by-hand list (CapCut specifics marked * in §10.2)

CapCut is installed — 20 minutes of hands-on before locking the Phase 2 spec: exact ghost
rendering on main vs overlay tracks, insertion-gap animation, collision push behavior on
overlay tracks, canvas-drag guide behavior, and what modifier keys (if any) toggle
insert/overwrite.
