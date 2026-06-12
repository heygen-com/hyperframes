# Anti-Patterns

You default to these. Stop.

Each entry: the bad habit, what it produces, what to do instead. Written in the voice of someone who has watched an agent do this 10 times — because we have.

---

## Layout

### You default to center-aligned crown.

`.crown-plane { left: 0; right: 0; text-align: center }` is the template default, and you'll leave it on every video because it worked once. On a subject that sits right-of-center (Jobs in a 16:9 frame), the body eats the middle 60% of the word and "THE BEATLES" becomes "THE \_\_\_ S".

**Before using the default crown**, run the three conditions in [layout-heuristics.md § Crown placement](layout-heuristics.md):

1. Subject centered within 10% of frame center
2. Clean zones ≥ 15% on each side
3. Crown width > subject width + 400px

If any one fails, **move the crown to the larger clean zone** with a narrower container and smaller font. Don't keep centering a word that's about to be 60% occluded.

### You compute text leftmost as `plane_left + padding`.

That's correct for left-aligned. Wrong for the templates you're using, which are **right-aligned** on the main column and **center-aligned** on crowns. The real leftmost depends on the word width.

| Alignment | leftmost_x                                         |
| --------- | -------------------------------------------------- |
| Left      | `plane_left + padding_left`                        |
| Right     | `plane_right − padding_right − longest_line_width` |
| Center    | `plane_center − longest_line_width / 2`            |

Compute it against the **longest wrapped line**, not the whole phrase. "four very talented guys" wraps to 3 lines — the widest is "talented" (~8 chars), not 23.

### You treat `plane_left` as the text's leftmost edge.

It isn't. With `left: 180px` and a right-aligned 468px word, the text starts 104px **before** `plane_left` relative to the plane, but actually lands somewhere inside the plane box. The plane box just sets the coordinate space — the text positions inside it based on alignment. Check the compiled output, not the plane attribute.

### You center text on the frame when the subject is off-center.

Look at the subject's body center, not the frame center. Jobs sits at x=1100 in a 1920 frame. The **scene's** center of gravity is 1100, not 960. Center-aligning text to 960 is center-aligning to the empty left third, not to anything meaningful.

### You copy-paste position values from memory-wall to a new video.

`top: 40, right: 30, width: 720, rotateY: -13` worked for a 1280×720 frame with an acoustic foam wall on the right. It will not work on a 1920×1080 frame with a bookshelf backdrop. Run the 6-item checklist in [scene-types.md](scene-types.md) for the new video before reusing any numbers.

---

## Typography

### You use template default font sizes regardless of column width.

Template defaults (66/78/92/140) are tuned for a ~560px column. When you bump the plane to 700px+ and don't touch the fonts, the captions feel underweight — small text swimming in negative space.

Use the [Font-size × column-width matrix](typography-presets.md). For a 700px column, that's 78/108/128/220 — a 30-40% bump across the board. Re-check pillarbox safety after bumping (bigger right-aligned text extends further left).

### You pick `intro` style for every first caption.

Intro = italic, smaller, contemplative. Fine for filler discourse markers ("You know,", "So,", "Well,"). **Not** for the first line when it's actually the thesis ("I've had this kind of upbringing"). Read the words semantically, not positionally.

### You skip emphasis entirely because "every caption looks clean."

A story without an emph or crown is typographically flat — viewers can't feel the crescendo. Reserve at least ONE emph per video for the line that lands. Skip it only for truly monotone content (policy statements, warnings).

### You give every group its own style.

Style is supposed to signal _hierarchy_. Using `intro`/`phrase`/`emph`/`dream`/`crown` all in one 15-second video means none of them signal anything. Pick 2-3 styles max for a short clip.

### You only use the 5 preset class names.

`intro / phrase / emph / dream / crown` are scaffolding, not a closed set. The canonical `memory-wall.html` uses `cap-1 / cap-2 / cap-3 / cap-4` — **position-indexed** with bespoke typography per position. That's how it achieves the 3-line right-aligned cascade on the climax. You can't express "this cap has a hanging indent at position 2" with `"style": "dream"`.

The `"style"` field in plan.json accepts **any string** — it becomes `class="cap-<string>"`. Define the class in `custom_css`:

```json
"custom_css": ".cap-1 { font-size: 78px; ... } .cap-2 { padding-right: 44px; }",
"groups": [{"id": "cg-0", "style": "1", ...}]
```

When the scene needs per-position bespoke typography, do this. Don't force-fit into `intro / phrase / emph`.

### You regenerate from plan.json when a canonical example already has the answer.

When scene framing matches `references/example-renders/memory-wall.html` or `champion.html`, clone that HTML into `<project>/index.html` and only swap the GROUPS array. Don't re-derive the design from presets — you'll lose the specific per-position typography that took many iterations to validate. See [bespoke-vs-presets.md § The clone-and-tweak workflow](bespoke-vs-presets.md).

---

## Blending

### You default to `mix-blend-mode: overlay`.

Overlay works on **mid-tone** backgrounds. On dark bookshelves (<60 luminance), overlay makes white text render as black. On sunny backgrounds (>180 luminance), overlay blows out. Check the actual luminance of the caption region in a sampled frame. Pick:

- mid-tone surface (60-180) → `overlay`
- dark surface (<60) → `screen`
- bright surface (>180) → `normal` with opaque text

### You animate `letter-spacing` on the word entry.

