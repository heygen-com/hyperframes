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

## Requirements

- Python 3.8+ with `kokoro-onnx` and `soundfile`
- Model downloads on first use (~311 MB + ~27 MB voices, cached in `~/.cache/hyperframes/tts/`)
