---
name: media-use
description: Agent Media OS, the single skill for every media need in a HyperFrames project. Resolve BGM, SFX, image, icon, brand logo, voice, color grade, or LUT into a frozen local file or paste-ready block + ledger record (one verb, `resolve`); generate via TTS / music / image models when the catalog misses; produce voiceover, transcription, captions, and background removal through one shared audio engine; operate on media (cut / reframe / transform); and reuse assets across projects. Keeps search noise on disk, hands the agent one path or block. Use for any audio, image, icon, logo, voiceover, caption, color-grading, or media-asset need.
---

# media-use

The media OS for HyperFrames: resolve · generate · operate · remember, every media type, one skill, zero context noise.

## Setup — install heygen first (free-usage path)

```bash
curl -fsSL https://static.heygen.ai/cli/install.sh | bash
heygen update             # free usage needs the OAuth-capable CLI (v0.3.0+)
heygen auth login --oauth # OAuth = free subscription credits; --api-key bills API credits
```

This unlocks the FREE path for bgm/sfx/image/icon catalog search, TTS (voice), and avatar videos. Sign in with `--oauth` — the free allowance rides on the OAuth session (an API key bills API credits instead). **media-use requires heygen >= v0.3.0 uniformly** (the OAuth free-usage path needs it), so `--doctor` nudges older CLIs to update even for API-key-only use. Before resolving anything, verify setup with:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --doctor
```

## What it owns (the gaps HyperFrames leaves)

HyperFrames owns media _playback_; media-use owns everything else. Each row is enforced by `scripts/lib/coverage.test.mjs` so the claim can't rot.

| HyperFrames gap                            | media-use owns it via                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio-only, no image/icon                  | `resolve --type image\|icon` (heygen asset search)                                                                                                                                                                                                  |
| No third-party brand logos                 | `resolve --type logo` (svgl → simple-icons → GitHub org avatar → domain favicon)                                                                                                                                                                    |
| No voice / audio generation                | `resolve --type voice` (HeyGen TTS free-usage path; optional local Kokoro) + the audio engine (`audio/scripts/audio.mjs`)                                                                                                                           |
| Scattered/duplicated audio engine          | one consolidated engine under `audio/` (hyperframes-media retired)                                                                                                                                                                                  |
| No agent media-ops (cut/reframe/transform) | `references/operations.md` + `resolve --from` to register outputs                                                                                                                                                                                   |
| No transcript-driven cutting               | `scripts/transcript-cut.mjs` compiles word-timestamp edits into cut lists                                                                                                                                                                           |
| No auto-duck / publish loudness            | `scripts/audio-duck.mjs` + `references/operations.md` loudnorm/sidechain recipes                                                                                                                                                                    |
| No cross-project memory                    | global content-addressed cache + auto-promote (`~/.media`)                                                                                                                                                                                          |
| No color-grade authoring                   | `resolve --type grade` emits a paste-ready `data-color-grading` block; `resolve --type lut` freezes validated `.cube` files                                                                                                                         |
| No image generation                        | RAM-graded local mflux (FLUX) via `scripts/lib/mflux-provider.mjs`, codex `image_gen` upsell (`scripts/lib/codex-provider.mjs`)                                                                                                                     |
| No video generation                        | HeyGen avatar video + image-to-video (animate any still into a talking clip), photo-avatar, dub/translate — `heygen` CLI free-usage path (`references/operations.md`); optional spec-gated local LTX (`videogen` in `scripts/lib/local-models.mjs`) |
| Weak local-model defaults                  | HeyGen free-usage path via the `heygen` CLI; local open-source tools only as opt-in alternatives (`scripts/lib/local-run.mjs`)                                                                                                                      |

## When to use

Call `resolve` whenever a composition needs media: background music, sound effects, images, icons, brand logos, voice, a color grade, or a LUT. For voiceover / TTS, music, SFX, and caption timing, use the **audio engine** (below); background removal is delegated to the `hyperframes` CLI; transcription defaults to Parakeet (better than whisper.cpp: 6.05% vs 7.44% WER, 5-10x faster) via `scripts/transcribe.mjs`, with whisper.cpp auto-fallback (see `references/operations.md`). For cutting / reframing / transforming existing media, see `references/operations.md`. media-use searches the HeyGen catalog first for media files, resolves official logos through the logo cascade, uses local deterministic color grading for `grade`/`lut`, freezes the best match locally when a file is needed, registers it in a manifest, and hands the agent one line; all search noise stays on disk.

## Be proactive — run a media opportunity pass

The human usually can't tell which media would lift the piece. You can. When you build or review a composition, do **one** grounded scan and then **ask once** — don't silently add, and don't nag per asset.

Surface an opportunity only when a concrete signal is present:

| Signal detected                                        | Offer                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| On-screen text / a script with no voiceover            | TTS voiceover (audio engine)                                                                |
| Emoji or a `<div>` styled as an icon                   | resolve real `icon`s                                                                        |
| Image that is a placeholder, tiny, or upscaled-looking | a better `image` (and/or upscale — see `references/operations.md`)                          |
| Hard scene cuts / transitions with no sound            | transition `sfx`                                                                            |
| A piece over ~10s with no music bed                    | `bgm`                                                                                       |
| Footage that reads under/over-exposed or color-cast    | a corrective `grade` (analyze with `grade --for`, preview with `hyperframes grade-compare`) |

Rules that keep this a help, not nagware:

- **Grounded, not generic.** No signal → no suggestion. Never open with "want better images?".
- **Opinionated + concrete.** Propose the specific fix ("add a VO from your script, swap 3 emoji for real icons, replace the 400×400 hero, whooshes on the 4 cuts"), with defaults chosen — the human just approves **all / some / none**.
- **Once per project.** One consolidated ask, top few highest-value items. Respect "leave it" and don't re-raise.
- **Surface, never silently mutate.** Color grades especially: propose and preview, never auto-apply — a gray-world "correction" ruins an intentional sunset or neon look.

## Resolve

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type <type> --intent "<description>" --project <dir>
```

