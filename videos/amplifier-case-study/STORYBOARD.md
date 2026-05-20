# STORYBOARD — Amplifier Case Study Explainer

Beat-by-beat plan. Both cuts (master 16:9 + short 1:1) derive from the same
beat catalog defined here. See `DESIGN.md` for the visual system and
`SCRIPT.md` for narration timing.

## Global guardrails

- Ink canvas every beat. Never invert.
- One signal color dominant per beat (`signal` for the new path; `warn` for
  the old schema/ceiling; `code` for structured data).
- Persistent 1px `signal` hairline along bottom 8% — grows from 8% width
  (Beat 1) → 100% width (Beat 8).
- Ambient motion in every beat (slow pulse on active element, hairline draw,
  ticker, breathing node). No static frames.
- Every beat carries at least one piece of "real" text from the article or
  the codebase — file paths, schema fields, line counts. The truth is the
  proof.
- Master GSAP timeline is paused; each beat is a child timeline.

---

## MASTER CUT (1920×1080 · 87s · 8 beats)

### BEAT 1 — HOOK (0.0s – 7.0s · 7.0s)

**VO:** _(silent — pure type + ambient pad)_

**Concept:** Cold open. The video's thesis as a single sentence delivered
typographically. No chrome, no labels, just words landing on ink.

**Visual layers:**

1. Background: pure `--ink`. A faint `signal` hairline at the very bottom
   begins life at 8% width, anchored left.
2. Headline (center, 96px Inter Tight 500, `--paper`):
   > "Click. Wait two minutes. Get a video that actually looks like your article."
   > Reveals word-by-word over 4.5s (stagger 0.16s, `y: 24 → 0, opacity 0 → 1,
power3.out`).
3. Held for 2s after the last word lands. No supporting text. No CTA.

**Motion:** word reveal only. Ambient: the hairline begins a slow imperceptible
pulse (3% opacity oscillation, 4s loop).

**Exit:** beat-to-beat crossfade over 500ms into Beat 2.

---

### BEAT 2 — TEMPLATE GRID (7.0s – 17.0s · 10.0s)

**VO:** "Three weeks ago, every explainer video our platform made looked
the same." _(starts at 8.0s, ends ~12.5s)_

**Concept:** The before-pillar. A grid of five video thumbnails — different
articles, identical layouts. They cycle/pulse to emphasize sameness.

**Visual layers:**

1. Top-right `mono-s` label in `--paper-muted`: `amplifier / 2026-05-15`.
2. 3×2 grid centered horizontally, anchored ~150px from top. Cells are 480×270
   (16:9). Five filled cells, sixth cell occupied by caption text.
3. Each cell is `--ink-elevated` with a 1px `--ink-line` border. Inside each
   cell, a stylized "fake explainer" — same layout per cell: eyebrow at top
   (24px mono `--paper-muted`), title in middle (40px Inter Tight 500 `--paper`),
   accent bar (4px `--warn`, 60% width) at bottom. Only the _text_ differs across
   cells: "DEV DAY RECAP", "QUARTERLY EARNINGS", "AGENT BENCHMARKS",
   "MODEL UPDATE", "TOOL ROUNDUP".
4. Each cell populates with scale `0.96 → 1` + opacity, staggered 0.12s.
5. Once all 5 are in place (~3s), a 3s hold while a subtle pulse loops
   across all cells in sync — _they all breathe together_. This is the
   visual punch: the sameness is the message.
6. Caption appears in cell 6 at 11.0s (bottom-left of that cell, 56px
   Inter Tight 500 `--paper`):
   > "Every video looked like every other video."
   > Word-by-word reveal, stagger 0.1s.

**Exit:** at 16.5s, the five thumbnails fade to `opacity: 0.3` and one
thumbnail (cell 3) enlarges and zooms toward the camera. Hold zoom into Beat 3.

---

### BEAT 3 — SCHEMA REVEAL (17.0s – 30.0s · 13.0s)

**VO:** "The model only filled in strings. Layout, color, motion — all on us.
The schema was the ceiling." _(starts at 17.5s, ends ~23.0s)_

**Concept:** The intellectual hinge — Part 1. The video the model "made"
dissolves to reveal the JSON schema that constrained it. The schema is the
cage.

**Visual layers:**

