# Text To Speech

`npx hyperframes tts` synthesizes locally with Kokoro. It does not accept a
`--provider` or `--words` flag. For HeyGen audio plus word timestamps, use the
bundled `heygen-tts.mjs` script below.

> **Run the Preflight first — no credential is not a green light to silently use the local voice.** Before generating a voiceover, complete the sign-in **Preflight** (see `../SKILL.md` → Preflight): run `npx hyperframes auth status`, recommend signing in, and **STOP for the user's choice** (sign in for HeyGen voices, or continue offline with local Kokoro). This applies to a one-off "generate a voiceover" request just as much as inside a full workflow.

## Narrating a HyperFrames docs video

Anything that will sit on hyperframes.heygen.com uses one narrator, so the site
does not sound like two products.

|                |                                                |
| -------------- | ---------------------------------------------- |
| Voice          | **River** — "Relaxed, Neutral, Informative"    |
| Provider       | ElevenLabs                                     |
| `voice_id`     | `SAz9YHcvj6GT2YYXdXww`                         |
| Model          | `eleven_multilingual_v2`                       |
| Pace           | 145–155 words per minute, with room to breathe |
| Music under it | about −31 LUFS, never masking the voice        |

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/SAz9YHcvj6GT2YYXdXww" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"...","model_id":"eleven_multilingual_v2"}' -o take.mp3
```

This is the voice every user-journey film on the docs site already uses. Falling
back to local Kokoro because a key was not to hand produces a film that sounds
wrong beside the others — three docs videos were built that way and had to be
re-voiced. If you cannot reach ElevenLabs, say so and stop rather than
substituting a different voice.

Use another voice only for a documented reason, and write the reason down.

## Available routes

Gemini is an explicit alternative to the automatic provider order below. A
request to use Gemini already chooses the provider; do not redirect that user
to HeyGen sign-in. Read the Gemini section for its credential requirement.

| Order | Provider          | Env trigger                                 | Voice IDs                                   | Word timestamps                           | Audio format         |
| ----- | ----------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------- | -------------------- |
| 1     | HeyGen (Starfish) | `$HEYGEN_API_KEY` / `~/.heygen/credentials` | UUIDs from `GET /v3/voices?engine=starfish` | **Yes** (`word_timestamps[]` in response) | mp3 → wav via ffmpeg |
| 2     | ElevenLabs        | `$ELEVENLABS_API_KEY`                       | UUIDs from elevenlabs.io dashboard          | No                                        | mp3 → wav via ffmpeg |
| 3     | Kokoro-82M        | always (local fallback)                     | `am_michael`, `af_heart`, … (54 voices)     | No                                        | wav direct           |

```bash
# Local Kokoro CLI
npx hyperframes tts "Welcome to HyperFrames" -o narration.wav
```

## Self-contained HeyGen (no CLI) — `scripts/heygen-tts.mjs`

The published `hyperframes tts` CLI synthesizes locally with Kokoro only. When you
want HeyGen specifically — best quality **plus** word timestamps in one call — use
the skill's bundled script, which calls the HeyGen v3 REST API directly and needs
no CLI provider plumbing:

The script resolves a HeyGen credential the same way the CLI does — first source
wins: `$HEYGEN_API_KEY` → `$HYPERFRAMES_API_KEY` → a project `.env` (auto-loaded,
walks up ≤5 dirs) → `~/.heygen/credentials` (shared with heygen-cli;
`$HEYGEN_CONFIG_DIR` overrides the dir). An OAuth login is sent as
`Authorization: Bearer`; an API key as `X-Api-Key`; both include
`X-HeyGen-Source: cli`. OAuth CLI users can consume the web-plan free allowance
(10 min/month) before paid usage; API keys follow normal API billing. If the
only credential is an expired OAuth token it stops with a hint to run
`npx hyperframes auth refresh`.

```bash
# Only needed if you haven't run `npx hyperframes auth login`:
export HEYGEN_API_KEY=...   # or put it in a project .env

# Synthesize + capture word timestamps in one call (skips a Whisper pass)
node skills/media-use/audio/scripts/heygen-tts.mjs \
  "Welcome to HyperFrames." -o narration.wav --words narration.words.json