Returns one line: `resolved <id> → <path> (<type>, <metadata>)`

### Types

| Type    | What it finds                    | Provider / cascade                                           |
| ------- | -------------------------------- | ------------------------------------------------------------ |
| `bgm`   | Background music                 | HeyGen audio catalog (10k+ tracks)                           |
| `sfx`   | Sound effects                    | Bundled 19-file library + HeyGen catalog                     |
| `image` | Photos, backgrounds              | HeyGen asset search (75k+ vectors)                           |
| `icon`  | Icons, symbols                   | HeyGen asset search (type=icon)                              |
| `logo`  | Official brand marks             | svgl → simple-icons → GitHub org avatar → domain favicon     |
| `voice` | TTS voiceover                    | HeyGen TTS free-usage path; optional local Kokoro            |
| `grade` | HyperFrames color-grading blocks | Core preset → look index params/CDN LUT → deterministic cube |
| `lut`   | Reusable `.cube` LUT files       | Look index params/CDN LUT → deterministic cube               |

### Examples

```bash
# Background music
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "upbeat tech launch" --project .
# → resolved bgm_001 → .media/audio/bgm/bgm_001.mp3 (bgm, 25s)

# Sound effect
node <SKILL_DIR>/scripts/resolve.mjs --type sfx --intent "whoosh" --project .
# → resolved sfx_001 → .media/audio/sfx/sfx_001.mp3 (sfx, 0.57s)

# Image
node <SKILL_DIR>/scripts/resolve.mjs --type image --intent "gradient tech background" --project .
# → resolved image_001 → .media/images/image_001.jpg (image)

# Icon
node <SKILL_DIR>/scripts/resolve.mjs --type icon --intent "rocket" --project .
# → resolved icon_001 → .media/images/icon_001.png (icon, transparent)

# Brand logo (official mark — never redrawn by hand)
node <SKILL_DIR>/scripts/resolve.mjs --type logo --entity linkedin --intent "LinkedIn logo" --project .
# → resolved logo_001 → .media/images/logo_001.svg (logo, official mark)

# Color grade block
node <SKILL_DIR>/scripts/resolve.mjs --type grade --intent "warm daylight" --project . --json
# → {"ok":true,"preset":"warm-daylight","grading":{"preset":"warm-daylight","intensity":1},...}

# LUT file
node <SKILL_DIR>/scripts/resolve.mjs --type lut --intent "teal orange blockbuster" --project .
# → resolved lut_001 → .media/luts/lut_001.cube (lut)
```