1. Continuation from Beat 2's zoom — the enlarged thumbnail occupies the
   left third. At 18.0s, it dissolves (opacity → 0, scale 1 → 1.05, over
   700ms) revealing a code panel beneath.
2. Code panel (anchored left, 720px wide, `--ink-elevated`, 1px `--code-soft`
   border, 28px padding):
   ```
   {
     "eyebrow":        "",
     "title":          "",
     "body":           "",
     "highlight":      "",
     "supportingPoints": [],
     "narration":      ""
   }
   ```
   Keys in `--code`, empty string values in `--paper-dim`. Fields populate
   line-by-line with character reveal, stagger 0.08s per line.
3. Right side: a vertical stack of constraint labels in `mono-m`
   `--paper-muted`, 80px from top:
   - `layout       ← worker`
   - `color        ← worker`
   - `motion       ← worker`
   - `composition  ← worker`
     Each line reveals with a 200ms `power2.out` slide from the right.
4. After the schema and constraint labels are in place (~24s), a `--warn`
   highlight sweeps across the _schema field names_ — each `eyebrow`,
   `title`, `body`, `highlight`, `supportingPoints` briefly glows `--warn`.
5. Big caption appears bottom-center at 26.0s (96px Inter Tight 500 `--paper`):
   > "The schema was the ceiling."
   > Word-by-word reveal, stagger 0.18s. The word _ceiling_ lands in `--warn`.
6. Hold for 2s.

**Motion:** schema fields character-reveal; constraint labels slide-in;
the warn-sweep across schema keys.

**Exit:** at 29.5s, the code panel and constraint labels fade to
`opacity: 0.15`. The "ceiling" caption holds and translates upward as Beat 4
loads underneath.

---

### BEAT 4 — THE DELETE (30.0s – 40.0s · 10.0s)

**VO:** "So we deleted it. Four hundred and fifty-five lines, gone."
_(starts at 31.0s, ends ~34.5s)_

**Concept:** A terminal sequence. The single most satisfying visual in the
video. Subtraction.

**Visual layers:**

1. Full-canvas terminal frame. `--ink-elevated` background, 1px `--ink-line`
   chrome with three traffic-light dots at top-left in `--paper-dim`.
   Terminal title bar: `~/amplifier — apps/web`.
2. Lines fade in one at a time at the top, in `mono-m` `--paper`:
   ```
   $ git log --oneline apps/web/src/lib/explainer-storyboard.ts | head -3
   e0f0f28 chore: storyboard module
   1a2b3c4 feat: explainer interview
   d4e5f6a feat: video pipeline scaffolding
   ```
   Reveal 350ms apart.
3. At ~32.0s, a new prompt line types out, character-by-character (stagger
   0.04s):
   ```
   $ rm src/lib/explainer-storyboard.ts
   ```
4. At ~34.0s, soft SFX "tick" coincides with the line completing. The line
   sits on screen, cursor pulsing.
5. At ~35.0s a new line appears: `$ git diff --stat HEAD~1` and below it
   the line:
   ```
    apps/web/src/lib/explainer-storyboard.ts | 455 ----------------------------
   ```
   The `455` ticks up from `0 → 455` in `--signal`, counter style, over
   1.2s. The `----------------------------` segment draws right-to-left
   in `--signal`.
6. At ~37.5s, a final line types: `$ git commit -m "delete the ceiling"`
   in `--paper` then turns `--signal` briefly on Enter, then fades.
7. Hold for 1.5s on the completed terminal before Beat 5.

**Motion:** typed character reveals; counter tick; line draws.

**Exit:** terminal collapses inward (scale `1 → 0.4`, opacity `1 → 0`,
650ms `power3.inOut`) and reveals an architecture canvas underneath.

---

### BEAT 5 — NEW PIPELINE (40.0s – 58.0s · 18.0s)

**VO:** "Now the worker reads the brief, calls the model, and the model
writes the whole composition. We validate. We retry. We ship."
_(starts at 41.0s, ends ~49.0s)_

**Concept:** Architecture diagram comes alive. The new pipeline as a flow
of activating nodes connected by drawn hairlines.

**Visual layers:**

