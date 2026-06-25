---
name: hyperframes-media
description: Audio and media assets for HyperFrames compositions, produced by one shared audio engine (`scripts/audio.mjs`) — multi-provider TTS (HeyGen / ElevenLabs / Kokoro local), background music + sound effects (HeyGen audio-library retrieval by default, with local Lyria / MusicGen BGM generation and a bundled SFX library as the no-credential fallback), Whisper transcription, background removal, and caption authoring. Use for voiceover / TTS, BGM, SFX / sound effects, transcription, captions / subtitles / lyrics / karaoke / per-word styling, voice + provider selection, and music-mood prompting.
---

# HyperFrames Media

Create the audio and media assets a composition needs — voiceover (TTS), background music + sound effects, transcription, captions, background removal — then consume and animate that data in HTML. For placing assets into compositions, see `hyperframes-core`.

## The audio engine — one source for TTS · BGM · SFX

Workflows do NOT hand-roll audio or vendor a copy. There is one engine — **`scripts/audio.mjs`** — that takes a neutral `audio_request.json` and writes `audio_meta.json` (plus assets under `assets/voice|bgm|sfx`):

```bash
# <MEDIA_DIR> = this skill's directory
node <MEDIA_DIR>/scripts/audio.mjs --request ./audio_request.json --hyperframes . --out ./audio_meta.json
```

All three capabilities degrade on **ONE switch** — whether a HeyGen credential is present (resolved from `$HEYGEN_API_KEY` / `$HYPERFRAMES_API_KEY` / `~/.heygen`, **not** the CLI):

| Capability | HeyGen credential present                          | absent                                               |
| ---------- | -------------------------------------------------- | ---------------------------------------------------- |
| TTS        | HeyGen Starfish REST (native word timestamps)      | → ElevenLabs → Kokoro (chain `transcribe` for words) |
| BGM        | HeyGen music **retrieval**                         | Lyria → MusicGen local **generation** (detached)     |
| SFX        | HeyGen sound-effects **retrieval** (min_score 0.4) | bundled 21-file library (`assets/sfx/`)              |

- **Request** (`audio_request.json`): `{ provider?, lang?, speed?, lines: [{ id, text, sfx?: [names] }], bgm: { mode?, query?, prompt? } }`. `id` joins each line back to the caller's model (a frame number, a scene id, …). `bgm.mode` = `retrieve | generate | none`; omit for auto (retrieve when credentialed, else generate). An **explicit** `retrieve` is strict — it skips rather than starting a detached generate (for callers with no `wait-bgm` step).
- **Output** (`audio_meta.json`, id-keyed): `{ tts_provider, voice_id, bgm, bgm_pending, …, voices: [{ id, path, duration_s, words }], sfx: [{ id, name, file, source, offset_s, duration_s, volume }], total_duration_s }`.
- `--only tts,bgm,sfx` runs a subset and **merges** into an existing `--out` (e.g. TTS+BGM early, SFX once cues exist).
- BGM generate is spawned **detached** (`bgm_pending: true`) — run `scripts/wait-bgm.mjs` before assembling.
- `scripts/heygen-tts.mjs` is a single-shot CLI over the same code (one text → wav + words) for when you just need HeyGen TTS without a request file.

Full flag list + the `audio_meta.json` schema live in the header of `scripts/audio.mjs`. The references below cover the provider details and edge cases behind each capability.

## Preflight — show sign-in status before any audio

**Always run this before generating voice or BGM — inside a full workflow _or_ a one-off "generate me a BGM/voiceover" request.** No HeyGen credential is **not** a reason to silently fall back to local engines: first recommend signing in and let the user decide. Run the shared preflight and **relay its output verbatim** — don't improvise your own "missing key" prompt, and don't offer to write keys into a per-repo `.env`:

```bash
npx hyperframes auth status
```

- **Signed in** → it prints the account; proceed.
- **Not signed in** (`exit 1` is expected here — "not signed in" is a normal state, not a failure) → it prints registration-first guidance. Recommend signing in: `npx hyperframes auth login` is browser OAuth — it **signs in and creates an account** (always available through this repo's CLI). To use an existing HeyGen API key (from app.heygen.com/settings/api), run `npx hyperframes auth login --api-key` — it saves to the shared `~/.heygen` (no per-repo `.env`). The output also lists the local engines voice/BGM will fall back to and a `pip` hint when deps are missing. **Relay this output as-is — don't paraphrase it into your own wording.** Then **STOP and wait** for the user to choose — sign in, or say "go" / "local" to continue offline — **before generating anything.** This is a real decision point, not a passing note: don't fold it into another question, and don't proceed past it on your own. (Exception: in autonomous / non-interactive mode, note the status and continue offline.)
- `npx hyperframes auth status --json` returns `{ configured, recommended_action, offline_engines }` for deterministic branching.
- **If the CLI can't run** (not on PATH and `npx` can't fetch it) → still **recommend signing in** (`npx hyperframes auth login`) and **STOP for the user's choice** — don't treat "no credential" as a silent green light for local generation.

Credential resolution, full key priority, and the local-dependency list are in `references/requirements.md`.

