# Aesthetic Principles for Cinematic Captions

The 18 rules that separate "designed" caption work from "preset-generated" caption work. This is the single most important reference in the skill — every plan.json and every Standard-mode HTML should be checked against these before committing.

The whole competitive thesis: every AI caption tool in 2026 (Veed, Submagic, Opus Clip, Captions.ai, CapCut) is a **preset picker**. They hand the user a box of crayons. This skill is a **director** — it exercises judgment. Beat them on taste, not feature count.

---

## The 18 rules

### 1. The subject always wins

Captions exist to serve the face, not compete with it. If the caption draws the eye before the speaker, the caption has failed. **Before shipping any plan.json, ask: "does the caption or the subject read first?"** If caption wins, shrink, dim, or move it.

### 2. Occlude, don't hover

World-class caption design puts text _into_ the scene. Letters that pass behind a shoulder, mic, or head feel diegetic. Letters that float uniformly above the lower-third feel like PowerPoint. Use the matte pipeline — that's the moat over every competitor.

### 3. Contrast is a hierarchy problem, not a brightness problem

A white box behind text is a failure of taste. Priority order:

1. `mix-blend-mode: overlay` or `screen` picking up scene luminance
2. 2–3px dark stroke + soft drop shadow
3. Narrow semi-opaque gradient bar (NOT a solid box)
4. Dim the background plate by 10–15% locally
5. (LAST RESORT) A hard white pill box — banned on cinematic directions

### 4. Kill the constant lower-third

Fixed-bottom captions are monotone. Caption zone shifts with shot:

- Tight close-up → upper sidebar or crown
- Mid-shot → embedded on back wall / foam / whiteboard
- Wide → classic lower-third offset to non-subject side

### 5. One family, two weights maximum

Hierarchy lives in **weight** (e.g., 500 → 800), not in **font**. Mixing Montserrat + script + serif in one clip is the #1 amateur tell. Ship Inter, SF Pro, Söhne, GT America, Aktiv Grotesk, or Neue Haas Grotesk with ≥5 weights and compose with weight + size.

### 6. Tracking tightens as size grows

Display-size (>40pt) wants negative tracking (-10 to -30 units, or `-0.015em` to `-0.035em`). Body-size (14–20pt equivalent) wants positive tracking (+5 to +15, or `+0.005em` to `+0.015em`). Apple SF Pro's optical-size model is the reference. Submagic defaults do the opposite — they look cheap because of it.

### 7. Cap height ≈ 3.5–5% of frame height for body captions

- 1080p vertical (1920 tall): body 65–95px, emph/hook 130–170px
- 1080p landscape (1080 tall): body 40–55px, emph 70–100px
- Hormozi-size (~7–9% of frame) is **hook** size, not body size. Reserve for punchlines.

### 8. Never italicize for emphasis in video text

Italics are a **print** convention for flow inside a paragraph. On 24fps motion they read as "tilted" not "stressed". Emphasize with weight (extrabold), color (single accent), or size (1.3–1.6×). Italics allowed only for:

- Literal quotation of written material
- Foreign word
- Thought vs spoken dichotomy

### 9. Color discipline: one hue + neutrals

Pick **one** saturated accent per video for keyword highlights. Hormozi's yellow+green+red works for him because his content is already loud. Cinematic = single accent + white/bone/charcoal. Default palette:

- Warm white `#F5EFE6` on dark
- Graphite `#1A1A1A` on light
- Accent chosen from scene sampling

### 10. Animate transform only, never the letter itself

`letter-spacing`, `filter:blur`, `font-weight` animations cause inline-block reflow → line-jumps. Animate `translateY`, `scale`, `opacity`, `clip-path`. This is locked from the embedded-captions debugging.

### 11. Minimum 0.4s per word visible

BBC reading speed is 160–180 wpm (0.33–0.38s/word). Cinematic feel wants more breathing room — 200–220ms stagger per word, hold full phrase 0.4–0.6s before exit. Entries under 150ms read as frantic.