### Flags

| Flag            | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `--type, -t`    | Media type: bgm, sfx, image, icon, logo, voice, grade, lut                           |
| `--intent, -i`  | What you need (natural language)                                                     |
| `--entity, -e`  | Entity name for cache matching (optional)                                            |
| `--project, -p` | Project directory (default: .)                                                       |
| `--candidates`  | List reusable assets (project + global cache) for `--type`; no download, no mutation |
| `--reuse <sha>` | Import a specific global-cache asset (by content sha/prefix, from `--candidates`)    |
| `--from`        | Freeze a local file or direct public URL (ingest)                                    |
| `--for`         | Analyze a local image/video and add measured adjust suggestions (`grade` only)       |
| `--local-only`  | Offline: skip every network provider (cache + local only)                            |
| `--provider`    | Force one generator (e.g. `codex`, `mflux`, `kokoro`, `heygen`)                      |
| `--adopt`       | Bulk-import existing assets/ into manifest                                           |
| `--doctor`      | Check local CLI dependencies; no manifest changes                                    |
| `--stats`       | Print local usage stats from `.media/` and `~/.media`; no manifest changes           |
| `--days N`      | Limit `--stats` to timestamped records/misses from the last N days                   |
| `--json`        | Output JSON instead of one-line result                                               |

## Reuse before you resolve

Before resolving bgm/sfx/image/icon/logo/grade/lut, **check what already exists and reuse it when it fits.** media-use does not semantically match for you — you are the judge. It surfaces candidates; you decide.

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "upbeat tech launch" --candidates --project .
#   [project] upbeat tech launch (25s, heygen.audio.sounds)
#           .media/audio/bgm/bgm_001.wav
#   [global]  energetic tech intro (22s, heygen.audio.sounds)
#           --reuse 06e052c075fd2b80
```

Read the list and judge semantic fit yourself — "upbeat tech launch" ≈ "energetic tech intro" is a call only you can make from the descriptions. Then:

- **A project candidate fits** → just reference its path in your composition. Nothing else to run.
- **A global candidate fits** → `resolve --type bgm --reuse <sha>` copies it into this project (self-contained render) and records it.
- **Nothing fits** → resolve fresh (`--type ... --intent ...`).

**Trust guardrail — when unsure, resolve fresh.** A redundant download is cheap; shipping the wrong asset is not. Judge fit from description + prompt + type + duration/dims. For **brand/entity** assets, reuse a _global_ candidate only when the entity matches exactly — the global cache aggregates every project you have worked on, so a `--candidates` list can surface another client's brand mark and its prompt text. Never reuse a cross-project brand asset on a loose match.

The deterministic floor still runs automatically: an identical (case/whitespace-insensitive) repeat auto-reuses with no `--candidates` step. `--candidates` is only for the semantic layer above that floor — and a fuzzy match is **never** auto-applied; reuse is always your explicit call. On a resolve that misses the floor and is about to fetch, media-use prints a one-line stderr hint when similar cached assets exist, pointing you back here.

## Color grading

Use `grade` when you need the actual HyperFrames `data-color-grading` value to paste onto an `<img>` or `<video>`. Core presets and params-backed library looks resolve locally; future CDN-backed library looks require network unless already frozen:

**Never `cat`/read a `.cube` file into context.** A 3D LUT is ~size^3 lines of raw numbers (33^3 ≈ 36k lines at the default size). It bloats context and carries zero human/agent-legible signal. To understand or choose a LUT, use `hyperframes grade-compare` to see it rendered, or `cube-validate.mjs` for a one-line `{ok,size}` check. Read `.media/index.md` or `luts/index.json` for the description. Never read the LUT body itself.

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type grade --intent "warm daylight" --project . --json
```