You saw a "typewriter breath" effect somewhere and added `letterSpacing: "0.04em"` to the `fromTo` "from" state. Result: inline-block reflow every frame → the whole `.cap` line box recomputes → captions visibly jump between rows. See the "Some → line 2" bug from memory-wall.

**Animate only opacity + transform.** If you want a breath effect, use `scale` or `y`, not letter-spacing.

---

## Animation

### You fade both the group container AND each word.

Default feels safer: fade the container in, then fade each word in. But container.opacity × word.opacity produces a non-linear curve — at progress 40% the combined opacity is 16%, not 40%. Visible result: captions seem to "pop" into view around halfway.

Set container opacity to 1 at entrance via `tl.set`, then fade only the words. Single-layer opacity = linear perceived fade.

### You stack captions in a flex column.

Flex-direction: column with multiple `.cap` children looks tidy in source. At runtime, hidden captions (`visibility: hidden`) still reserve flex space. The newly-entering caption shows up at the _bottom_ of the column instead of the designed position — landing in the gesture zone, getting clipped.

Use `position: absolute` for each `.cap` inside the plane so hidden ones don't occupy layout. Both shipped templates do this.

### You start the timeline at t=0.

Caption at exactly t=0 feels like it was there before the video started. Offset 0.1-0.3s (hyperframes motion-principles.md agrees). Same for the very last caption — let it exit before the video fades.

---

## Scene admission

### You trust that "looks like one speaker" = "is one speaker throughout."

TV archive clips cut to B-roll mid-sentence. Interview clips insert cutaways to the interviewer. You didn't check frames beyond the first one, so you rendered captions across a shot transition. Result: captions designed for Subject A are placed relative to Subject B's position (or empty frame) for half the render.

Sample frames at 20%, 50%, 80% BEFORE planning. If the scene changes, trim to the largest single-subject segment.

### You ignore baked-in captions / pillarbox / watermarks.

You saw black bars on the sides and didn't computing the safe-zone. Your captions cross the pillarbox. Or: the source already has burned-in subtitles and you added more — two caption systems fighting for attention.

Run the **letterbox probe** first. If the source has existing captions, refuse with: "source already captioned, adding more would conflict."

### You ship Whisper's transcript without checking timings against the beat.

Transcription is Whisper (via `transcribe.cjs`, no API key) — good word timings, but not infallible: a word can land with a near-zero duration or a timestamp a beat off. This skill is verbatim + on-beat, so `check-timing.cjs --strict` (80ms tolerance) is the gate, not a suggestion — fix drift in `plan.json` before rendering, and never pack two transcript words into one timed entry (the second inherits the first's timestamp and fires early).

---

## Matting

### You enable CoreML for the matting ONNX.

It's the Apple way, obviously faster. No. CoreML partitions the ONNX graph across providers. The mixed-precision boundary produced (observed with the previous RVM engine) alpha=30 inside the subject's face while background correctly reads 0. Captions shine through face. Pin the CPU execution provider only (`onnxruntime-node`). Our `matte.cjs` already does this; don't "optimize" it by re-adding CoreML.

### You pick a matte model by "general vs human."

DECISION FLIPPED 2026-06-12 after a 5-model × 6-scene A/B with caption renders: the matte's job here is CAPTION LAYERING, not prop fidelity. `u2net_human_seg` (via hyperframes `remove-background`) usually excludes thin offset furniture (mic boom arms) from the matte — words stop being sliced by booms, which beat PP-MattingV2's prop-preserving behavior on real caption videos. It is NOT surgical: large salient objects near the subject (telescope rigs) can still leak in — always sample frames_fg/. Known cost: HELD products can drop out intermittently (captions pass in front) — route product-demo climaxes away from held objects. `isnet-general-use` lost outright (backlit-hair collapse). birefnet-portrait (MIT) beat everything semantically (keeps held items AND drops furniture) but is 928 MB / ~7 s-per-frame CPU — a future quality tier, not the default.

---

## Grouping

### You caption every word.

Transcripts are verbose — "you know, um, I, I mean, you know" is 5 words from a single beat. Captioning all of them clutters the screen and breaks reading rhythm.

Editorially drop filler. Use the rules in [caption-grouping.md](caption-grouping.md): merge short fragments, cut repeated discourse markers, keep the meaning, trim the noise. You are writing typography to support speech, not a court transcript.

### You group by fixed word-count.

"3 words per caption, always" makes every caption look the same and fights the natural cadence of speech. Break on sentence boundaries, 250ms+ pauses, and semantic units instead. Caption sizes will naturally vary from 2 words to 5 — that's correct.

---

## The meta anti-pattern

### You read one reference doc and skip the rest.

You'll read this file alone and feel covered. These anti-patterns reference concepts defined in `layout-heuristics.md`, `typography-presets.md`, `scene-types.md`. If you haven't read those, the fix advice here won't make sense.

**Order of reading for a new video**:

1. SKILL.md (decision gate + pipeline + pre-flight probes)
2. bespoke-vs-presets.md (**first check if a canonical example fits — clone if so**)
3. scene-types.md (template selection — all 4 wall conditions)
4. layout-heuristics.md (positions, sides, crown, font scale, pillarbox formula)
5. typography-presets.md (font-size × column-width table, starting points)
6. caption-grouping.md (word → group)
7. **This file last** (to catch yourself before committing to plan.json)

If you're pressed for time, still read this one — it flags the failures you're about to make.
