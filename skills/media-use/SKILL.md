---
name: media-use
description: Agent Media OS — the single skill for every media need in a HyperFrames project. Resolve BGM, SFX, image, icon, or voice into a frozen local file + ledger record (one verb, `resolve`); generate via TTS / music / image models when the catalog misses; produce voiceover, transcription, captions, and background removal through one shared audio engine; operate on media (cut / reframe / transform); and reuse assets across projects. Keeps search noise on disk, hands the agent a path. Use for any audio, image, icon, voiceover, caption, or media-asset need.
---

# media-use

The media OS for HyperFrames: resolve · generate · operate · remember — every media type, one skill, zero context noise.

## What it owns (the gaps HyperFrames leaves)

HyperFrames owns media _playback_; media-use owns everything else. Each row is enforced by `scripts/lib/coverage.test.mjs` so the claim can't rot.

| HyperFrames gap                            | media-use owns it via                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Audio-only — no image/icon                 | `resolve --type image\|icon` (heygen asset search)                                          |
| No voice / audio generation                | `resolve --type voice` + the audio engine (`audio/scripts/audio.mjs`)                       |
| Scattered/duplicated audio engine          | one consolidated engine under `audio/` (hyperframes-media retired)                          |
| No agent media-ops (cut/reframe/transform) | `references/operations.md` + `resolve --from` to register outputs                           |
| No cross-project memory                    | global content-addressed cache + auto-promote (`~/.media`)                                  |
| Weak local-model defaults                  | spec-gated local-model runner (`scripts/lib/local-run.mjs`, user-installed tts/asr/upscale) |
| No paid generation fallback                | fal + ElevenLabs, cost-guarded (`--allow-paid` / `--local-only`)                            |

## When to use

Call `resolve` whenever a composition needs media — background music, sound effects, images, icons, or voice. For voiceover / TTS, transcription, captions, and background removal, use the **audio engine** (below). For cutting / reframing / transforming existing media, see `references/operations.md`. media-use searches the HeyGen catalog first, freezes the best match locally, registers it in a manifest, and hands the agent one line; all search noise stays on disk.

## Resolve

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type <type> --intent "<description>" --project <dir>
```

Returns one line: `resolved <id> → <path> (<type>, <metadata>)`

### Types

| Type    | What it finds       | Provider                                 |
| ------- | ------------------- | ---------------------------------------- |
| `bgm`   | Background music    | HeyGen audio catalog (10k+ tracks)       |
| `sfx`   | Sound effects       | Bundled 19-file library + HeyGen catalog |
| `image` | Photos, backgrounds | HeyGen asset search (75k+ vectors)       |
| `icon`  | Icons, logos        | HeyGen asset search (type=icon)          |
| `voice` | TTS voiceover       | HeyGen TTS (free), ElevenLabs (paid)     |

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
```

### Flags

| Flag            | Description                                               |
| --------------- | --------------------------------------------------------- |
| `--type, -t`    | Media type: bgm, sfx, image, icon, voice                  |
| `--intent, -i`  | What you need (natural language)                          |
| `--entity, -e`  | Entity name for cache matching (optional)                 |
| `--project, -p` | Project directory (default: .)                            |
| `--from`        | Freeze a local file or direct public URL (ingest)         |
| `--allow-paid`  | Let paid generators run (fal / ElevenLabs); opt-in        |
| `--local-only`  | Offline: skip every network provider (cache + local only) |
| `--adopt`       | Bulk-import existing assets/ into manifest                |
| `--json`        | Output JSON instead of one-line result                    |

## Providers

heygen-CLI is tried first (free catalog) for every type it serves. When the
catalog misses and the user opts in with `--allow-paid`, generation runs:

| Type          | Free (first)        | Paid generation (`--allow-paid`)   |
| ------------- | ------------------- | ---------------------------------- |
| bgm/sfx/image | heygen catalog      | **fal** (Flux / MiniMax / MMAudio) |
| voice         | **heygen tts**      | **ElevenLabs**                     |
| icon          | heygen asset search | Iconify (gated, not yet enabled)   |

Voice resolves for free by default via HeyGen TTS (the catalog credential);
ElevenLabs is the paid fallback. Paid providers shell their own CLI (media-use
holds no keys) and are never called without `--allow-paid`:

- **fal** → the `genmedia` CLI (`curl https://genmedia.sh/install -fsS | bash`;
  `genmedia setup --api-key "$FAL_KEY"`). Not the `fal` pip package — that is the
  serverless-deploy CLI and can't run hosted models.