Preset-first output uses the core runtime vocabulary and does not freeze a file:

```json
{
  "preset": "warm-daylight",
  "intensity": 1
}
```

Paste it as an attribute value after JSON string escaping:

```html
<video
  class="clip"
  src="./media/scene.mp4"
  data-color-grading='{"preset":"warm-daylight","intensity":1}'
></video>
```

Looks beyond the preset vocabulary freeze a validated `.cube` under `.media/luts/` and return a block that references it:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type grade --intent "teal orange blockbuster" --project . --json
```

```json
{
  "intensity": 1,
  "lut": { "src": ".media/luts/grade_001.cube", "intensity": 0.85 }
}
```

Use `lut` when you only need the reusable `.cube` file:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type lut --intent "teal orange blockbuster" --project .
```

For a describable technical look, author an explicit parametric LUT with `--params`:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type lut --params '{"contrast":0.2,"temperature":-0.3}' --project .
node <SKILL_DIR>/scripts/resolve.mjs --type grade --params '{"exposure":0.2}' --project . --json
```

For a LUT generated by your own script, ingest it with `--from`; media-use validates it before registration and rejects invalid or oversized cubes:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type lut --from custom.cube --project .
```

Parametric math (`buildCube`) cannot reproduce real film stocks or emulsion looks. Use a CDN-backed scanned `.cube` entry or ingest a real scanned `.cube` for those.

For visual selection, list reusable looks with `resolve --type grade --candidates`, write the promising entries to a `grades.json`, run `hyperframes grade-compare --for <frame> --grades grades.json`, then commit the winner with `resolve -t grade` as the final `data-color-grading` block.

Smart grade is `grade --for <media>`. It runs local `ffmpeg`/`ffprobe` signalstats, merges a bounded `adjust` suggestion into the returned block, and prints the measured evidence to stderr. Stdout remains valid JSON under `--json`; the suggestion is a starting point for the agent to tune, not an automatic neutralization of intentional color.

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type grade --intent "warm cinematic" --for ./frame.png --project . --json
```

Library looks live in `luts/index.json`. Each entry keeps `id`, `description`, `tags`, and `intensity`, then supplies either compact `params` for on-demand `buildCube(params)` generation or a direct CDN `url` for future scanned `.cube` files. Do not commit generated `.cube` bodies; resolve validates generated or downloaded cubes as it freezes them under `.media/luts/`.

```bash
node skills/media-use/scripts/resolve.mjs --type lut --intent "teal orange blockbuster" --project . --json
node skills/media-use/scripts/lib/cube-validate.mjs .media/luts/lut_001.cube
```

## Providers

media-use holds no keys; every external tool owns its auth. Generation is
centered on the HeyGen CLI free-usage path. Install and authenticate `heygen`
before resolving bgm/sfx/image/icon/voice/avatar-video. Local tools are opt-in
alternatives where they exist: mflux for image, Kokoro for voice, Parakeet for
transcription, and LTX for local video generation. `resolve` spec-checks
AVAILABLE RAM for those local ladders (`describeModelLadder`); the agent can
see the ladder and override.

| Type      | Provider / path                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| bgm/sfx   | heygen catalog free-usage path                                                                              |
| image     | heygen search free-usage path; optional local mflux; codex `image_gen` upsell                               |
| voice     | heygen tts free-usage path; optional local **Kokoro** (free, on-device)                                     |
| icon      | heygen asset search free-usage path                                                                         |
| logo      | svgl, then simple-icons, then GitHub org avatar, then domain favicon (all free)                             |
| grade/lut | local core-preset map, params/CDN look index, deterministic `buildCube` fallback                            |
| video     | heygen avatar / image-to-video / photo-avatar / dub free-usage path; optional local LTX (`videogen` ladder) |

Local Kokoro (voice), mflux (image), and LTX (video) run on-device (free,
private, offline once cached). The `codex` CLI remains the ChatGPT-sub image
upsell. Cost rule (X4): the agent confirms before an agent-initiated paid call;
a user-requested one just runs.

To force a specific generator (e.g. a user says "make this image with codex"),
pass `--provider codex`: it pins resolution to that provider and skips the
free-usage default. See `references/operations.md` for the RAM ladders and
provider recipes.

`--local-only` skips every network provider, including the free HeyGen ones,
leaving the project + global cache and any installed local provider. For
HeyGen-only types, that means no fresh resolve.

## How it works

`resolve` runs an automatic floor, then falls through to fetching:

1. Check project `.media/manifest.jsonl` for a prompt match (case- and whitespace-insensitive) — auto-reuse
2. Scan existing `assets/` directory for unregistered files that share a word with the need
3. Check global cache `~/.media/` for a reusable asset matched on the same normalized prompt — auto-reuse
4. Search via provider (HeyGen audio catalog, HeyGen asset search), or resolve color locally
5. Freeze file to `.media/<type>/`, register in manifest, regenerate `index.md`, auto-promote to `~/.media/`

Steps 1 and 3 are the **deterministic floor**: they only auto-reuse an exact-normalized match, never a fuzzy one. Semantic reuse ("close enough") is the agent's explicit call via [Reuse before you resolve](#reuse-before-you-resolve) — it never happens automatically. The agent gets back **one line**; candidates, scores, provenance stay on disk.

## Adopt existing projects

Most HyperFrames projects already have assets in `assets/`. media-use adopts them:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --adopt --project .
# → adopted 9 assets from assets/
#   bgm_001 → assets/bgm/mango-fizz.mp3 (bgm, 146.6s)
#   image_001 → assets/images/avatar.jpg (image, 400×400)
```

