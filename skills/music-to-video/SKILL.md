---
name: music-to-video
description: "Use when the user has a music track (an audio file, or a video to pull audio from) and wants a beat-synced HyperFrames video, calm to hard-hitting. The music drives everything: one analyzer reads it once, the orchestrator lays out the frames and fills a per-frame plan, and one sub-agent builds each frame. Typography and templates are the floor — a complete video needs zero assets — but any images or videos the user supplies are cut into the frames on the same beat grid (beat-cut / ken-burns). The genre (lyric video, slideshow, kinetic promo) falls out of the per-frame choices; the pipeline never branches on it."
---

# music-to-video — one music-grounded, beat-synced video workflow

Use this skill to turn a **music track** into a beat-synced HyperFrames video. You analyze the track once, lay out the frames, fill in a per-frame plan, and build each frame as a composition. The input is a music track plus optional user images or videos — there is **no narration and no website capture**. Typography and templates are the floor (a complete video needs zero assets); any media the user supplies is cut in on the same beat grid.

You are the **orchestrator**. Work in `videos/<project>/`. Run the steps in order and pass each **Gate** before moving on. Two steps need the user: **Step 3** (plan approval) and **Step 6** (render approval). Do every step yourself except **Step 4**, where you dispatch **one sub-agent per frame**. Keep design and motion rules out of this file — they live in `references/` and the `frame-worker` sub-agent.

`SKILL_DIR` = this skill directory. `PROJECT_DIR` = `videos/<project-name>/`.

Workflow: Step 0 setup → `hyperframes.json` + `assets/bgm.mp3`; Step 1 analyze → `audiomap.json`; Step 2 skeleton → `STORYBOARD.md` (frames, groups `TBD`); Step 3 plan → complete `STORYBOARD.md` + `frame.md`; Step 4 build → `compositions/frames/NN-*.html`; Step 5 assemble → `index.html`; Step 6 render → `renders/video.mp4`.

## Two ideas that shape everything

- **One analyzer, and you trust it.** `analyze-beatgrid.py` is the only beat analyzer — never re-measure beats with another tool or by ear. Its energy / density / rolls / onsets / silences are always reliable. Its `bpm` and `beats_sec` are reliable **only when the music is genuinely rhythmic**; on calm music the grid is a metronome the tracker imposed, so pace by phrases and energy instead and never hard-cut to it. Deciding which case you're in is each frame's `pacing` (Step 2).
- **One frame = one file; groups live inside.** Step 2 cuts the track into **frames**, and each frame becomes one composition file `compositions/frames/NN-<frame_id>.html`, built by one frame-worker. A frame can subdivide into **groups** (each a template or a motion-primitives combo). Extra density goes _inside_ a group, so **frame count tracks distinct treatments, not beats** — a fast track does not blow up the number of sub-agents.

---

## Step 0: Setup, BGM, and inputs

Goal: Establish the music source, create the HyperFrames project, and note any user-supplied media.

The **music is the spine** — establish one track before anything else. This skill is tuned for **fast, high-energy BGM**: a strong beat grid drives the cuts (calm tracks work, but pace by phrase rather than beat). If the user gave you audio — a music file, or a video to pull the audio from — use it. If not, generate one: choose the mood from the user's description (e.g. "driving synthwave", "trap beat", "upbeat corporate") and produce a track via `/hyperframes-media` (`references/bgm.md` — HeyGen retrieval when credentialed, else local Lyria / MusicGen; ElevenLabs or another generator also works). Either way the track lands at `assets/bgm.mp3`. Stage any user-supplied images or videos so frames can weave them in on the beat grid; otherwise typography carries the whole video.

Initialize only if `hyperframes.json` is missing. Name `<project>` from the brief in kebab-case, such as `midnight-drive-loop` — never a timestamp.

```bash
npx hyperframes init "videos/<project>" --non-interactive --skip-skills --example=blank
mkdir -p "$PROJECT_DIR/assets" "$PROJECT_DIR/renders"
cp "<user-music>" "$PROJECT_DIR/assets/bgm.mp3"   # extract from a video first if needed
# only if the user gave you images/videos:
node <SKILL_DIR>/scripts/stage-assets.mjs --from <dir> --hyperframes "$PROJECT_DIR" --into public
```

The **brand** (font + palette) is chosen at Step 3, not here. Don't pick a genre or a track type up front — assets are just an optional ingredient, and the genre emerges from the per-frame choices.

**Gate:** `hyperframes.json` + `assets/bgm.mp3` exist; aspect / length / fps and (if any) the asset inventory are noted.

---

## Step 1: Analyze the music

Goal: Produce the one canonical timing analysis the whole video is built on.

`analyze-beatgrid.py` is the **only** beat analyzer — never re-measure beats with another tool or by ear. It reads the track once and writes `audiomap.json`: energy phases (level / density / feel), onsets + `onset_rate`, rolls, silences, `hard_stops`, `key_moments`, phrases, tempo / grid, and `audio.duration_sec`. It's deterministic — the same file always gives the same map. Most fields are reliable on any music; `bpm` and `beats_sec` are reliable only when the music is genuinely rhythmic, and judging that is the call you make at Step 2.

