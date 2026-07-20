# Setup and providers — install, auth, RAM ladders, forcing a provider

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

## Providers

media-use holds no keys; every external tool owns its auth. Generation is
centered on the HeyGen CLI free-usage path. Install and authenticate `heygen`
before resolving bgm/sfx/image/icon/voice/avatar-video. Local tools are opt-in
alternatives where they exist: mflux for image, Kokoro for voice, Parakeet for
transcription, and LTX for local video generation. `resolve` spec-checks
AVAILABLE RAM for those local ladders (`describeModelLadder`); the agent can
see the ladder and override.

| Type      | Provider / path                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bgm/sfx   | heygen catalog free-usage path                                                                                                                                                |
| image     | heygen search free-usage path; optional local mflux; codex `image_gen` upsell                                                                                                 |
| voice     | heygen tts free-usage path; optional local **Kokoro** (free, on-device)                                                                                                       |
| icon      | heygen asset search free-usage path                                                                                                                                           |
| logo      | svgl, then simple-icons, then GitHub org avatar, then domain favicon (all free)                                                                                               |
| grade/lut | local core-preset map, params/CDN look index, deterministic `buildCube` fallback                                                                                              |
| video     | heygen avatar video free-usage path (sign-in nudge on auth failure); optional local LTX (`videogen` ladder). Image-to-video / photo-avatar / dub stay manual `heygen` recipes |

Local Kokoro (voice), mflux (image), and LTX (video) run on-device (free,
private, offline once cached). The `codex` CLI remains the ChatGPT-sub image
upsell. Cost rule (X4): the agent confirms before an agent-initiated paid call;
a user-requested one just runs — `heygen.video` is flagged paid (metered free
allowance) so an agent-initiated `resolve --type video` confirms first.

To force a specific generator (e.g. a user says "make this image with codex"),
pass `--provider codex`: it pins resolution to that provider and skips the
free-usage default. See `references/operations.md` for the RAM ladders and
provider recipes.

`--local-only` skips every network provider, including the free HeyGen ones,
leaving the project + global cache and any installed local provider. For
HeyGen-only types, that means no fresh resolve.

## CLI tools used (what to run, and how to enable each)

`resolve` auto-cascades; each provider shells one CLI. HeyGen is the
free-usage path for bgm/sfx/image/icon catalog search, TTS (voice), and avatar
video, so those capabilities need `heygen` installed and authenticated. Local
tools are OPT-IN alternatives where they exist; install one to unlock its free,
private, on-device path instead of or ahead of HeyGen for that type. Only
`ffmpeg`/`ffprobe` are strictly required for the tool to run at all.

| Tool               | Serves                                                                          | Install                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg`/`ffprobe` | adopt probing, smart-grade signalstats, cut, duck bake, loudnorm                | system package (`brew install ffmpeg`)                                                                                           |
| `heygen`           | catalog (bgm/sfx/image/icon) + TTS (voice) + avatar video — the free-usage path | `curl -fsSL https://static.heygen.ai/cli/install.sh \| bash` then `heygen auth login --oauth` (needs >= v0.3.0)                  |
| `mflux-generate`   | local image gen (FLUX), best-for-RAM                                            | `uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux==0.9.6`                                               |
| `codex`            | image gen upsell (ChatGPT sub)                                                  | Codex CLI, logged in via ChatGPT (owns its own auth)                                                                             |
| `parakeet-mlx`     | local transcription (default ASR, best)                                         | `uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`                                         |
| `ltx-2-mlx`        | local video gen                                                                 | `git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras`                                         |
| `npx hyperframes`  | Kokoro TTS (voice), whisper.cpp (transcribe fallback), remove-background        | via the hyperframes CLI; whisper.cpp is built on first use (Homebrew on macOS, else git+cmake), models download from HuggingFace |

The RAM-graded local-model shortlist + exact per-tier install/invoke lives in
`scripts/lib/local-models.mjs` (the agent can read `describeModelLadder(cap, specs)`
to see which model fits this machine). Without a tool on PATH, its provider
prints a one-line diagnostic to stderr and resolve falls through where another
provider exists (e.g. no `mflux` -> codex image upsell; no `parakeet-mlx` -> whisper.cpp).

`heygen asset search` is a pre-launch command hidden from `heygen --help`, but it
runs; providers tag requests with the allowlisted `X-HeyGen-Client-Source` header
(v0.3.0+).