`ffprobe` extracts real duration and dimensions. During resolve, unregistered files in `assets/` matching the intent are adopted on the fly.

## Reading the inventory

After resolve or adopt, read `.media/index.md` for the full inventory:

```
# .media · 4 assets

id         type   dur   dims       path                          description
bgm_001    bgm    25s   -          .media/audio/bgm/bgm_001.mp3  upbeat tech launch
sfx_001    sfx    0.6s  -          .media/audio/sfx/sfx_001.mp3  whoosh
image_001  image  -     1920×1080  .media/images/image_001.jpg   gradient tech background
icon_001   icon   -     200×200    .media/images/icon_001.png    rocket
```

## Cross-project reuse

Assets are cached automatically on resolve. Every resolved/ingested asset is auto-promoted to the global cache at `~/.media/`, so subsequent resolves for the same (or near-identical) prompt, in any project, hit the cache with no re-download and no provider call.

For a _semantically_ similar (not identical) need in another project, the exact-match floor won't fire — use [Reuse before you resolve](#reuse-before-you-resolve): `--candidates` lists the global assets, and `--reuse <sha>` imports the one you pick. This is how a track resolved in one project gets reused in the next when the wording differs.

## Preferences — remembered defaults

The lightweight tier of user memory: confirmed brief answers (destination, aspect, language, flow, storyboard, voice, style preset) persisted on the same two-tier split as assets — project `.media/preferences.json` (committed, the team inherits it) and personal `~/.media/preferences.json`. A value earns the personal tier by being confirmed in **two different projects**, so a one-off choice never pollutes the global defaults.

```bash
node <SKILL_DIR>/scripts/prefs.mjs get --hyperframes . --json      # merged view (project overrides user)
node <SKILL_DIR>/scripts/prefs.mjs record --hyperframes . --key destination --value x-feed
node <SKILL_DIR>/scripts/prefs.mjs record --hyperframes . --key style_preset --value pin-and-paper --workflow faceless-explainer
```