node skills/media-use/audio/scripts/heygen-tts.mjs ./script.txt -o narration.wav
node skills/media-use/audio/scripts/heygen-tts.mjs --list   # public starfish voices
```

- **Voice:** `--voice <id>` must be a **starfish** voice_id (`--list`, or `GET /v3/voices?engine=starfish`). v2-catalog ids are rejected with HTTP 400. Omit `--voice` (English) and it defaults to **Marcia** (`05f19352e8f74b0392a8f411eba40de1`, a fixed default so the choice is deterministic). Non-English with no `--voice` falls back to the first matching catalog voice.
- **Output:** `.wav` → transcoded to 44.1k mono via ffmpeg; `.mp3` → raw bytes (no ffmpeg needed).
- **Words:** `--words <path>` writes the flat `[{id,text,start,end}]` shape below, drop-in for the captions pipeline. HeyGen's `<start>`/`<end>` boundary sentinels are filtered out and ids are re-contiguous.
- **Non-English:** `--lang <code>` (anything but `en`) is sent as the request `language`.

## When to use which provider

| Goal                                                      | Use                                                       |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Best voice quality + word timestamps in one call          | **HeyGen**                                                |
| Drop-in cloud TTS, big voice catalog                      | **ElevenLabs**                                            |
| Offline, no API key, fast iteration                       | **Kokoro**                                                |
| Directed delivery with Gemini prebuilt or custom voices   | **Gemini** (explicit selection; transcription for timing) |
| Non-English multilingual with deterministic phonemization | **Kokoro** (`ef_dora`, `jf_alpha`, `zf_xiaobei`, …)       |

## Gemini 3.8 narration

Use the shared audio engine, not `hyperframes tts`. Set `GEMINI_API_KEY` or
`GOOGLE_API_KEY` in the environment or project `.env` (Gemini key wins when
both are set). Never put the key in a request file or composition.

This helper calls the Gemini Developer API using API-key authentication. The API
also supports appropriately scoped OAuth credentials, but this helper does not
yet accept OAuth tokens. Do not put service-account JSON in an API-key variable.
Cloud Text-to-Speech and Vertex AI have separate model availability.

Save this as `audio_request.json` in the project:

```json
{
  "provider": "gemini",
  "tts_model": "gemini-3.8-flash-tts",
  "voice": "Kore",
  "lang": "en",
  "style": "Warm, clear, conversational. Leave a short pause between sentences.",
  "lines": [
    { "id": "intro", "text": "Every word has a moment. Let the picture follow the voice." }
  ],
  "bgm": { "mode": "none" }
}
```

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs \
  --request ./audio_request.json --hyperframes . --out ./audio_meta.json --only tts
```

The engine saves `assets/voice/intro.wav`, measures its duration, and transcribes
it into `voices[].words` in `audio_meta.json`. Check that every requested line
has audio and nonempty word timings before building a captioned video. Review
the timings against the actual audio; transcription is estimated alignment,
not native TTS timestamps. Do not distribute words evenly across a clip.

- **Models:** `gemini-3.8-flash-tts` (default), or `gemini-3.8-flash-lite-tts`.
- **Voice:** `Kore` by default; pass another prebuilt voice or an existing custom
  voice ID. Creating or replicating voices is outside this helper.
- **Delivery:** Put directions in `style`, not in spoken `text`. Each line can
  override `style`. Use style for pacing; numeric `speed` must be omitted or 1.
- **Audio:** The unary API returns a complete WAV, saved locally. No generation
  calls run during playback or rendering.
- **Timing:** This adapter requests no native word timestamps. It uses the
  existing transcription pass. `lang` selects transcription language; Gemini
  infers speech language from the text.
- **Workflow adapters:** Product-launch, faceless-explainer, and PR-video audio
  scripts accept `--provider gemini --voice Kore --tts-model gemini-3.8-flash-tts
--style "Warm and clear"`.

An API error is reported as a failed line; an explicitly chosen Gemini voice
never silently falls back to another provider. Check the engine's anomalies
and output metadata, not only its exit code.

API contract: [Google's speech generation guide](https://ai.google.dev/gemini-api/docs/speech-generation).

## ffmpeg requirement

HeyGen + ElevenLabs return mp3. The bundled HeyGen helper transcodes to wav
when `--output` ends in `.wav` (the default and what downstream `ffprobe` +
Whisper expect). If you'd rather skip the transcode, pass `-o file.mp3`.
Without `ffmpeg` on PATH, wav output from cloud providers fails; the local
Kokoro CLI writes wav directly.

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

The `hyperframes tts` command honors `--speed` for Kokoro. Provider-specific
helpers document their own pacing controls.

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

For ElevenLabs / Kokoro, run `npx hyperframes transcribe narration.wav --model small.en` to get the same shape.
