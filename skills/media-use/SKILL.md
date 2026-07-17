---
name: media-use
description: Agent Media OS, the single skill for every media need in a HyperFrames project. Resolve BGM, SFX, image, icon, brand logo, voice, color grade, or LUT into a frozen local file or paste-ready block + ledger record (one verb, `resolve`); generate via TTS / music / image models when the catalog misses; produce voiceover, transcription, captions, and background removal through one shared audio engine; operate on media (cut / reframe / transform); and reuse assets across projects. Keeps search noise on disk, hands the agent one path or block. Use for any audio, image, icon, logo, voiceover, caption, color-grading, or media-asset need.
---

# media-use

The media OS for HyperFrames: resolve · generate · operate · remember — every media type, one skill, zero context noise.

First run: install and sign in to the `heygen` CLI (the free-usage path), then verify with `node <SKILL_DIR>/scripts/resolve.mjs --doctor`. Setup and providers: `references/setup-providers.md`.

## Resolve — the one verb

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type <type> --intent "<description>" --project <dir>
```

Returns one line: `resolved <id> → <path> (<type>, <metadata>)`. All search noise stays on disk.

| Type    | One-line intent                                                                     |
| ------- | ----------------------------------------------------------------------------------- |
| `bgm`   | background music (HeyGen catalog, 10k+ tracks)                                      |
| `sfx`   | sound effects (bundled 19-file library + catalog)                                   |
| `image` | photos, backgrounds (HeyGen asset search, 75k+ vectors)                             |
| `icon`  | icons, symbols (transparent)                                                        |
| `logo`  | official brand marks (svgl → simple-icons → GitHub avatar → favicon; never redrawn) |
| `voice` | TTS voiceover (HeyGen free-usage path; optional local Kokoro)                       |
| `grade` | paste-ready HyperFrames `data-color-grading` block                                  |
| `lut`   | reusable validated `.cube` file                                                     |

Before resolving fresh, list reusable candidates with `--candidates` and judge fit yourself — reuse rules, all flags, ingest (`--from`), and adopt are in `references/resolve.md`.

## Where to look — read only the file your task needs

| Task                                                                        | Read                             |
| --------------------------------------------------------------------------- | -------------------------------- |
| resolve / reuse / adopt / ingest, flags, cascade, inventory                 | `references/resolve.md`          |
| color grading, LUTs, smart grade (`--for`), grade-compare                   | `references/grading.md`          |
| voiceover / TTS, music, SFX, captions, transcription (audio engine)         | `references/audio.md`            |
| cut / reframe / transform existing media, HEVC proxies, avatar video        | `references/operations.md`       |
| install + auth, provider table, RAM ladders, `--local-only`, `--provider`   | `references/setup-providers.md`  |
| remembered preferences + frozen recipes (user memory)                       | `references/memory.md`           |
| proactive media opportunity pass (when building or reviewing a composition) | `references/opportunity-pass.md` |
| ownership matrix, usage stats, telemetry, privacy (maintainer-facing)       | `references/meta.md`             |