Only what the user actually confirmed gets recorded — never an inferred or defaulted value. How workflows consume these (a remembered value becomes the recommended default with a receipt, and never skips a question) is the brief contract's rule: `hyperframes-core/references/brief-contract.md` § 2, Remembered defaults.

## Recipes — frozen video bundles

The heavyweight tier of user memory: one approved run frozen as a named, versioned bundle — `frame.md`, the storyboard skeleton (structure kept, content blanked to per-frame fill-ins), the brief skeleton (from `BRIEF.md` when the project has one — reusable frontmatter kept, run-shape and prose blanked), and the confirmed brief values. Same two tiers: project `.media/recipes/<name>/` (committed) and `~/.media/recipes/<name>/` (a freeze is already a confirmed bundle, so it promotes immediately — no two-project rule). Re-freezing a name bumps `version` and archives the old folder as `<name>@v<N>`.

```bash
node <SKILL_DIR>/scripts/recipe.mjs freeze --hyperframes . --name weekly-promo   # workflow read from BRIEF.md (--workflow only for briefless projects)
node <SKILL_DIR>/scripts/recipe.mjs list --hyperframes . --workflow product-launch-video
node <SKILL_DIR>/scripts/recipe.mjs use --hyperframes . --name weekly-promo   # also: resolve.mjs --type recipe --entity weekly-promo
```

The freeze is offered once after the final approval (`hyperframes-core/references/review-loop.md` § 4), and the intent layer (`/hyperframes` § 4) checks for a match before its first question. Adopting a recipe fills the brief, the design spec, and the storyboard skeleton — and unlike preferences it may skip the questions it answers: the bundle was approved as a whole, and adoption itself is the question.

## Usage stats

Use `resolve --stats` for a local, shareable report over the current project's `.media/` manifest, the global `~/.media/` cache, and local resolve misses. Human output is compact; add `--json` for a single machine-readable object, and `--days N` to window timestamped records.

```bash
node <SKILL_DIR>/scripts/resolve.mjs --stats --project . --days 7
# media-use stats
# total resolves: 12
# misses: 2
# hit rate: 86%
```

## Files

- `.media/manifest.jsonl`: machine SSOT, one JSON record per line
- `.media/index.md`: agent-readable table (id, type, dur, dims, path, description)
- `.media/preferences.json`: the project's remembered defaults (committed)
- `~/.media/`: global cross-project reuse cache (content-addressed, SHA-256)
- `~/.media/preferences.json`: personal remembered defaults (promoted after two projects)
- `.media/recipes/<name>/`: frozen video bundles — recipe.json + frame.md + storyboard skeleton (committed)
- `~/.media/recipes/<name>/`: personal recipe tier (promoted on freeze)
- `~/.media/misses.jsonl`: local-only resolve misses, including intent text for `--stats`

## Audio engine: voiceover, music, SFX, captions, transcription

