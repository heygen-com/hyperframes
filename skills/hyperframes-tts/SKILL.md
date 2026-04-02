---
name: hyperframes-tts
description: Generate speech audio locally using Kokoro-82M (no API key). Use when asked to create narration, voiceover, or text-to-speech audio for compositions, or when a user needs spoken audio from text. Covers voice selection, speed tuning, and integrating TTS output with compositions and captions.
---

# Text-to-Speech

## Voice Selection

Match voice to content. Default is `af_heart`.

| Content type      | Voice                 | Why                           |
| ----------------- | --------------------- | ----------------------------- |
| Product demo      | `af_heart`/`af_nova`  | Warm, professional            |
| Tutorial / how-to | `am_adam`/`bf_emma`   | Neutral, easy to follow       |
| Marketing / promo | `af_sky`/`am_michael` | Energetic or authoritative    |
| Documentation     | `bf_emma`/`bm_george` | Clear British English, formal |
| Casual / social   | `af_heart`/`af_sky`   | Approachable, natural         |

Run `npx hyperframes tts --list` for all 54 voices (8 languages: EN, JP, ZH, KO, FR, DE, IT, PT).

## Speed Tuning

- **0.7-0.8** — Tutorial, complex content, accessibility
- **1.0** — Natural pace (default)
- **1.1-1.2** — Intros, transitions, upbeat content
- **1.5+** — Rarely appropriate; test carefully

## Composing with TTS Audio

Generate a voiceover and use it as the audio track:

```bash
npx hyperframes tts "Your script here" --voice af_nova --output narration.wav
```

Then reference it in the composition as a standard `<audio>` element:

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

Generate speech, then transcribe it back for word-level caption timestamps:

```bash
# 1. Generate speech
npx hyperframes tts script.txt --voice af_heart --output narration.wav

# 2. Transcribe for word-level timestamps
npx hyperframes transcribe narration.wav

# 3. Result: narration.wav + transcript.json ready for captions
```

This avoids manually timing captions — whisper extracts precise word boundaries from the generated audio.

## Long Scripts

For scripts longer than a few paragraphs, write the text to a `.txt` file and pass the path:

```bash
npx hyperframes tts script.txt --voice bf_emma --output narration.wav
```

The model handles long text well but very long inputs (>5 minutes of speech) may benefit from splitting into segments.

## Requirements

- Python 3.8+ with `kokoro-onnx` and `soundfile` installed (`pip install kokoro-onnx soundfile`)
- Model downloads automatically on first use (~311 MB + ~27 MB voices, cached in `~/.cache/hyperframes/tts/`)