- **ElevenLabs** → the community `elevenlabs-cli` (`npm i -g elevenlabs-cli`;
  `export ELEVENLABS_API_KEY=…`). The official `@elevenlabs/cli` is agents-only
  with no TTS command.

`--local-only` skips every network provider — including the free HeyGen ones —
leaving the project + global cache and any local provider.

## How it works

1. Check project `.media/manifest.jsonl` for exact-prompt match
2. Scan existing `assets/` directory for unregistered files matching the need
3. Check global cache `~/.media/` for reusable asset
4. Search via provider (HeyGen audio catalog, HeyGen asset search)
5. Freeze file to `.media/<type>/`, register in manifest, regenerate `index.md`

The agent gets back **one line**. Candidates, scores, provenance stay on disk.

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
bgm_001    bgm    25s   —          .media/audio/bgm/bgm_001.mp3  upbeat tech launch
sfx_001    sfx    0.6s  —          .media/audio/sfx/sfx_001.mp3  whoosh
image_001  image  —     1920×1080  .media/images/image_001.jpg   gradient tech background
icon_001   icon   —     200×200    .media/images/icon_001.png    rocket
```

## Cross-project reuse

Assets are cached automatically on resolve. Every resolved/ingested asset is auto-promoted to the global cache at `~/.media/`, so subsequent resolves for the same prompt — in any project — hit the cache with no re-download and no provider call.

## Files

- `.media/manifest.jsonl` — machine SSOT, one JSON record per line
- `.media/index.md` — agent-readable table (id, type, dur, dims, path, description)
- `~/.media/` — global cross-project reuse cache (content-addressed, SHA-256)

## Audio engine — voiceover, music, SFX, captions, transcription

For a full audio pass (TTS voiceover + background music + sound effects in one
shot), use the shared engine at `audio/scripts/audio.mjs`. It takes a neutral
`audio_request.json` and writes `audio_meta.json` plus assets under
`.media/audio/{voice,bgm,sfx}`:

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json
```

- **Request** `{ provider?, lang?, speed?, lines: [{ id, text, sfx?: [names] }], bgm: { mode?, query?, prompt? } }` — `id` joins each line back to your model; `bgm.mode` = `retrieve | generate | none` (omit for auto). `--only tts,bgm,sfx` runs a subset and merges into an existing `--out`.
- **Output** `audio_meta.json` (id-keyed): `voices[].{path,duration_s,words[]}` (word timestamps for captions), `sfx[]`, `bgm`, `total_duration_s`.
- **Auto-degrades on one switch** — HeyGen credential present → HeyGen TTS + music/SFX retrieval; absent → ElevenLabs/Kokoro TTS, Lyria/MusicGen BGM generation, and the bundled SFX library (no credential needed).
- If BGM took the generate path (`bgm_pending: true`), run `audio/scripts/wait-bgm.mjs` before final render.

Single-shot helpers: `audio/scripts/heygen-tts.mjs` (one voice file). Transcription / background removal / captions use the `hyperframes` CLI (`transcribe`, `remove-background`) — see the per-topic guides in `audio/references/` (`tts.md`, `bgm.md`, `sfx.md`, `transcribe.md`, `remove-background.md`, `captions/`).

## Operating on media (cut, reframe, transform)

media-use resolves + remembers; for **operating** on assets see
`references/operations.md` — local-tool recipes (ffmpeg trim/reframe/montage,
auto-editor, scenedetect) and the local-vs-HeyGen transform table (background
removal, upscale, lipsync, translate). Run the tool, then register the output
with `resolve --from <output> --type <type>` so it joins the ledger + global
cache.

## CLI tools used

| Tool      | Purpose                                    | Required?     |
| --------- | ------------------------------------------ | ------------- |
| `ffprobe` | Probe duration, dimensions, codec on adopt | Yes           |
| `heygen`  | Audio catalog, asset search                | For providers |

Install the `heygen` CLI (single static binary, no runtime) and authenticate:

```bash
curl -fsSL https://static.heygen.ai/cli/install.sh | bash   # installs latest to ~/.local/bin
heygen update                                               # if already installed: needs >= v0.1.6
export HEYGEN_API_KEY=<your-key>                            # or: heygen auth login --key <key>
```

Requires **heygen >= v0.1.6** — the providers tag requests with the allowlisted `--headers 'X-HeyGen-Client-Source: media-use'` flag, added in v0.1.6. `asset search` is a pre-launch command hidden from `heygen --help`, but it runs. Without a `heygen` on PATH (or a valid key) the providers print a one-line diagnostic to stderr and resolve falls through to "no provider could resolve".
