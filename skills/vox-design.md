# The vox skill family — design notes

> VA-1766 · 2026-07-16 · four skills: `/vox-explainer` · `/vox-avatar` · `/vox-avatar-edit` · `/vox-omni`
> Written honestly: what was designed on purpose, what was forced by measured failures, and what is still weak.

## 0. Design philosophy

Three commitments shaped everything:

1. **One beat contract, many renderers.** All four skills consume the same `beats.json` shape
   (`label / vo / visual / camera / transition / palette_page`). The beat map is the storyboard
   contract (deliberately aligned with VA-1768); the skills differ only in HOW a beat becomes
   pixels. This is why a case can be re-rendered across three treatments without rewriting anything.
2. **Style and content are separate channels.** Style vocabulary lives in preset files
   (collage-zine / paper-craft) and never enters copy or VO. Root cause: the observed failure
   where asking for "paper lay style" made the word "paper" appear in overlay text (Brad Wang,
   #video-agent-core-team), re-confirmed by our v1 edit prompts producing content-free sticker walls.
3. **Rules must be earned.** Nothing went into a SKILL.md because it sounded right; each hard
   rule cites a measured failure (§4). The skills are as much a failure ledger as a style guide.

## 1. `/vox-explainer` — HF-native faceless explainer

**Design goal:** the deterministic pole. 100% text correctness, HD, ~$0 marginal cost,
one-line edits — the properties the cost story (1/10) depends on.

**Key decisions**
- *Beat rhythm 4–6s, not 10s.* Dissecting the Ori V1 reference frame-by-frame showed ~12
  tableaux in 60s; the 10s rhythm the trend uses is a model constraint (Omni's per-clip cap),
  not an editorial choice. HF has no such cap, so the skill targets real Vox rhythm — the one
  quality axis where the deterministic route can beat the generative one for free.
- *Assets split:* photo-like imagery (etchings, halftone portraits) is generated (NB2L, ~$0.03),
  because hand-drawing them in CSS is off-brand; text, charts, maps, labels are HF-native,
  because generating them is a lottery.
- *Pattern library over freeform:* torn-edge `clip-path` cards, tape `mix-blend multiply`,
  seeded `tl.set` boil at 6fps, wrapper/child transform separation — extracted into a working
  example file (lint-clean, rendered) so agents copy verified mechanics instead of re-deriving.
- *Page variety system (added after review):* palette arc + seven layout archetypes +
  adjacent-beat difference rule. See §5 — this was the biggest design gap.

**Weaknesses (current):** motion vocabulary is still one family (slide/pop/slap/boil);
no BGM step by default; single display font. See §5 roadmap.

## 2. `/vox-avatar` — talking avatar × HF assembly

**Design goal:** put a real, identity-true person INSIDE the deterministic collage.

**Key decisions**
- *Voice first, then lips.* TTS (the person's voice) drives Tokyo; the composition's audio is
  the same files at the same offsets. The AUDIO CONTRACT ("lips and voice are one unit") exists
  because the first demo dubbed unrelated TTS over a sample clip — instantly wrong.
- *Die-cut sticker mount.* Matted host (u2net → VP9 alpha) with stacked white drop-shadows —
  the mascot grammar from the trend ("a paper-cutout version presents the ad"), which also
  makes the host a first-class collage element rather than a floating video rectangle.
- *Layout is budgeted before content:* host band vs label bands, host box = no-text zone;
  beat tails = VO + 0.3s. Both rules came from shipped failures (labels on the chest;
  freeze-frame stutters from tpad-cloned tails).
- *Why not lip-sync inside Omni or HF?* Measured: Omni cannot take audio (modality disabled)
  and photo→talking redraws identity (ArcFace 0.46–0.59). Tokyo is the only identity-true,
  audio-driven source available; HF then owns everything text- and layout-critical.

**Weaknesses:** background variety inherits vox-explainer's monotony (§5); render is CPU-slow
(~1 min/s with 3 alpha tracks); poster-mode fallback is static.

## 3. `/vox-avatar-edit` — Omni edit repaints the world

**Design goal:** the organic pole — one painted world where light and paper interact,
impossible to fake with layered CSS. Costs money and gives up text control; exists because
style cohesion is a real axis the assembly route can't win.

**Key decisions (all forced by failures, in order):**
- v1 failed twice: style-only prompts → generic sticker walls unrelated to narration; host
  frozen at one size. → *content paragraph per beat* + *ffmpeg host layout pre-compose*
  (keep-human means composition MUST come from the source).
- v2 failed twice: motif lists → clutter; +0–2.1% output re-timing → progressive lip desync.
  → *ONE hero prop + quiet background* and *duration conform (setpts, ≤33ms residual)*.
- "Preserve the audio" instructions turned out to mean *verbatim re-performance* (words 100%,
  waveform corr 0.149) — that is what Flow-style "consistency" is. → source-voice remux is
  the contract; the preserve prompt is only a semantic fallback.

**Weaknesses:** 720p; per-beat worlds don't persist across cuts (reads as vox hard-cuts, but
it's a constraint, not a choice); text in-world is banned rather than solved.

## 4. `/vox-omni` — end-to-end generation

**Design goal:** replicate the trend's own pipeline (the Ori Silver workflow) without the
third-party platform, as the baseline the other routes are measured against.

**Key decisions**
- *2 tableaux per 10s clip* — the single highest-leverage prompt rule; one tableau per clip is
  why naive output feels slow (the reference packs ~5s/tableau).
- *ASR retime* — converts leftover model-unit slack into editorial rhythm (40s → 26.9s on the
  first demo). The trend can't do this because their unit of work is the clip; ours is the beat.
- *Prompt-muted audio + external TTS* — Omni always bakes audio and voice drifts across clips
  (no session mechanism exists: audio input disabled, `previous_interaction_id` can't extend
  video). The architecture where Omni does pictures and TTS does voice isn't a preference,
  it's the only stable configuration.
- *Faceless-grade only* for people (identity measurements, §3).

## 5. Honest self-critique — "单调 / 背景重复" (review, 2026-07-16)

The criticism is correct, and it's a design flaw, not an execution slip:

- **What happened:** every HF beat I shipped was the same kraft page + red/purple blocks +
  tape + label, re-arranged. The reference dissection *itself* documented a palette arc
  (cream → indigo drama → cream payoff) and seven-plus tableau types — the analysis knew it,
  the skill didn't encode it, so the agent (me) defaulted to one page redecorated N times.
- **Root cause:** the skill specified *elements* (what a card/tape/label looks like) but not
  *pages* (what makes beat N feel different from beat N-1). Element-level spec + no page-level
  spec = monotone output from any agent following it.
- **Fix shipped:** §2.5 of vox-explainer — mandatory page arc (adjacent beats differ in page
  color or archetype), 7 layout archetypes, texture rotation. This turns variety from taste
  into a checkable rule (same class as the anti-monotony camera rule).
- **Still open (roadmap):**
  - Motion archetype variety (entrances are all slide/pop family; needs draw-on, unfold,
    print-head, page-turn as first-class beat verbs).
  - A second display face + art-directed caption mixing (Bebas-only is flat).
  - BGM/SFX pass by default (media-use), duck under VO — silence between VO lines is part of
    why pieces feel static.
  - Registry-ization: today's patterns live in one example HTML; they should become
    `registry/blocks` so variety is composable instead of copy-pasted.

## 6. Measured-evidence appendix (what we know, with numbers)

| Fact | Measurement |
|---|---|
| HF vs Omni cost per beat | $0.03 vs $1.01 (+3–5× retry reserve) |
| HF vs Omni beat latency | 3.8s render vs ~41s gen |
| Omni edit re-timing | +0–2.1% (9 beats) → conform to ≤33ms |
| "Preserve audio" reality | words 100%, waveform corr 0.149, duration still drifts |
| Photo→talking identity | ArcFace 0.46–0.59 (i2v / ref2v / lock-prompt; lock worst) |
| Restyle-a-still identity (NB2L + face rule) | ArcFace 0.888–0.909 |
| Edit reliability | 27/27 zero retries, $0.55–0.72/beat |
| Voice lock across clips | none exists (audio input disabled; extension unsupported) |
