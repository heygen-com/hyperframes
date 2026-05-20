# DESIGN — Amplifier Case Study Explainer

Visual system spec for the explainer video accompanying the Substack case study
_"We Pulled the Storyboard Module — and Got Better Videos."_

Two cuts share this design system:

- **Master cut**: 1920×1080 @ 30fps, ~87s, full narrative arc (8 beats)
- **Short cut**: 1080×1080 @ 30fps, ~30s, distilled (4 beats)

## Concept

Editorial dev-blog aesthetic — dark canvas, paper-on-ink type, monospace
typography for code/labels, sans-serif display for headlines. Restraint is the
design language; the _idea_ should be louder than the chrome.

The video has two structural pillars (Beat 2 _Template Grid_ and Beat 7
_Bespoke Grid_) that mirror each other. Everything in between is the rotation
from one pillar to the other.

## Palette

```css
/* Ink scale (backgrounds + surfaces) */
--ink: #08090b; /* page background */
--ink-elevated: #12141a; /* cards, terminals, thumbnails */
--ink-line: #1f232c; /* hairlines, borders */
--ink-soft: #2a2f3b; /* hover/active borders */

/* Paper (foreground text) */
--paper: #f5f2ec; /* primary text */
--paper-muted: #8b8e96; /* secondary text, labels */
--paper-dim: #5a5e68; /* tertiary, placeholder */

/* Accents (semantic) */
--signal: #22d67a; /* "the right answer" — the new path, success */
--signal-soft: rgba(34, 214, 122, 0.15);
--warn: #f4a641; /* "the trap" — schema bars, the ceiling */
--warn-soft: rgba(244, 166, 65, 0.18);
--code: #7dd3fc; /* code tokens, JSON keys, structured data */
--code-soft: rgba(125, 211, 252, 0.15);
```

**Rules**:

- Only one accent dominant per beat. Never two accents fighting.
- `signal` belongs to the _new pipeline_. `warn` belongs to the _old schema_.
- `code` shows up wherever real text from the codebase appears.

## Typography

```css
/* Display — headlines, pull quotes, hook */
--font-display: "Inter Tight", "Inter", system-ui, sans-serif;

/* Mono — code, terminals, labels, file paths, structured data */
--font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
```

**Sizes** (1920×1080 master; scale down proportionally for 1:1):

| Class        | Size  | Weight | Tracking | Use                           |
| ------------ | ----- | ------ | -------- | ----------------------------- |
| `display-xl` | 168px | 600    | -0.02em  | The lesson quote (Beat 8)     |
| `display-l`  | 120px | 500    | -0.015em | Hook headline (Beat 1)        |
| `display-m`  | 96px  | 500    | -0.01em  | Beat captions                 |
| `display-s`  | 64px  | 500    | -0.005em | Secondary captions            |
| `body`       | 32px  | 400    | 0        | Annotations                   |
| `mono-l`     | 28px  | 500    | 0        | JSON schema field names       |
| `mono-m`     | 22px  | 400    | 0        | Terminal commands, file paths |
| `mono-s`     | 14px  | 500    | 0.04em   | UI chips, labels              |

**Pairings**:

- Display headline + mono label above (e.g., `worker / authoring →` above a
  bold caption).
- Mono code lines stack tight (1.4 line-height); display headlines stack
  airy (1.05 line-height).

## Spatial system

- 12-column grid, 80px gutters, 96px outer margin (1728px content width).
- Type anchors:
  - **Hook (Beat 1)** and **Lesson (Beat 8)**: center-anchored, full canvas.
  - **All other beats**: bottom-left anchor for primary caption, top-right
    anchor for supporting metadata.
- Persistent hairline element: 1px `signal` line traversing the bottom 8% of
  the canvas in every beat. **Grows** in length as the video progresses,
  starting at 8% width in Beat 1 and reaching 100% width by Beat 8.
  Visualizes "the pipeline coming online."

## Motion language

Default ease: `power3.out` for entrances, `power3.inOut` for transitions,
`power2.inOut` for ambient.

| Motion                   | Properties                                | Duration        |
| ------------------------ | ----------------------------------------- | --------------- |
| Word-by-word reveal      | `y: 24 → 0, opacity 0 → 1`, stagger 0.06s | per word ~250ms |
| Character reveal (code)  | `opacity 0 → 1`, stagger 0.02s            | per char ~150ms |
| Line draw (architecture) | `strokeDashoffset: full → 0`              | 700ms           |
| Thumbnail grid populate  | scale `0.96 → 1`, opacity, stagger 0.08s  | 500ms each      |
| Beat hold                | full state held                           | ~1.5s minimum   |
| Beat-to-beat transition  | cross-fade or wipe                        | 400–600ms       |

**Hard rules**:

- Every beat has a ≥1.5s hold at full state before transitioning.
- No element moves without purpose. Ambient motion is OK (slow pulse on the
  active node, the green hairline drawing); decorative motion is not.
- GSAP master timeline is **paused** and registered on
  `window.__timelines["amplifier-case-study-master"]` (and `-short` for the
  square cut). Each beat owns its own child timeline, added to the master
  at the beat's start time.

## Sound design

- **Voice (required)**: ElevenLabs TTS. Mid-age male, calm-confident, slight
  dry edge on Beat 3 and Beat 8 (the contrarian beats). Manifesto-register —
  economy of words. Same voice family as `synapse-os-explainer` so the two
  pieces feel related. Fallback if ElevenLabs is unavailable: local Kokoro
  TTS via the `hyperframes-media` skill (`bm_george` or `am_eric` preset).
- **Music (nice-to-have, not blocking v1)**: a single sustained pad at
  –22 LUFS, never lifts. If a permissive-license pad isn't on hand, ship
  v1 with narration only — silence between sentences is part of the design
  language. A piano figure (Beat 5 → Beat 8) is a v1.1 enhancement.
- **SFX (one cue)**: a soft "tick" on the −455 counter (Beat 4). Generated
  inline via Web Audio API as a 600Hz square-wave envelope (200ms total),
  no external asset required.

## Asset list

- **Fonts**: Inter Tight (Google Fonts CDN), JetBrains Mono (Google Fonts CDN).
- **Narration**: generated via the `hyperframes-media` skill or ElevenLabs
  directly. Files at `videos/amplifier-case-study/narration/`.
- **Music**: none required for v1. If a permissive-license ambient pad is
  located, drop it at `narration/underscore.mp3` and the composition will
  mix it at –22 LUFS under the narration.
- **SFX**: synthesized inline via Web Audio API (no external file).
- **Code snippets**: shown abbreviated. Schema field names in Beat 3 are
  the literal field names from the deleted `explainer-storyboard.ts`
  (`eyebrow`, `title`, `body`, `highlight`, `supportingPoints`, `narration`).
  No screenshots — all type rendered live for crispness at 1080p.

## What this design is NOT

- Not a brand piece. No company logo, no Trilogy AI CoE branding. The hook is
  the _idea_, not the institution.
- Not a feature demo. The video sells the _story_ in the article — not
  Hyperframes itself. Hyperframes' capability is implicit in the production
  quality.
- Not narration-led. The voice is sparse (~110 words total). Visuals carry
  most of the runtime; the words are punctuation.