1. Top-right `mono-s` label: `amplifier-video-worker / 2026-05-19`.
2. Nine nodes arranged left-to-right in two rows. Each is a `--ink-elevated`
   pill with 1px `--ink-line` border, 32px tall, label inside in `mono-m`:

   Row 1 (top, the request path):

   ```
   [interview] → [brief] → [SQS] → [worker]
   ```

   Row 2 (bottom, the authoring loop, anchored under [worker]):

   ```
   [LLM composes] → [validate] → [render] → [MP4]
   ```

   With an arrow looping from [validate] back to [LLM composes], labeled
   `linter stderr → retry`.

3. **Sequence (0–8s of beat):**
   - t=0.0: [interview] activates (border `--signal`, fill `--signal-soft`,
     400ms fade-in). Hairline draws from [interview] → [brief] (400ms).
   - t=0.6: [brief] activates. Hairline → [SQS].
   - t=1.2: [SQS] activates. Hairline → [worker].
   - t=1.8: [worker] activates with a brief 600ms `--signal` pulse.
     Worker spawns a vertical hairline downward to Row 2.
   - t=2.4: [LLM composes] activates. Real code snippet (8 lines, the LLM
     authoring prompt summary) types into a small `--ink-elevated` panel
     to the right of Row 2.
   - t=4.0: [validate] activates. The retry arrow draws back to [LLM
     composes], its label appearing.
   - t=5.0: The retry loop _flashes_ twice — [LLM composes] → [validate]
     → [LLM composes] — each cycle 600ms.
   - t=6.5: [render] activates. The retry loop dims to background.
   - t=7.5: [MP4] activates. A small MP4 thumbnail (just a tinted rectangle
     with a play triangle) appears next to it.

4. Bottom-left caption appears at 50.0s in `display-m` `--paper`:

   > "The worker authors the whole composition."
   > Word-by-word reveal.

5. Hold the full diagram + caption for 5s. Subtle ambient pulse on the
   retry arrow continues throughout the hold.

**Exit:** the diagram contracts to fill only the top 60% of the canvas
(scale `1 → 0.85`, translate down 60px), making room for Beat 6 to draw
underneath.

---

### BEAT 6 — THE FALLBACK (58.0s – 66.0s · 8.0s)

**VO:** "The old template renderer is still there. Underneath. A floor we
can trust. So the ceiling can be ambitious." _(starts at 58.5s, ends ~64.0s)_

**Concept:** The architecture is still on screen, contracted. A _floor_
draws in beneath it, visualizing the template renderer as a safety net.

**Visual layers:**

1. Above (carried from Beat 5): the contracted pipeline diagram, dimmed to
   60% opacity.
2. A horizontal hairline draws across the canvas at ~75% vertical, in
   `--ink-soft`, full width. 600ms.
3. Below it, a labeled `--ink-elevated` block draws in (full width, 120px
   tall, 1px `--ink-line` border). Center label, `mono-l` `--paper-muted`:
   `template renderer (fallback)`. The block has a subtle 8px-thick
   "foundation" indicator beneath it — like a base plate.
4. Dotted hairlines connect [MP4] from the upper diagram down into the
   fallback block, indicating "this is the path we fall back to".
5. Bottom-left caption appears at 61.0s:
   > "Floor solid. Ceiling ambitious."
   > `display-m` Inter Tight 500 `--paper`. The word "Floor" reveals in
   > `--paper`, "Ceiling" reveals in `--signal`.
6. Hold for 2s.

**Exit:** entire architecture (upper + lower) fades to `opacity: 0` over
600ms, ink canvas clears.

---

### BEAT 7 — BESPOKE GRID (66.0s – 78.0s · 12.0s)

**VO:** "Now every video is its own thing. Same runtime. Different design."
_(starts at 66.5s, ends ~71.0s)_

**Concept:** The after-pillar. The 3×2 grid returns, but every thumbnail
is visibly different — different palettes, different layouts, different
motion suggestions. The opposite of Beat 2.

**Visual layers:**

1. Top-right `mono-s` label: `amplifier / 2026-05-19+`.
2. Same 3×2 grid as Beat 2 (same cell dimensions, same positions). Five
   filled cells, sixth holds caption.
