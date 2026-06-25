# Asset treatments — weaving user media onto the beat spine

When the user supplies images/videos, a group can be an **asset treatment** instead of a
typographic template/free-compose. Assets are an **additive ingredient on the same beat
spine** — never a separate pipeline. Typography/templates stay the floor: if no asset fits a
group, fall back to a template/free group (a complete video needs zero assets).

The planner (Step 3) picks the treatment and the clips + anchors (WHAT); the frame-worker
realizes it inside the frame file (HOW). **Obey the frame's `pacing`.**

## The three treatments

### `beat_cut` — one clip per anchor (only on a `beat_cut` frame)

The asset-driven analogue of a per-onset typographic group: cut to a new clip on each anchor
(the frame's beats/onsets from the audiomap). Each clip is a `class="clip"` element
(`<img>` for a photo, **muted** `<video>` for a motion clip) placed at its anchor with
`data-start`/`data-duration`/`data-track-index` per the core clip contract. Between clips,
crossfade the outgoing content to `opacity:0` ending **at** the next anchor, then immediately
**hard-kill** with a `tl.set(..., {opacity:0}, anchor)` — this pair is required (the
`gsap_exit_missing_hard_kill` lint rule; non-linear seeking otherwise bleeds stale frames).
Cut on the **strong** anchors; land a hero clip on a `key_moment`/downbeat.

### `ken_burns` — slow push on one clip (fits a `phrase_flow` frame)

For calm frames: one clip held over the span with a slow scale/translate push (e.g. scale
1.0→1.08 + a small drift) eased across the whole `span_sec` — paced by the frame, not by
beats. No hard cuts. Crossfade in/out at the frame edges. This is the right asset treatment
when the beat grid is unreliable (calm music).

### `bg_under_text` — clip dimmed behind a template/free group

A full-bleed clip dimmed ~30–50% as the background of a group whose foreground is a template
or free-compose typographic treatment. The text rides on the same anchors; the clip is the
bed. Use when the user wants their footage present but the message must stay readable.

## Rules

- **`pacing` decides the treatment**: `beat_cut` only on a `beat_cut` frame; on a
  `phrase_flow` frame use `ken_burns` or a slow crossfade — **never** per-onset hard cuts on
  the (unreliable) calm grid.
- **Clips are muted; the root owns audio.** Mount each `<video class="clip">` **muted**, as a
  direct child of the frame root (never nested in another timed element, or the renderer
  freezes it). The BGM is the only audio in v1.
- **Crossfades animate `opacity`/`autoAlpha`**, never `visibility`/`display` on a `.clip`
  (the framework owns clip visibility — that trips `gsap_animates_clip_element`).
- **Backgrounds dim ~30–50%** so any foreground text stays legible.
- Anchors are **track seconds from `audiomap.json`**; the worker subtracts the frame start
  to get frame-local time.
- Local staged assets only (`assets/` via `stage-assets.mjs`); never remote URLs.

## Deferred hook (not v1)

A clip that should play **its own sound** (interview cut, lyric clip) needs a sibling
`<audio>` mounted at the **root** by the assembler, with the BGM ducked under it (timeline
volume automation: `tl.to("#el-bgm",{volume:0.15,…},clipStart)` … `tl.to(…,{volume:0.9,…},
clipEnd)`). The frame-worker mounts no audio. Keep clips muted in v1; wire clip-audio +
ducking only when the user asks.
