---
name: cut-the-curve
description: "The technique catalog: five velocity-matched SEAMS (zoom-through, INVERSE zoom-through, cut-the-curve, waterfall cut, rack-focus blur-cut) plus the two in-scene techniques — waterfall ENTRY (staggered arrival cascades for title cards / segment openers) and the nudge curve (slow-fast-slow three-phase group slides). Covers partial-travel (~12% of frame) velocity matching via mirrored power4 eases, the Z scale-sign rule, size-scaled blur (10px text / 18-20px full-frame), word-by-word staggered cuts, cascade pacing by element weight, and the 10/65/25 slide ratio. Read before authoring any transition, text-beat handoff, kinetic text entry, or group reposition. [depth, zoom, inverse-zoom, scale-sign, mirrored-zoom, rack-focus, pacing, velocity, cut-the-curve, waterfall, stagger, cascade, kinetic-text, title-card, segment-opener, nudge, slide, easing, group-motion, z-depth, motion-graphics, cinematic, transition, blur, directional-continuity]"
---

# Cut the Curve — the technique catalog

Five SEAM techniques, one principle: **cut at peak velocity, match direction and speed
on both sides of the cut.** The seam LAW — vector law, the current, the ledger, the Seam
Gate — lives in `motion-doctrine`; read it first. Each technique below is one
self-sufficient file (parameters + mechanics + anti-patterns + GSAP templates): read
**only the file for the seam you are authoring** — the shared law rides in
`seams/_seam-law.md`. Frame-packet builders inline cited seam files automatically.

## Catalog

| #   | Technique                  | Scope                   | Axis                | Use for                                                | Recipe                          |
| --- | -------------------------- | ----------------------- | ------------------- | ------------------------------------------------------ | ------------------------------- |
| 1   | **Zoom-Through** (forward) | Within-scene text swap  | Z, toward viewer    | progressing deeper into the same thought               | `seams/zoom-through.md`         |
| 2   | **Inverse Zoom-Through**   | Arrival / payoff beat   | Z, away from viewer | something bigger lands                                 | `seams/inverse-zoom-through.md` |
| 3   | **Cut the Curve**          | Between scenes          | X / Y               | the default boundary, the film's current               | `seams/cut-the-curve.md`        |
| 4   | **Waterfall Cut**          | Text-to-text seam       | X, per-word         | word-level handoff between big-text beats              | `seams/waterfall-cut.md`        |
| 5   | **Rack-Focus Blur-Cut**    | Same-surface state swap | X / Y / Z           | the one cut you want SEEN — a DSLR focus-pull flourish | `seams/rack-focus-blur-cut.md`  |

The two in-scene techniques (no seam) are hyperframes-animation rules now —
packet-inlinable like any other rule:

| #   | Technique           | Scope                | Recipe                                           |
| --- | ------------------- | -------------------- | ------------------------------------------------ |
| 6   | **Waterfall Entry** | In-scene ARRIVAL     | `hyperframes-animation/rules/waterfall-entry.md` |
| 7   | **Nudge Curve**     | In-scene group slide | `hyperframes-animation/rules/nudge-curve.md`     |

## Choosing a Variant

|               | Zoom-Through                 | Inverse Zoom                 | Cut the Curve          | Waterfall Cut          |
| ------------- | ---------------------------- | ---------------------------- | ---------------------- | ---------------------- |
| Scope         | Within-scene text swap       | Arrival/payoff beat          | Between scenes         | Text-to-text seam      |
| Z sign / axis | growing (push)               | shrinking (pull)             | X / Y                  | X, per-word            |
| Travel/scale  | 1→1.2, then 0.75→1           | 1→0.8, then 1.25→1           | ±230px                 | ±230px                 |
| Peak blur     | 10px text / 18–20 full-frame | 10px text / 18–20 full-frame | 8–10px optional        | none                   |
| Eases         | power3.in / expo.out         | power3.in / expo.out         | power4.in / power4.out | power4.in / power4.out |
| Feel          | progressing through          | arriving at                  | carried sideways       | a wave across the seam |

## Cross-variant law (full text: `seams/_seam-law.md`)

- **Z direction is a sign** — d(scale)/dt must match across the cut: push = growing both
  sides, pull = shrinking both sides. Banned mirrors: receding exit → grow-from-small
  entry; push exit → oversized retraction. Binds the incoming scene's OWN entrances in
  the seam window (cut + ~0.5s). Verify per Seam Gate rule 7.
- **Blur** — 10px text-scale / 18–20px full-frame, same peak both sides, wrapper only.
- **One current** — never consecutive boundaries in opposing directions; reserved
  vectors spent on meaning. Scene cuts without cut-the-curve: it IS the default boundary.
- **Stage ground** — opaque `#root` behind every mid-window cut.