Prerequisites: Python 3 with `librosa`, `numpy`, and `soundfile` available. If import fails, install them into the active Python environment before running the analyzer:

```bash
python3 -m pip install librosa numpy soundfile
```

```bash
python3 <SKILL_DIR>/scripts/analyze-beatgrid.py "$PROJECT_DIR/assets/bgm.mp3" \
  -o "$PROJECT_DIR/audiomap.json" --print
```

**Gate:** `audiomap.json` exists; `audio.duration_sec` is known.

---

## Step 2: Frame skeleton (structure only)

Goal: Read the music and lay out the frames — the skeleton of `STORYBOARD.md`.

Read [`references/frame-skeleton.md`](references/frame-skeleton.md). Turn `audiomap.json` into the **skeleton** of `STORYBOARD.md` yourself — there is no intermediate JSON. Cut the track into **frames** at real musical changes (`hard_stops`, SURGE / DROP `key_moments`, the edges of a roll, a stretch with no onsets, a big energy jump), snapping every boundary to an audiomap anchor. For each frame set `span_sec`, `pacing` (the verdict from Step 1's trust call — `beat_cut` when the grid is real, `phrase_flow` when it's a metronome imposed on calm music), `mood`, and a one-line `feel` (the plain music situation Step 3 matches a template against). Only classify and lay out here: leave every frame's `### Groups` as `TBD (Step 3)` and the frontmatter `style` blank — no templates, copy, color, or fonts. Expect ~1–6 frames.

**Gate:** frames tile the track (first at 0, last at `duration_s`); each carries `span_sec` + `pacing` + `mood` + `feel`; every `### Groups` is `TBD`; no content anywhere.

---

## Step 3: Fill the plan (user-gated)

Goal: Turn the skeleton into an approved, complete `STORYBOARD.md`.

Read [`references/planning.md`](references/planning.md), [`storyboard-format.md`](references/storyboard-format.md), [`template-catalog.md`](references/template-catalog.md), [`motion-primitive-catalog.md`](references/motion-primitive-catalog.md), and [`montage.md`](references/montage.md) (only if the user supplied assets). Editing the same file in place, do two things:

