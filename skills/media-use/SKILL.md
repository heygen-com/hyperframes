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

Rules that keep this a help, not nagware: **grounded, not generic** (no signal → no suggestion); **opinionated + concrete** (propose the specific fix with defaults chosen — the human approves **all / some / none**); **once per project** (one consolidated ask; respect "leave it"); **surface, never silently mutate** (color grades especially: propose and preview — a gray-world "correction" ruins an intentional sunset or neon look).

## Where to look — read only the file your task needs

| Task                                                                      | Read                            |
| ------------------------------------------------------------------------- | ------------------------------- |
| resolve / reuse / adopt / ingest, flags, cascade, inventory               | `references/resolve.md`         |
| color grading, LUTs, smart grade (`--for`), grade-compare                 | `references/grading.md`         |
| voiceover / TTS, music, SFX, captions, transcription (audio engine)       | `references/audio.md`           |
| cut / reframe / transform existing media, HEVC proxies, avatar video      | `references/operations.md`      |
| install + auth, provider table, RAM ladders, `--local-only`, `--provider` | `references/setup-providers.md` |
| remembered preferences + frozen recipes (user memory)                     | `references/memory.md`          |
| ownership matrix, usage stats, telemetry, privacy (maintainer-facing)     | `references/meta.md`            |