3. **Each thumbnail is visually distinct:**
   - Cell 1: warm-cream background, large serif title, photo-grid layout.
   - Cell 2: deep navy gradient, oversized number ("42%") + small caption.
   - Cell 3: monochrome paper, hand-drawn-style accent lines, manifesto type.
   - Cell 4: gradient mesh background, isometric icon grid (5 small icons).
   - Cell 5: dark mode terminal aesthetic, mono type, signal-green accent.

   Each cell renders as actual HTML inside the cell (not screenshots) — Inter
   Tight + JetBrains Mono variations, different background-gradient or solid,
   different layout primitives. The "five different artists" effect.

4. Cells populate one-by-one (stagger 0.4s), with brief ambient motion
   inside each — a counter ticking in Cell 2, a slow drift in Cell 4, a
   pulsing accent dot in Cell 5. Cells _feel alive_ unlike Beat 2's static
   uniformity.

5. Caption appears in cell 6 at 73.0s:
   > "Now every video is its own thing."
   > Same type treatment as Beat 2's caption (intentional callback).

**Exit:** all five cells fade simultaneously to `opacity: 0` while caption
text persists and translates to center. 600ms.

---

### BEAT 8 — LESSON (78.0s – 87.0s · 9.0s)

**VO:** "The shape of the schema is the shape of the ceiling."
_(starts at 78.5s, ends ~82.5s)_

**Concept:** The thesis statement, big. Then a quiet CTA.

**Visual layers:**

1. Canvas: pure `--ink`. The persistent hairline now spans the full 100%
   bottom width in `--signal`.
2. Center pull-quote, `display-xl` (168px) Inter Tight 600, `--paper`:
   > "The shape of the schema
   > is the shape of the ceiling."
   > Two lines, center-aligned, line-height 1.05. Word-by-word reveal with
   > `power3.out`, stagger 0.18s. The word "ceiling" lands in `--warn`,
   > the word "shape" lands in `--signal` (so the contrast is encoded into
   > the type itself).
3. Hold the pull quote for 3s.
4. Below the quote at 84.0s, a thin CTA appears in `mono-m` `--paper-muted`:
   ```
   read the full case study →
   ```
   Fade-in 600ms. No URL — the article context provides it.
5. Hold for 2s on full state, then fade entire canvas to black over 600ms.

**Exit:** end of video.

---

## SHORT CUT (1080×1080 · 30s · 4 beats)

The short cut is _not_ a separate composition — it is a recomposed selection
of the master beats, rebuilt for the 1:1 frame. Same visual system, same
typography, same accents.

### SHORT BEAT 1 — TEMPLATE GRID (0.0s – 8.0s)

Adapted from Master Beat 2. The grid is now a 2×2 instead of 3×2 (four
templated thumbnails, no caption cell — caption is full-width across the
bottom):

```
+---+---+
| 1 | 2 |
+---+---+
| 3 | 4 |
+---+---+

"Every video looked the same."
```

**VO:** "Three weeks ago, every explainer video looked the same."
_(starts at 1.0s, ends ~6.0s)_

### SHORT BEAT 2 — THE DELETE (8.0s – 14.0s)

Adapted from Master Beat 4. Same terminal sequence but compressed to ~6s:

- `rm explainer-storyboard.ts`
- `−455 lines` ticker

**VO:** "So we deleted it. Four hundred and fifty-five lines, gone."

### SHORT BEAT 3 — BESPOKE GRID (14.0s – 24.0s)

Adapted from Master Beat 7. Same 2×2 grid but with five different bespoke
thumbnails (only 4 fit). Caption full-width: "Now every video is its own thing."

**VO:** "Now every video is its own thing."

### SHORT BEAT 4 — LESSON (24.0s – 30.0s)

Adapted from Master Beat 8. Pull quote sized for 1:1: 96px Inter Tight 600,
two lines, center-anchored. CTA below.

**VO:** "The shape of the schema is the shape of the ceiling."

---

## Production notes

- Build the master cut first beat-by-beat. Lint and validate each beat HTML
  before moving on (`npx hyperframes lint && npx hyperframes validate`).
- Compose the master `index.html` once all 8 beats are stable.
- Render the master MP4.
- Build the short cut by recomposing selected beats for 1080×1080.
- Render the short MP4.
- Both renders should be byte-stable; if BeginFrame fallback to screenshot
  occurs on macOS that's expected — output should still be correct.
