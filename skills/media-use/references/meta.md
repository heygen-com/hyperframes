# Ownership matrix, usage stats, telemetry, privacy

Maintainer-facing reference. Nothing here changes how you resolve or operate on media.

## What it owns (the gaps HyperFrames leaves)

HyperFrames owns media _playback_; media-use owns everything else. Each row is enforced by `scripts/lib/coverage.test.mjs` so the claim can't rot.

| HyperFrames gap                            | media-use owns it via                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio-only, no image/icon                  | `resolve --type image\|icon` (heygen asset search)                                                                                                                                                                                                                                  |
| No third-party brand logos                 | `resolve --type logo` (svgl → simple-icons → GitHub org avatar → domain favicon)                                                                                                                                                                                                    |
| No voice / audio generation                | `resolve --type voice` (HeyGen TTS free-usage path; optional local Kokoro) + the audio engine (`audio/scripts/audio.mjs`)                                                                                                                                                           |
| Scattered/duplicated audio engine          | one consolidated engine under `audio/` (hyperframes-media retired)                                                                                                                                                                                                                  |
| No agent media-ops (cut/reframe/transform) | `references/operations.md` + `resolve --from` to register outputs                                                                                                                                                                                                                   |
| No transcript-driven cutting               | `scripts/transcript-cut.mjs` compiles word-timestamp edits into cut lists                                                                                                                                                                                                           |
| No auto-duck / publish loudness            | `scripts/audio-duck.mjs` + `references/operations.md` loudnorm/sidechain recipes                                                                                                                                                                                                    |
| No cross-project memory                    | global content-addressed cache + auto-promote (`~/.media`)                                                                                                                                                                                                                          |
| No color-grade authoring                   | `resolve --type grade` emits a paste-ready `data-color-grading` block; `resolve --type lut` freezes validated `.cube` files                                                                                                                                                         |
| No image generation                        | RAM-graded local mflux (FLUX) via `scripts/lib/mflux-provider.mjs`, codex `image_gen` upsell (`scripts/lib/codex-provider.mjs`)                                                                                                                                                     |
| No video generation                        | `resolve --type video` — HeyGen avatar video first (free-usage path, sign-in nudge on auth failure), local LTX fallback (`videogen` in `scripts/lib/local-models.mjs`); image-to-video, photo-avatar, dub/translate remain manual `heygen` CLI recipes (`references/operations.md`) |
| Weak local-model defaults                  | HeyGen free-usage path via the `heygen` CLI; local open-source tools only as opt-in alternatives (`scripts/lib/local-run.mjs`)                                                                                                                                                      |

## Usage stats

Use `resolve --stats` for a local, shareable report over the current project's `.media/` manifest, the global `~/.media/` cache, and local resolve misses. Human output is compact; add `--json` for a single machine-readable object, and `--days N` to window timestamped records.

```bash
node <SKILL_DIR>/scripts/resolve.mjs --stats --project . --days 7
# media-use stats
# total resolves: 12
# misses: 2
# hit rate: 86%
```

## Telemetry

`resolve` and the edit tools (transcribe / transcript-cut / audio-duck) send an
anonymous usage event to PostHog (`scripts/lib/telemetry.mjs`), so we can see
which capabilities are actually used. It records only the media TYPE, the
resolution SOURCE, and the winning PROVIDER: never the intent text, file names,
or paths, and `$ip:null` so no IP is stored. Best-effort and non-blocking (a
resolve never waits on or fails from telemetry).

Opt out with `DO_NOT_TRACK=1` or `HYPERFRAMES_NO_TELEMETRY=1` (also off in CI and
dev). Same public PostHog project key and opt-outs as the `hyperframes` CLI.

HeyGen request tagging: every generating `heygen` call (TTS, avatar video, catalog
search) carries the allowlisted `X-HeyGen-Client-Source: media-use` header, sourced
from one shared constant (`HEYGEN_CLIENT_SOURCE_ARGV` in `scripts/lib/heygen-cli.mjs`)
so a future call site can't silently ship untagged. Read-only discovery calls
(`voice list`, `avatar list`) are intentionally left untagged.

## Privacy

media-use uses the same shared install id as the `hyperframes` CLI/studio
(`~/.hyperframes/config.json`). When you are signed in to HeyGen, usage is
linked to your account email, or username when email is unavailable, matching
the CLI behavior. The events stay coarse: media type, source, provider, and
small counts only; intent text and paths stay local. Disable telemetry with
`HYPERFRAMES_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.