1. **Pick the brand.** Choose one preset from `../hyperframes-creative/frame-presets/` using the table in `../hyperframes-creative/references/design-spec.md` (match the track's mood; **only its fonts and colors matter** — templates own composition). Copy it into `frame.md` **unmodified** and fill the frontmatter `style` (font + a ≤4–6 swatch palette) from it.
2. **Fill every frame.** Decide its groups and give each a treatment: a matched template from the catalog (with bound params and real audiomap anchors), a free-compose from the primitive catalog, or an asset treatment that **obeys `pacing`**. Write the copy. You own WHAT (template / primitives + content + anchors); the frame-worker owns HOW — **never write millisecond tweens into the storyboard**.

```bash
node <SKILL_DIR>/scripts/validate-plan.mjs --storyboard "$PROJECT_DIR/STORYBOARD.md" \
  --audiomap "$PROJECT_DIR/audiomap.json" --templates <SKILL_DIR>/references/templates
```

Fix every `✗` (hard errors: duration mismatch, frames not tiling the track, a missing `src`); warnings are best-effort. Then show the user a frame-by-frame summary and iterate until they approve.

**Gate:** `frame.md` is a verbatim preset copy; `validate-plan.mjs` exits 0; the user approved the plan.

---

## Step 4: Build frames from the plan

Goal: Build every frame as a self-contained composition file.

Create `compositions/frames/`. Read [`sub-agents/frame-worker.md`](sub-agents/frame-worker.md) and `../hyperframes-core/references/subagent-dispatch.md`. Dispatch **one frame-worker per frame**, in parallel where possible (otherwise in waves). Each worker gets exactly one frame and this context:

```text
PROJECT_DIR: <abs path>
frame_id: <NN-frame_id>              # = the frame file stem, e.g. 02-f2; the composition id
Your block: the `## Frame N — <frame_id>` block in PROJECT_DIR/STORYBOARD.md
audiomap: PROJECT_DIR/audiomap.json
frame.md: PROJECT_DIR/frame.md
Materials: for each group, <SKILL_DIR>/references/templates/<id>/index.html (templates) and
           <SKILL_DIR>/references/motion-primitives/<id>/ (free); staged assets/ (asset groups)
Contracts: ../hyperframes-core/references/sub-compositions.md + determinism-rules.md
Canvas: <w>×<h>   Pacing: <beat_cut|phrase_flow>
Write to: PROJECT_DIR/compositions/frames/<frame_id>.html
```

The worker forks the cited materials, converts every anchor to frame-local seconds (`local_t = track_t − span_sec[0]`), gates its groups with 0ms cuts, and writes one seek-safe frame file. **The worker never runs the `hyperframes` CLI** — those commands operate on the assembled project, which doesn't exist yet, so they'd report on the wrong files. The worker just writes to the contract and stops; you verify after assembly (Step 6). As each worker returns, you can confirm its file landed on disk.

**Gate:** every frame has its `compositions/frames/NN-*.html` on disk.

---

## Step 5: Assemble

Goal: Wire the built frames + BGM into the playable `index.html`.

`assemble-index.mjs` is deterministic — no subagent, no judgment. It references each frame file at its cumulative `data-start`, mounts `assets/bgm.mp3` on track 11, and hard-cuts frame → frame (frames tile the track with no gaps, so there is **no transition injector**).

```bash
node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard "$PROJECT_DIR/STORYBOARD.md" \
  --hyperframes "$PROJECT_DIR" --audiomap "$PROJECT_DIR/audiomap.json"
```

Fix any `✗` it reports — a missing or blank frame file means that worker wrote a partial file; re-dispatch it (Step 4) and re-assemble.

**Gate:** `index.html` exists; total duration == `audiomap.audio.duration_sec`.

---

## Step 6: Verify and render

Goal: Verify the assembled video, get user approval, and render the final MP4.

Run the CLI on the **assembled project** — that's the correct unit (the per-frame workers couldn't run it). `lint` checks structure, `validate` runs headless Chrome (catching JS errors and missing assets), `inspect` snapshots frames.

```bash
( cd "$PROJECT_DIR" && npx hyperframes lint . && npx hyperframes validate . && npx hyperframes inspect . )
```

Inspect at `t=0`, each frame start, the strongest DROP / SURGE, every `hard_stops[].t`, and the final frame. On failure, make the **cheapest safe fix**: edit the offending `compositions/frames/NN-*.html` for a local issue; **re-dispatch that one frame-worker** only when a whole frame must be rebuilt; go back to Step 3 only if the plan is creatively wrong. Never change duration or audio timing to hide a sync issue. Once the gates pass, pause for user review, then render only on approval:

```bash
( cd "$PROJECT_DIR" && npx hyperframes render . -q draft -o renders/video.mp4 --fps 30 )
```

**Gate:** `lint` / `validate` / `inspect` passed; the user approved; `renders/video.mp4` exists with audio, duration == `audiomap.audio.duration_sec`. The final reply states the MP4 path and duration.

---

## Resume table

| You have                   | Continue from |
| -------------------------- | ------------- |
| `assets/bgm.mp3` only      | Step 1        |
| `audiomap.json`            | Step 2        |
| `STORYBOARD.md` (skeleton) | Step 3        |
| `STORYBOARD.md` (complete) | Step 4        |
| all frame files            | Step 5        |
| `index.html`               | Step 6        |

## Quick Reference

**Formats:** landscape `1920x1080` by default; portrait `1080x1920`; square `1080x1080`. Set the canvas once in the storyboard frontmatter (`canvas: { w, h, fps }`).

**Scripts** under `scripts/`: `analyze-beatgrid.py` (the one analyzer), `validate-plan.mjs` (plan check), `assemble-index.mjs` (index assembly), `stage-assets.mjs` (stage user media), `lib/storyboard.mjs` (vendored parser). Everything else is the `hyperframes` CLI.

| Read                                                                                                           | When                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`references/frame-skeleton.md`](references/frame-skeleton.md)                                                 | Step 2: read the music, lay out the frames, set pacing  |
| [`references/planning.md`](references/planning.md) · [`storyboard-format.md`](references/storyboard-format.md) | Step 3: pick the brand, fill each frame, write the plan |
| [`references/template-catalog.md`](references/template-catalog.md)                                             | Step 3: pick a template per group                       |
| [`references/motion-primitive-catalog.md`](references/motion-primitive-catalog.md)                             | Step 3/4: L0 recipes for free-compose                   |
| [`references/montage.md`](references/montage.md)                                                               | Step 3/4: asset treatments (beat-cut / ken-burns)       |
| [`sub-agents/frame-worker.md`](sub-agents/frame-worker.md)                                                     | Step 4: dispatch + build one frame                      |
| `../hyperframes-core/references/subagent-dispatch.md`                                                          | Step 4: dispatch sub-agents safely                      |
| `../hyperframes-creative/references/design-spec.md`                                                            | Step 3: pick the preset (the brand)                     |

## Directory layout

```
music-to-video/
  SKILL.md
  references/   frame-skeleton.md · planning.md · storyboard-format.md
                template-catalog.md · motion-primitive-catalog.md · montage.md
                templates/<id>/          { index.html (+ assets/ · program.json) }  ← L1 catalog impls
                motion-primitives/<id>/  { index.html } (+ ../assets/gsap.min.js shared by recipes) ← L0 catalog impls
  scripts/      analyze-beatgrid.py · assemble-index.mjs · validate-plan.mjs · stage-assets.mjs · lib/storyboard.mjs
  sub-agents/   frame-worker.md   ← the one subagent (one per frame)
```
