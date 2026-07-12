# Rail track — standard lower-third subtitle

The **default** caption track and the workhorse: a clean, readable subtitle that sits **in
front** of everything (never occluded by the matte) in the lower third. It carries **most**
of the transcript. It is deliberately **plain** — the cinematic craft (planes, occlusion,
Vogue-masthead, accumulation) lives in the _embed_ track only ([composition-craft.md](composition-craft.md)).

For talking-head / explainer / voiceover, the typical output is **the whole transcript on the rail**
with only the climax(es) promoted to embed. Rail is not a fallback — it's the baseline.

> **Implementation note.** A dedicated rail renderer is the next build step. The rail is a
> plain `fg` caption track and maps cleanly onto hyperframes' native caption pipeline
> (`media-use` captions) — prefer reusing that over hand-rolling. Until wired, render
> the rail as a simple `data-caption-layer="fg"` composition (no matte overlay for these caps).

## Position & safe area

- **Lower third, horizontally centered.** Landscape (16:9): baseline ~80–120px above the
  bottom edge. Portrait (9:16): lower-middle, ~ 600–700px from the bottom (clear of platform UI).
- **Title-safe margins:** keep text within ~90% width / inside any letterbox-pillarbox bars
  (see the letterbox probe). Never flush to the frame edge.
- **One caption group on screen at a time.** No accumulation, no cascade — that's embed-track behaviour.
- It rides above the subject; the matte does **not** occlude it (rail = in front).

## Lines, length, timing

- **≤ 2 lines.** Broadcast target ~ 32–42 chars/line; break at a clause/phrase boundary, never
  mid-word, never leave a dangling 1-word line.
- **Word-synced.** Each group's window envelops its words (`group.in ≤ first word.start`,
  `group.out ≥ last word.end`); each group ≥ 0.5s on screen; ~1.5s min gap discipline so it
  doesn't strobe. Word timings within 80ms of transcript (same gate as everywhere).
- **Grouping** = short readable phrases (see [caption-grouping.md](caption-grouping.md)) — not the
  embed track's "phrase = composition" rule; here it's just legible subtitle chunking.

## Look (restrained on purpose)

- **Size: ~`calc(0.045 * var(--h))`** (≈48px @1080, ≈58px @1290) — readable, _not_ hero. The rail is a subtitle; it is deliberately much smaller than the embed body/climax. Express as a `var(--h)` fraction (never hardcode px) so it scales across resolutions. The embed climax is sized to the frame independently (see composition-craft § POP) — **never** size the climax as a multiple of this rail.
- One clean sans (Inter / Helvetica Now / Neue Haas), weight 500–600; white (or near-white).
- **Legibility without grading the video:** a tight text treatment local to the glyphs only —
  a soft dark drop-shadow, or a subtle rounded gradient pill / 30–40% scrim **sized to the text
  box** (not a full-frame bar, never a frame-wide grade). On luminance > 180 backgrounds, keep
  the scrim; never rely on bare light text.
- Motion is minimal: 150–250ms fade-up in / fade-down out. No glitch, no scale-pop, no per-word
  choreography on the rail — that energy is reserved for embed.

## The `emphasis` flag (active-word highlight)

The only intensity the rail carries. When a word is graded `emphasis` (the 1–2 punch words in a
phrase), give it an **inline** lift on the rail — accent colour and/or +weight, optionally a
karaoke-style active-word pop (≤1.1× scale) as it's spoken. Keep it inline; it does **not**
leave the rail. Anything that wants to leave the rail is an `embed`, not an emphasis.

## What the rail never does

- Never goes behind the subject (that's embed).
- Never accumulates into a multi-line poem (that's embed).
- Never crosses the face / uses occlusion as an effect.
- Never grades or textures the underlying video.
- Doesn't drop content to "fit fewer blocks" — split into more groups instead. The only drops
  are filler (um/uh, exact stutters, self-corrections); dense conversational `narrator` glue
  ("you know", "sort of") may be trimmed for readability, content/structure words stay.

## Hand-off to embed

Rail + embed coexist in one render: the rail runs the whole clip; an embedded peak appears over
it at its moment (the rail can briefly clear or dim under the embed if they'd collide). Decide
which phrases promote via the role read in SKILL.md § Caption model; author the promoted ones
with [composition-craft.md](composition-craft.md).
