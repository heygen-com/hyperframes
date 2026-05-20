# SCRIPT — Amplifier Case Study Explainer

Narration script for both cuts. ElevenLabs TTS. Voice: mid-age male,
calm-confident, slight dry edge on the contrarian beats (Beat 3 and
Beat 8). Manifesto-register. Same voice as `synapse-os-explainer` for
sibling-piece consistency.

## Master cut (87s · 110 words narration · ~44s of audio · ~50% silence)

### Beat 1 — HOOK (0.0s – 7.0s)

_(silent — type-only)_

### Beat 2 — TEMPLATE GRID (7.0s – 17.0s)

> Three weeks ago, every explainer video our platform made looked the same.

_Start: 8.0s · End: ~12.5s · Pace: measured, level_

### Beat 3 — SCHEMA REVEAL (17.0s – 30.0s)

> The model only filled in strings. Layout, color, motion — all on us. The schema was the ceiling.

_Start: 17.5s · End: ~23.0s · Pace: dry, slight emphasis on "ceiling"_

### Beat 4 — THE DELETE (30.0s – 40.0s)

> So we deleted it. Four hundred and fifty-five lines, gone.

_Start: 31.0s · End: ~34.5s · Pace: punchy, declarative_

### Beat 5 — NEW PIPELINE (40.0s – 58.0s)

> Now the worker reads the brief, calls the model, and the model writes the whole composition. We validate. We retry. We ship.

_Start: 41.0s · End: ~49.0s · Pace: flowing into the trio of short sentences at the end ("validate. retry. ship.") with deliberate pauses between them_

### Beat 6 — THE FALLBACK (58.0s – 66.0s)

> The old template renderer is still there. Underneath. A floor we can trust. So the ceiling can be ambitious.

_Start: 58.5s · End: ~64.0s · Pace: reassuring, slows on "ceiling can be ambitious"_

### Beat 7 — BESPOKE GRID (66.0s – 78.0s)

> Now every video is its own thing. Same runtime. Different design.

_Start: 66.5s · End: ~71.0s · Pace: confident, the three sentences hit like beats_

### Beat 8 — LESSON (78.0s – 87.0s)

> The shape of the schema is the shape of the ceiling.

_Start: 78.5s · End: ~82.5s · Pace: slow, deliberate, the closer_

---

## Short cut (30s · ~50 words narration · ~20s of audio · ~33% silence)

### Short Beat 1 — TEMPLATE GRID (0.0s – 8.0s)

> Three weeks ago, every explainer video looked the same.

### Short Beat 2 — THE DELETE (8.0s – 14.0s)

> So we deleted it. Four hundred and fifty-five lines, gone.

### Short Beat 3 — BESPOKE GRID (14.0s – 24.0s)

> Now every video is its own thing.

### Short Beat 4 — LESSON (24.0s – 30.0s)

> The shape of the schema is the shape of the ceiling.

---

## Generation notes

- Generate master narration as a single MP3 with internal silence between
  beats. Easier than concatenating per-beat clips and risking drift.
- ElevenLabs `voice_settings`: stability 0.45, similarity 0.85, style 0.30,
  speaker_boost true. Reduce stability if the read sounds too rigid; raise
  style if it sounds too monotone.
- Generate the short cut narration separately (different timing).
- ElevenLabs returns timestamp metadata — save to
  `narration/transcript.json`. The composition can use these for accurate
  beat-start timing if needed (or, simpler, hand-tune from the file's
  audio waveform).
- If ElevenLabs isn't available, fall back to local Kokoro via the
  `hyperframes-media` skill. Voice presets there: `bm_george` (British
  male) or `am_eric` (American male) are closest to the calm-confident
  register we want.

## Editorial notes

The script is intentionally sparse. The visuals carry most of the runtime;
the narration is punctuation. Per the article: _"the silence between
sentences is a feature."_

The two lines that need to land hardest are Beat 3's "the schema was the
ceiling" and Beat 8's "the shape of the schema is the shape of the
ceiling." These are the article's load-bearing claims. Voice direction
slows on both.
