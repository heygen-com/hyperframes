# Setup and providers — install, auth, RAM ladders, forcing a provider

## Setup — install the helper and sign in to HyperFrames

Install the HeyGen CLI through its [verified release instructions](https://developers.heygen.com/cli), then run:

```bash
heygen update                  # requires v0.3.0+
npx hyperframes auth login     # dedicated HyperFrames OAuth session
```

HyperFrames owns the OAuth session in `~/.hyperframes/credentials` and supplies an access-only temporary credential to the HeyGen helper. Signing into `heygen` separately does not configure this path. The server decides subscription eligibility, free allowances and charges; an explicit API key uses API billing. **media-use requires heygen >= v0.3.0 uniformly.** Verify setup with:

```bash
npx hyperframes media-use resolve --doctor
```

## Host HeyGen access (no CLI sign-in)

A host app can give media-use HeyGen access of its own by setting
`HEYGEN_API_BASE` (its gateway), `HEYGEN_API_KEY` (the token that gateway
accepts) and, for a loopback gateway, `HEYGEN_ALLOW_HTTP=1`. The gateway adds
the host's key, so it never enters the agent's environment, and every
call is charged to that key's API credits. The `heygen` CLI honours the same
variables, so `resolve` (bgm/sfx/image/icon/voice/avatar-video) and the audio
engine's TTS all go through the host. With host access, skip CLI install and
sign-in, prefer the host's own HeyGen tools where it has them, never fall back
to a local or third-party generator on your own, and relay a refused call's
message (for example "add a key in Settings > Account") as written.

## Providers

HyperFrames selects the credential for its HeyGen media helpers. Install
`heygen` and sign in with `hyperframes auth login` before resolving
bgm/sfx/image/icon/voice/avatar-video; music and sound effects from
a host app's own tools need none of it. Local tools are opt-in
alternatives where they exist: mflux for image, Kokoro for voice, Parakeet for
transcription, and LTX for local video generation. `resolve` spec-checks
AVAILABLE RAM for those local ladders inside the CLI (the image tiers are listed
in `references/operations.md`).

| Type      | Provider / path                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bgm       | heygen catalog HyperFrames-authenticated path; a host app's own music tools come first                                                                                                       |
| sfx       | Openverse (CC0 / CC BY, no account), bundled library offline; a host app's own sound tools come first                                                                                        |
| image     | heygen search HyperFrames-authenticated path; optional local mflux; codex `image_gen` upsell                                                                                                 |
| voice     | heygen tts HyperFrames-authenticated path; optional local **Kokoro** (free, on-device)                                                                                                       |
| icon      | heygen asset search HyperFrames-authenticated path                                                                                                                                           |
| logo      | theSVG (thesvg.org), then GitHub org avatar, then domain favicon (all free)                                                                                                                  |
| grade/lut | local core-preset map, params/CDN look index, deterministic `buildCube` fallback                                                                                                             |
| video     | heygen avatar video HyperFrames-authenticated path (sign-in nudge on auth failure); optional local LTX (`videogen` ladder). Image-to-video / photo-avatar / dub stay manual `heygen` recipes |

Local Kokoro (voice), mflux (image), and LTX (video) run on-device (free,
private, offline once cached). The `codex` CLI remains the ChatGPT-sub image
upsell. Paid calls follow the Credits rule in `SKILL.md`: no prices unasked,
and a question only when a step won't fit.

To force a specific generator (e.g. a user says "make this image with codex"),
pass `--provider codex`: it pins resolution to that provider and skips the
default provider. See `references/operations.md` for the RAM ladders and
provider recipes.

`--local-only` skips every network provider, including HeyGen,
leaving the project + global cache and any installed local provider. For
HeyGen-only types, that means no fresh resolve.

## CLI tools used (what to run, and how to enable each)

`resolve` auto-cascades; each provider shells one CLI. HeyGen is the
HyperFrames-authenticated path for bgm/image/icon catalog search, TTS (voice), and avatar
video, so those capabilities need `heygen` installed and a HyperFrames login. Local
tools are OPT-IN alternatives where they exist; install one to unlock its free,
private, on-device path instead of or ahead of HeyGen for that type. Only
`ffmpeg`/`ffprobe` are strictly required for the tool to run at all.

| Tool               | Serves                                                                                     | Install                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg`/`ffprobe` | adopt probing, smart-grade signalstats, cut, duck bake, loudnorm                           | system package (`brew install ffmpeg`)                                                                                                                                                                                                                          |
| `heygen`           | catalog (bgm/image/icon) + TTS (voice) + avatar video — the HyperFrames-authenticated path | install through [verified HeyGen release instructions](https://developers.heygen.com/cli), then `npx hyperframes auth login` (helper needs >= v0.3.0)                                                                                                           |
| `mflux-generate`   | local image gen (FLUX), best-for-RAM                                                       | `uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux==0.9.6`                                                                                                                                                                              |
| `codex`            | image gen upsell (ChatGPT sub)                                                             | Codex CLI, logged in via ChatGPT (owns its own auth)                                                                                                                                                                                                            |
| `parakeet-mlx`     | local transcription (default ASR, best) on Apple Silicon                                   | `uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`                                                                                                                                                                        |
| `ltx-2-mlx`        | local video gen                                                                            | `git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras`                                                                                                                                                                        |
| `npx hyperframes`  | Kokoro TTS (voice), Parakeet or whisper.cpp (transcribe), remove-background                | via the hyperframes CLI; Kokoro needs Python 3.10+ with `pip install kokoro-onnx soundfile`; Parakeet on macOS, Windows and glibc 2.32+ Linux: `npx hyperframes models install parakeet`; whisper.cpp is built on first use (Homebrew on macOS, else git+cmake) |

The RAM-graded local-model shortlist + exact per-tier install/invoke lives in
the CLI's bundled media-use engine, not in the standalone skill. Without a tool on PATH, its provider
prints a one-line diagnostic to stderr and resolve falls through where another
provider exists (e.g. no `mflux` -> codex image upsell; no `parakeet-mlx` -> whisper.cpp).

`heygen asset search` is a pre-launch command hidden from `heygen --help`, but it
runs; providers tag requests with the allowlisted `X-HeyGen-Client-Source` header
(v0.3.0+).
