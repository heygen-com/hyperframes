# Text To Speech

The shared HyperFrames audio engine (`audio/scripts/audio.mjs`) is the canonical
surface for cloud TTS providers. It selects the first available provider from
env vars and lets you override with `provider` in `audio_request.json` or with
`--provider` when invoking the engine directly.

> **Run the Preflight first — no credential is not a green light to silently use the local voice.** Before generating a voiceover, complete the sign-in **Preflight** (see `../SKILL.md` → Preflight): run `npx hyperframes auth status`, recommend signing in, and **STOP for the user's choice** (sign in for HeyGen voices, or continue offline with local Kokoro). This applies to a one-off "generate a voiceover" request just as much as inside a full workflow.

## Provider chain

The engine picks the first provider whose prerequisites are satisfied. This is
an **availability selection**, not a retry loop. If a selected provider fails
during synthesis, the engine reports the error and does not fall back to another
provider.

| Order | Provider          | Env trigger                                 | Local deps                           | Voice IDs                                   | Word timestamps                           | Audio format         |
| ----- | ----------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------- | -------------------- |
| 1     | HeyGen (Starfish) | `$HEYGEN_API_KEY` / `~/.heygen/credentials` | none (REST)                          | UUIDs from `GET /v3/voices?engine=starfish` | **Yes** (`word_timestamps[]` in response) | mp3 → wav via ffmpeg |
| 2     | ElevenLabs        | `$ELEVENLABS_API_KEY`                       | `pip install elevenlabs`             | UUIDs from elevenlabs.io dashboard          | No                                        | mp3 → wav via ffmpeg |
| 3     | Cartesia          | `$CARTESIA_API_KEY`                         | `pip install cartesia` (Python 3.9+) | IDs from cartesia.ai voice library          | No                                        | wav direct           |
| 4     | Kokoro-82M        | always (local fallback)                     | `pip install kokoro-onnx soundfile`  | `am_michael`, `af_heart`, … (54 voices)     | No                                        | wav direct           |

```bash
# Shared audio engine — auto-detect (HeyGen if credentialed, then ElevenLabs,
# then Cartesia, then Kokoro)
node skills/media-use/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json

# Pin a provider in the request
# { "provider": "cartesia", "lines": [{"id":"01","text":"Hello"}] }
node skills/media-use/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json

# Or override on the command line
node skills/media-use/audio/scripts/audio.mjs --request ./audio_request.json --provider cartesia --out ./audio_meta.json
```

The local `npx hyperframes tts` command is **Kokoro only**. It does not accept
`--provider heygen`, `--provider elevenlabs`, or `--provider cartesia`. Use the
shared audio engine or the standalone scripts below for cloud providers.

## Self-contained cloud scripts (no CLI provider plumbing)

These bundled scripts call the provider REST/Python SDK directly and need no
`hyperframes tts` provider plumbing.

### HeyGen — `scripts/heygen-tts.mjs`

Best quality **plus** word timestamps in one call:

```bash
# Only needed if you haven't run `npx hyperframes auth login`:
export HEYGEN_API_KEY=...   # or put it in a project .env

node skills/media-use/audio/scripts/heygen-tts.mjs \
  "Welcome to HyperFrames." -o narration.wav --words narration.words.json

node skills/media-use/audio/scripts/heygen-tts.mjs ./script.txt -o narration.wav
node skills/media-use/audio/scripts/heygen-tts.mjs --list   # public starfish voices
```

- **Voice:** `--voice <id>` must be a **starfish** voice_id (`--list`, or `GET /v3/voices?engine=starfish`). v2-catalog ids are rejected with HTTP 400. Omit `--voice` (English) and it defaults to **Marcia** (`05f19352e8f74b0392a8f411eba40de1`, a fixed default so the choice is deterministic). Non-English with no `--voice` falls back to the first matching catalog voice.
- **Output:** `.wav` → transcoded to 44.1k mono via ffmpeg; `.mp3` → raw bytes (no ffmpeg needed).
- **Words:** `--words <path>` writes the flat `[{id,text,start,end}]` shape below, drop-in for the captions pipeline. HeyGen's `<start>`/`<end>` boundary sentinels are filtered out and ids are re-contiguous.
- **Non-English:** `--lang <code>` (anything but `en`) is sent as the request `language`.

### Cartesia

Cartesia is invoked through the shared audio engine, not through `npx hyperframes tts`.

Prerequisites:

```bash
export CARTESIA_API_KEY=...
pip install cartesia   # Python 3.9+
```

