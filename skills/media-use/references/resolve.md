# Resolve — command, flags, reuse, adopt, inventory

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type <type> --intent "<description>" --project <dir>
```

Returns one line: `resolved <id> → <path> (<type>, <metadata>)`

## Types

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

## Examples

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

## Flags

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