## Provider chains (the detail behind the engine)

**TTS** — first available provider wins (the engine, or `npx hyperframes tts "..."`):

| Order | Provider                      | Detected when                                | Word timestamps                                                  |
| ----- | ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| 1     | HeyGen (Starfish)             | `$HEYGEN_API_KEY` / `hyperframes auth login` | **Yes, native** — pass `--words narration.words.json` to capture |
| 2     | ElevenLabs                    | `$ELEVENLABS_API_KEY` set                    | No — chain `transcribe` after                                    |
| 3     | Kokoro-82M (local, 54 voices) | always (no key required)                     | No — chain `transcribe` after                                    |

> The published `hyperframes tts` CLI is often the local-only build (its `--help` says "Kokoro-82M", no `--provider`/`--words`) and silently falls back to Kokoro even with `$HEYGEN_API_KEY` set. That is why the engine's HeyGen path is the self-contained `scripts/heygen-tts.mjs` (REST), NOT the CLI; the CLI is used only for the Kokoro path. See `references/tts.md`.

**BGM & SFX** — by default **retrieved** from the HeyGen audio library (`/v3/audio/sounds`), same credential as HeyGen TTS, with the no-credential fallback from the switch above:

| Asset | HeyGen `type`                   | Lands in                                                   | Fallback (no credential)                                   |
| ----- | ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| BGM   | `music`                         | `assets/bgm/track.mp3` (retrieve) · `track.wav` (generate) | Lyria / MusicGen generation                                |
| SFX   | `sound_effects` (min_score 0.4) | `assets/sfx/<slug>.mp3`                                    | bundled 21-file library (`assets/sfx/*` + `manifest.json`) |

See `references/bgm.md` and `references/sfx.md`.

## Routing

| Task                                                                | Read                                         |
| ------------------------------------------------------------------- | -------------------------------------------- |
| The audio engine — request/meta schema, `--only`, the switch        | `scripts/audio.mjs` (header comment)         |
| `npx hyperframes tts` / `heygen-tts.mjs` — providers, voices, words | `references/tts.md`                          |
| BGM — HeyGen retrieval + local Lyria / MusicGen generation          | `references/bgm.md`                          |
| SFX — HeyGen retrieval (min_score 0.4) + bundled local library      | `references/sfx.md`                          |
| `npx hyperframes transcribe` — Whisper, model rules, output shape   | `references/transcribe.md`                   |
| `npx hyperframes remove-background` — transparent cutouts           | `references/remove-background.md`            |
| TTS → transcription → captions (no recorded voiceover)              | `references/tts-to-captions.md`              |
| Caption authoring — style detection, layout, word grouping, exit    | `references/captions/authoring.md`           |
| Transcript handling — input formats, quality gates, cleanup, APIs   | `references/captions/transcript-handling.md` |
| Caption motion — karaoke, marker effects, audio-reactive            | `references/captions/motion.md`              |
| Model caches, system dependencies, troubleshooting                  | `references/requirements.md`                 |

## Non-negotiable rules

- **One engine, no vendored copies.** Produce audio via `scripts/audio.mjs` (or `heygen-tts.mjs` for one-shot HeyGen TTS). Don't re-implement TTS/BGM/SFX inside a workflow — write an `audio_request.json` adapter and call the engine.
- **"HeyGen available" = a resolvable credential, not the CLI.** The whole switch keys off `heygenCredential()`; the published `hyperframes tts` may be Kokoro-only, and there is no `hyperframes bgm` / `hyperframes sfx` command at all.
- **Voice IDs are provider-specific.** `am_michael` is Kokoro-only; HeyGen UUIDs don't work on Kokoro. If you pass `--voice`, also pin `--provider` to avoid silent provider drift when the user's env changes.
- **Always pass `--model` to `transcribe`.** The CLI default `small.en` silently translates non-English audio. See `references/transcribe.md` → "Language Rule".
- **HeyGen returns word timestamps; ElevenLabs / Kokoro do not.** The engine chains `transcribe` automatically for the latter two; standalone, pass `--words` to HeyGen or run `transcribe` against the audio file.
- **Captions consume the flat word-array format** with `{ id, text, start, end }`. See `references/transcribe.md` → "Output Shape".
- **`remove-background --background-output` is hole-cut, not inpainted.** For "scene without the person", a different tool is needed. See `references/remove-background.md` → "When NOT the right tool".
- **BGM/SFX default to HeyGen retrieval; the no-credential fallback is generation (BGM) or the bundled library (SFX).** `/audio/sounds` ranks by a text query — name effects concretely (`glass shatter`, not `dramatic sound`); a no-match **skips**, never blocks the render. SFX sit at volume ~0.35 under voice + BGM. See `references/sfx.md` / `references/bgm.md`.
- **Treat workflow caption HTML as generated output.** For preset-backed videos, the reusable skin source lives at `.hyperframes/caption-skin.html` and the workflow script writes `compositions/captions.html`; do not edit generated `compositions/captions.html` to fix the skin. Rebuild via the workflow's `captions.mjs`, or use that workflow's explicit overrides mechanism when present.