### 12. Stagger is the primary expressive axis

Same phrase, different stagger, totally different feel:

| Stagger | Feel                             |
| ------- | -------------------------------- |
| 40ms    | machine-gun, urgent, TikTok-hook |
| 80ms    | conversational, default          |
| 150ms   | deliberate, documentary          |
| 250ms+  | poetic, ceremonial               |

Pick from content tone, not default to one value.

### 13. Emphasis escalates _within_ a phrase, not _between_ phrases

Every word bolded = no emphasis. Structure:

- 70% plain body
- 20% slight lift (color OR weight, not both)
- 8% full emphasis (bigger, brighter, held longer)
- 2% climax (biggest, held 1.5s, breath before + after)

### 14. Break rhythm once per 30s

Every-word-same-way = eye adapts, stops registering motion. Plant a rhythm-break every ~30s:

- Phrase enters from opposite direction
- A single word at 2× size
- A beat of pure silence with no caption
- A color shift

This is what separates Submagic-preset work from something designed.

### 15. Caption what adds, cut what restates

Transcribe everything. **Display** 70–85%. Remove:

- Filler ("um", "like", "you know", "I mean")
- Self-corrections ("I think... I mean actually...")
- Obvious visual echoes ("as you can see here" while pointing)

Editorial judgment — no existing AI caption tool does this. It's pure upside.

### 16. Segment on breath, not on duration

Chunk at natural pauses ≥ 250ms. A caption spanning a breath-break feels wrong. Whisper word-level timestamps make this trivial.

### 17. Safe zones per platform, always

- Use the safe boxes and caption bands in `/hyperframes-studio` (Safe zones) for wide and vertical
  framings; that skill owns the values.

Bake into the layout solver. Never eyeball.

### 18. Letterbox/pillarbox is caption real estate

Black bars on 9:16 from 16:9 source? Those bars are the caption home. 2.35:1 cinematic frame on 16:9 export? Serif quotation in the letterbox reads as documentary.

---

## Rhetorical judgment rules (editorial)

These are the "what to caption" decisions. No existing tool exercises them.

- **Filler suppression** — off/light/strong. Default: light for documentary, strong for vlog.
- **Self-correction folding** — display only the final version.
- **Breath-group segmentation** — split on silences >250ms, never mid-phrase.
- **Semantic emphasis** — LLM-pass per phrase: "which 1–2 words carry the meaning?" Highlight those. Don't default to stressed syllables or loudest words.
- **Silence honor** — if speaker pauses 1.5s+ for rhetorical effect, don't back-fill with lingering prior caption. Let silence breathe.
- **Quote-sensing** — "he said, quote…" or air quotes → italic (one of the allowed italic exceptions).
- **No `[laughs]` / `[sighs]`** — those are accessibility captions. For aesthetic captions, they pollute the frame.

---

## Self-critique checklist (run before rendering)

The agent's own pre-render pass. Flag violations:

- [ ] Does the caption or subject read first? (Rule #1)
- [ ] Any hard white pill boxes? (Rule #3 — banned on cinematic)
- [ ] Still lower-third for a close-up? (Rule #4)
- [ ] More than 2 weights or more than 1 font family? (Rule #5)
- [ ] Italic used for emphasis? (Rule #8 — banned)
- [ ] More than 1 saturated accent color? (Rule #9)
- [ ] Letter-spacing or filter:blur animating? (Rule #10 — banned)
- [ ] Stagger same for documentary and vlog? (Rule #12)
- [ ] Every group emphasized? (Rule #13)
- [ ] 30s+ with no rhythm-break? (Rule #14)
- [ ] Displaying every filler word? (Rule #15)
- [ ] Caption crossing breath-break? (Rule #16)
- [ ] Caption in platform UI zone? (Rule #17)

Any "yes" to a violation question → regenerate the affected segment.
