# Text-to-Speech

Generate speech audio locally using Kokoro-82M (no API key, runs on CPU).

## Voice Selection

Match voice to content. Default is `af_heart`.

| Content type  | Voice                 | Why                        |
| ------------- | --------------------- | -------------------------- |
| Product demo  | `af_heart`/`af_nova`  | Warm, professional         |
| Tutorial      | `am_adam`/`bf_emma`   | Neutral, easy to follow    |
| Marketing     | `af_sky`/`am_michael` | Energetic or authoritative |
| Documentation | `bf_emma`/`bm_george` | Clear British English      |
| Casual        | `af_heart`/`af_sky`   | Approachable, natural      |

Run `npx hyperframes tts --list` for all 54 voices (8 languages).

## Multilingual Phonemization

Kokoro voice IDs encode language in the first letter: `a`=American English, `b`=British English, `e`=Spanish, `f`=French, `h`=Hindi, `i`=Italian, `j`=Japanese, `p`=Brazilian Portuguese, `z`=Mandarin. The CLI auto-detects the phonemizer locale from that prefix — you don't need to pass `--lang` when the voice matches the text.

```bash
npx hyperframes tts "La reunión empieza a las nueve" --voice ef_dora --output es.wav
npx hyperframes tts "今日はいい天気ですね" --voice jf_alpha --output ja.wav
```

Use `--lang` only to override auto-detection (e.g. stylized accents):

```bash
npx hyperframes tts "Hello there" --voice af_heart --lang fr-fr --output accented.wav
```

Valid `--lang` codes: `en-us`, `en-gb`, `es`, `fr-fr`, `hi`, `it`, `pt-br`, `ja`, `zh`.

Non-English phonemization requires `espeak-ng` installed system-wide (`brew install espeak-ng` on macOS, `apt-get install espeak-ng` on Debian/Ubuntu).

## Speed Tuning

- **0.7-0.8** — Tutorial, complex content
- **1.0** — Natural pace (default)
- **1.1-1.2** — Intros, upbeat content
- **1.5+** — Rarely appropriate

## Usage

```bash
npx hyperframes tts "Your script here" --voice af_nova --output narration.wav
npx hyperframes tts script.txt --voice bf_emma --output narration.wav
```

In compositions:

```html
<audio
  id="narration"
  data-start="0"
  data-duration="auto"
  data-track-index="2"
  src="narration.wav"
  data-volume="1"
></audio>
```

## TTS + Captions Workflow

```bash
npx hyperframes tts script.txt --voice af_heart --output narration.wav
npx hyperframes transcribe narration.wav  # → transcript.json with word-level timestamps
```

## Alternative: ElevenLabs API

For production-quality voices with custom voice cloning, use [ElevenLabs](https://elevenlabs.io) as an external TTS provider.

### Setup

1. Create an ElevenLabs account and get your API key from [elevenlabs.io/app/settings](https://elevenlabs.io/app/settings)
2. Set the environment variable:

```bash
export ELEVENLABS_API_KEY=your_api_key_here
```

3. Install the ElevenLabs Python SDK:

```bash
pip install elevenlabs
```

### Generate Speech

```bash
# List available voices
elevenlabs voices list

# Generate speech with a specific voice
elevenlabs text-to-speech "Your narration script here" --voice Rachel --output narration.wav
```

### Voice Cloning

ElevenLabs supports instant voice cloning from a 30-second audio sample:

```bash
# Clone a voice from an audio sample
elevenlabs voices add --name "MyVoice" --file reference_audio.wav

# Use the cloned voice
python3 -c "
from elevenlabs import generate, play
audio = generate(text='Hello world', voice='MyVoice')
play(audio)
"
```

### Integration with HyperFrames

Generate the narration with ElevenLabs, then use it in your composition:

```bash
# Step 1: Generate narration
elevenlabs text-to-speech -f script.txt --voice Rachel --output narration.wav

# Step 2: Transcribe for captions
npx hyperframes transcribe narration.wav  # → transcript.json

# Step 3: Use in your composition
```

```html
<audio
  id="narration"
  data-start="0"
  data-duration="auto"
  data-track-index="2"
  src="narration.wav"
  data-volume="1"
></audio>
```

### Kokoro vs ElevenLabs

| Feature | Kokoro (local) | ElevenLabs (API) |
|---------|---------------|-------------------|
| Cost | Free | $5+/month |
| Latency | ~2s | ~0.5s |
| Voice quality | Good | Excellent |
| Voice cloning | No | Yes |
| Languages | 8 | 29+ |
| Offline | Yes | No |
| Setup | pip install | API key |

## Requirements

- Python 3.8+ with `kokoro-onnx` and `soundfile`
- Model downloads on first use (~311 MB + ~27 MB voices, cached in `~/.cache/hyperframes/tts/`)
- For ElevenLabs: `pip install elevenlabs` and `ELEVENLABS_API_KEY`