For a full audio pass (TTS voiceover + background music + sound effects in one
shot), use the shared engine at `audio/scripts/audio.mjs`. It takes a neutral
`audio_request.json` and writes `audio_meta.json` plus assets under
`.media/audio/{voice,bgm,sfx}`:

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json
```

- **Request** `{ provider?, lang?, speed?, lines: [{ id, text, sfx?: [names] }], bgm: { mode?, query?, prompt? } }`: `id` joins each line back to your model; `bgm.mode` = `retrieve | generate | none` (omit for auto). `--only tts,bgm,sfx` runs a subset and merges into an existing `--out`.
- **Output** `audio_meta.json` (id-keyed): `voices[].{path,duration_s,words[]}` (word timestamps for captions), `sfx[]`, `bgm`, `total_duration_s`.
- **HeyGen free-usage path**: HeyGen CLI auth unlocks TTS plus music/SFX retrieval. Local/provider-specific generators are explicit alternatives where installed; run `node <SKILL_DIR>/scripts/resolve.mjs --doctor` before assuming retrieval or TTS will work.
- If BGM took the generate path (`bgm_pending: true`), run `audio/scripts/wait-bgm.mjs` before final render.

Single-shot helpers: `audio/scripts/heygen-tts.mjs` (one voice file). Transcription / background removal / captions use the `hyperframes` CLI (`transcribe`, `remove-background`), see the per-topic guides in `audio/references/` (`tts.md`, `bgm.md`, `sfx.md`, `transcribe.md`, `remove-background.md`, `captions/`).

## Operating on media (cut, reframe, transform)

media-use resolves + remembers; for **operating** on assets see
`references/operations.md`: local-tool recipes (ffmpeg trim/reframe/montage,
auto-editor, scenedetect) and the local-vs-HeyGen transform table (background
removal, upscale, lipsync, translate). Run the tool, then register the output
with `resolve --from <output> --type <type>` so it joins the ledger + global
cache.

## CLI tools used (what to run, and how to enable each)

`resolve` auto-cascades; each provider shells one CLI. HeyGen is the
free-usage path for bgm/sfx/image/icon catalog search, TTS (voice), and avatar
video, so those capabilities need `heygen` installed and authenticated. Local
tools are OPT-IN alternatives where they exist; install one to unlock its free,
private, on-device path instead of or ahead of HeyGen for that type. Only
`ffmpeg`/`ffprobe` are strictly required for the tool to run at all.

| Tool               | Serves                                                                          | Install                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ffmpeg`/`ffprobe` | adopt probing, smart-grade signalstats, cut, duck bake, loudnorm                | system package (`brew install ffmpeg`)                                                                          |
| `heygen`           | catalog (bgm/sfx/image/icon) + TTS (voice) + avatar video — the free-usage path | `curl -fsSL https://static.heygen.ai/cli/install.sh \| bash` then `heygen auth login --oauth` (needs >= v0.3.0) |
| `mflux-generate`   | local image gen (FLUX), best-for-RAM                                            | `uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux==0.9.6`                              |
| `codex`            | image gen upsell (ChatGPT sub)                                                  | Codex CLI, logged in via ChatGPT (owns its own auth)                                                            |
| `parakeet-mlx`     | local transcription (default ASR, best)                                         | `uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`                        |
| `ltx-2-mlx`        | local video gen                                                                 | `git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras`                        |
| `npx hyperframes`  | Kokoro TTS (voice), whisper.cpp (transcribe fallback), remove-background        | bundled with the hyperframes CLI                                                                                |

The RAM-graded local-model shortlist + exact per-tier install/invoke lives in
`scripts/lib/local-models.mjs` (the agent can read `describeModelLadder(cap, specs)`
to see which model fits this machine). Without a tool on PATH, its provider
prints a one-line diagnostic to stderr and resolve falls through where another
provider exists (e.g. no `mflux` -> codex image upsell; no `parakeet-mlx` -> whisper.cpp).

`heygen asset search` is a pre-launch command hidden from `heygen --help`, but it
runs; providers tag requests with the allowlisted `X-HeyGen-Client-Source` header
(v0.3.0+).

## Telemetry

`resolve` and the edit tools (transcribe / transcript-cut / audio-duck) send an
anonymous usage event to PostHog (`scripts/lib/telemetry.mjs`), so we can see
which capabilities are actually used. It records only the media TYPE, the
resolution SOURCE, and the winning PROVIDER: never the intent text, file names,
or paths, and `$ip:null` so no IP is stored. Best-effort and non-blocking (a
resolve never waits on or fails from telemetry).

Opt out with `DO_NOT_TRACK=1` or `HYPERFRAMES_NO_TELEMETRY=1` (also off in CI and
dev). Same public PostHog project key and opt-outs as the `hyperframes` CLI.

## Privacy

media-use uses the same shared install id as the `hyperframes` CLI/studio
(`~/.hyperframes/config.json`). When you are signed in to HeyGen, usage is
linked to your account email, or username when email is unavailable, matching
the CLI behavior. The events stay coarse: media type, source, provider, and
small counts only; intent text and paths stay local. Disable telemetry with
`HYPERFRAMES_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.
