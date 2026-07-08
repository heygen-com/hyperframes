# NLE UX Research — CapCut & Real Editors (for the CapCut-parity work)

> Web research synthesis (2026-07-08) informing R1 (ruler), R2 (drag physics),
> R3 (track heights), R4 (layout). Feeds the trio after R4. Confidence flags at the end.
> Sources cited inline.

## R4 — Editor layout (CONFIRMS our design)

Standard NLE shell, corroborated across CapCut / Premiere / DaVinci Resolve:
**top row = media/library (left) + preview/monitor (center) + inspector (right); full-width
timeline spanning the bottom, with a timeline tool strip immediately above it.** The
preview↔timeline vertical split is a **draggable horizontal divider**.

- DaVinci Resolve Edit page: Media Pool left, viewer center, **Inspector locked top-right**
  (not movable), timeline full-width below.
  ([2pop](https://2pop.calarts.edu/technicalsupport/davinci-resolve-interface/),
  [Envato](https://elements.envato.com/learn/layout-davinci-resolve-18-guide))
- Premiere: same arrangement, panels fully dockable/movable.
- CapCut: consumer-simplified same layout — library top-left, preview top-center,
  properties top-right, timeline full-width bottom, tool row above.

→ Our R4 target (`[left | preview | right]` over a full-width timeline) is the convention.

## R2 — Drag / move physics (the main prize)

**Main-track magnet (core CapCut behavior, SOLID):** the primary/bottom video track is
magnetic — clips **cannot overlap and cannot leave gaps**; deleting/moving ripples following
clips left to close gaps and snaps adjacent clips flush. This magnetism applies **only to the
main track**. Overlay video tracks and audio tracks are **free/floating** layers: clips sit
anywhere, arbitrary gaps, cross-track overlaps allowed. The magnet is a documented toggle
(power-user topic).
([Filmora](https://filmora.wondershare.com/advanced-video-editing/capcut-timeline.html),
[turn-off-magnet](https://www.youtube.com/watch?v=3VEnnIldD1o),
[ripple delete](https://www.capeditcut.com/community/video-editing/enhance-timeline-for-professional-editing-ripple-delete-across-all-tracks/))

**Horizontal snapping (SOLID):** "Auto Snapping" snaps clip edges to the playhead and to
other clips' edges; toggle = magnet icon above the timeline or **N**.
([createthat](https://www.createthat.ai/blog/how-to-cut-in-capcut),
[snapping toggle](https://www.youtube.com/watch?v=pGWPieHbevw)) — matches what we already ship.

**UNCERTAIN — verify hands-on in CapCut (gotcha G7: user reference-checks):**

- Exact **vertical track-commit threshold** (sticky-to-current-track until you cross how far?).
  Not documented. Sane default ≈ cross the adjacent row's midpoint (~50% row height). _Note:
  the user's R2 spec asked for ~30% hysteresis — reconcile with hands-on feel._
- **Drag-over-occupied-clip** resolution: push ghost to nearest free track vs. reject vs.
  auto-create a track. Not documented. (CapCut is known to auto-add tracks when you drop media
  above existing content.)
- **Snap px-tolerance:** not published; typical NLEs use ~8–12px screen-space.
- **Move-ghost:** no source describes a distinct translucent drop-ghost for moving an
  _existing_ clip (CapCut has a toggleable "Live Preview" while dragging). Consistent with our
  finding that library-drag has no drop ghost. Confirm whether MOVING a clip shows a ghost.

## R3 — Track heights (DISCREPANCY with the handoff — confirm with user)

- **CapCut:** track heights appear **fixed and roughly uniform**. **No source confirms the
  main track is rendered taller or that heights are user-adjustable.** The main track is
  distinguished by **position (bottom) + magnetism**, not size.
- **Premiere Pro:** heights fully user-adjustable (drag header divider, Shift+`+`/`-`).
  ([PremiumBeat](https://www.premiumbeat.com/blog/pro-tip-change-track-height-in-premiere-pro/))
- **DaVinci Resolve:** adjustable (drag header top edge, Shift+scroll, view presets).
- **Final Cut Pro:** magnetic primary storyline (like CapCut's magnet); clip height via Clip
  Appearance slider.

→ **The handoff's "main video track is the biggest" is likely a departure from CapCut, not
parity.** Adjustable/differentiated heights are a Premiere/Resolve trait. Decide R3
deliberately: (a) taller main track = a chosen departure, or (b) uniform heights = true CapCut
parity, with the main track distinguished by position + magnet instead.

## R1 — Timeline ruler

Hierarchical, zoom-adaptive tick model
([Blackmagic forum](https://forum.blackmagicdesign.com/viewtopic.php?t=100657),
[Frame.io timecode](https://workflow.frame.io/guide/timecode)):

- **Major labeled ticks** = timecode label (`HH:MM:SS:FF`), taller mark, often a faint
  full-height guide; **minor unlabeled ticks** subdivide between.
- **Zoom-adaptive density:** zoomed in → a tick per frame; zooming out drops minor ticks and
  only labeled majors remain, always on clean multiples (frames → seconds → minutes). Never
  crowd/overlap labels — label interval grows as zoom shrinks.
- **Timecode vs. frame readout:** every frame addressable as `H:M:S:F`; NLEs toggle the readout
  between timecode and absolute frame number (frame count depends on project fps); the ruler
  label format follows that setting.
- **Parity guidance:** target ~80–120px min label spacing, snap label interval to the nearest
  "nice" unit for the current zoom, render 4–5 minor ticks between majors.

## Confidence summary

- **Solid:** main-track-magnet (magnetic-only-on-main + ripple + no-overlap; overlays/audio
  free); snap toggle = N; 3-panel-top + full-width-bottom-timeline shell; zoom-adaptive
  hierarchical ruler; adjustable heights in Premiere/Resolve.
- **Verify in-app (CapCut desktop, ~30 min):** vertical track-commit threshold;
  drag-over-occupied resolution; horizontal snap px-tolerance; distinct move-ghost?; whether
  CapCut's main track is visually taller / heights adjustable.