Default settings when `provider` is `cartesia` and no `voice` is supplied:

- Voice: **Skylar** (`db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`)
- Model: `sonic-3.5`
- API version: `2026-03-01`
- Output: WAV, 44.1 kHz, mono, `pcm_s16le` (direct from the SDK, no ffmpeg transcode)

In `audio_request.json`:

```json
{
  "provider": "cartesia",
  "lang": "en",
  "speed": 1.0,
  "lines": [{ "id": "01", "text": "Welcome to HyperFrames." }]
}
```

- `voice` overrides Skylar with any Cartesia voice ID.
- `lang` is normalized to a base language code before it reaches the SDK (for example, `en-us` and `en-gb` become `en`, `fr-fr` becomes `fr`).
- `speed` is passed through `generation_config.speed` and accepts the provider's supported range.

## When to use which provider

| Goal                                                      | Use                                                 |
| --------------------------------------------------------- | --------------------------------------------------- |
| Best voice quality + word timestamps in one call          | **HeyGen**                                          |
| Drop-in cloud TTS, big voice catalog                      | **ElevenLabs**                                      |
| Fast direct WAV, low-latency cloud synthesis              | **Cartesia**                                        |
| Offline, no API key, fast iteration                       | **Kokoro**                                          |
| Non-English multilingual with deterministic phonemization | **Kokoro** (`ef_dora`, `jf_alpha`, `zf_xiaobei`, …) |

## ffmpeg requirement

HeyGen + ElevenLabs return mp3. The engine transcodes to wav when the requested
output ends in `.wav` (the default and what downstream `ffprobe` + Whisper
expect). Cartesia and Kokoro already return wav directly, so no transcode step
is needed for those providers. If you'd rather skip the transcode for HeyGen or
ElevenLabs, request `.mp3`. Without `ffmpeg` on PATH, `.wav` output from HeyGen
or ElevenLabs fails — install ffmpeg or use `.mp3`.

## Voice selection (Kokoro)

Default `af_heart`. Curated picks:

| Content type      | Voice                  |
| ----------------- | ---------------------- |
| Product demo      | `af_heart`, `af_nova`  |
| Tutorial / how-to | `am_adam`, `bf_emma`   |
| Marketing / promo | `af_sky`, `am_michael` |
| Documentation     | `bf_emma`, `bm_george` |
| Casual / social   | `af_heart`, `af_sky`   |

Run `npx hyperframes tts --list` for the bundled set.

## Multilingual (Kokoro voice prefix → language)

The first letter of a Kokoro voice ID picks the phonemizer language; `--lang` overrides auto-detection.

| Prefix | Language             |
| ------ | -------------------- |
| `a`    | American English     |
| `b`    | British English      |
| `e`    | Spanish              |
| `f`    | French               |
| `h`    | Hindi                |
| `i`    | Italian              |
| `j`    | Japanese             |
| `p`    | Brazilian Portuguese |
| `z`    | Mandarin             |

```bash
npx hyperframes tts "La reunión empieza a las nueve" --voice ef_dora
npx hyperframes tts "Today is a nice day" --voice af_heart
```

Valid `--lang` codes (only needed to override the voice's auto-detected language): `en-us`, `en-gb`, `es`, `fr-fr`, `hi`, `it`, `pt-br`, `ja`, `zh`.

Non-English phonemization requires `espeak-ng` system-wide (`brew install espeak-ng` / `apt-get install espeak-ng`).

## Speed

- `0.7-0.8` — tutorial, complex content, accessibility
- `1.0` — natural pace (default)
- `1.1-1.2` — intros, transitions, upbeat content
- `1.5+` — rarely appropriate, test carefully

Honored by HeyGen, Cartesia, and Kokoro. ElevenLabs ignores `--speed` (use voice settings on their dashboard).

## Long scripts

Past a few paragraphs, write the text to a `.txt` file and pass the path. Inputs over ~5 minutes of speech may benefit from splitting into segments.

## HeyGen word-timestamp shape

When `--words <path>` is passed to a HeyGen call, the file is written in the same flat shape `transcribe` produces — drop-in compatible with the captions pipeline:

```json
[
  { "id": "w0", "text": "Hi", "start": 0.0, "end": 0.21 },
  { "id": "w1", "text": "there", "start": 0.22, "end": 0.55 }
]
```

For ElevenLabs, Cartesia, and Kokoro, run `npx hyperframes transcribe narration.wav --model small.en` to get the same shape.
