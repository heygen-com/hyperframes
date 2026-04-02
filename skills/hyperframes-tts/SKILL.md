---
name: hyperframes-tts
description: Text-to-speech generation using Kokoro-82M. Voice selection, speed control, and audio output for narration and voiceovers in HyperFrames compositions.
trigger: Generating speech audio from text — narration, voiceover, text-to-speech, TTS, audio generation from script.
---

# Text-to-Speech (Kokoro-82M)

## Quick Start

```bash
# Generate speech from text (saves to speech.wav)
npx hyperframes tts "Welcome to HyperFrames"

# Choose a voice and output path
npx hyperframes tts "Hello world" --voice am_adam --output narration.wav

# Read from a text file
npx hyperframes tts script.txt --voice bf_emma

# Adjust speed (0.1 to 3.0)
npx hyperframes tts "Slow and clear" --speed 0.8

# List all available voices
npx hyperframes tts --list

# JSON output for scripting
npx hyperframes tts "Hello" --json
```

## Voice Selection

The model ships with **54 voices across 8 languages**. Recommended voices:

### English (US)

| ID           | Name    | Gender | Character                         |
| ------------ | ------- | ------ | --------------------------------- |
| `af_heart`   | Heart   | Female | Warm, natural — **default voice** |
| `af_nova`    | Nova    | Female | Clear, professional               |
| `af_sky`     | Sky     | Female | Bright, energetic                 |
| `am_adam`    | Adam    | Male   | Neutral, versatile                |
| `am_michael` | Michael | Male   | Deep, authoritative               |

### English (UK)

| ID            | Name     | Gender | Character             |
| ------------- | -------- | ------ | --------------------- |
| `bf_emma`     | Emma     | Female | British, professional |
| `bf_isabella` | Isabella | Female | British, warm         |
| `bm_george`   | George   | Male   | British, formal       |

### Other Languages

Kokoro supports Japanese, Chinese, Korean, French, German, Italian, and Portuguese voices. Use any valid Kokoro voice ID — see the [full voice list](https://github.com/thewh1teagle/kokoro-onnx).

## Voice Selection Guidelines

Match the voice to the content:

| Content Type      | Recommended Voice        | Why                                |
| ----------------- | ------------------------ | ---------------------------------- |
| Product demo      | `af_heart` or `af_nova`  | Warm and clear, professional feel  |
| Tutorial / how-to | `am_adam` or `bf_emma`   | Neutral, easy to follow            |
| Marketing / promo | `af_sky` or `am_michael` | Energetic or authoritative         |
| Documentation     | `bf_emma` or `bm_george` | Clear British English, formal tone |
| Casual / social   | `af_heart` or `af_sky`   | Approachable, natural              |

## Speed Control

- **0.8** — Slow, deliberate. Good for tutorials and complex content.
- **1.0** — Natural pace (default).
- **1.2** — Slightly faster. Good for intros and transitions.
- **1.5+** — Fast. Use sparingly.

## Using TTS with Compositions

Generate a voiceover and use it as the audio track for a composition:

```bash
# 1. Generate narration
npx hyperframes tts "Your script here" --voice af_nova --output narration.wav

# 2. Use in a composition (set as audio source)
# In your HTML composition, reference the audio:
# <div data-audio="narration.wav" data-duration="auto">
```

## Combining with Transcription

For captions on generated speech:

```bash
# 1. Generate speech
npx hyperframes tts script.txt --voice af_heart --output narration.wav

# 2. Transcribe it back for word-level timestamps
npx hyperframes transcribe narration.wav

# 3. Now you have both the audio and transcript.json for captions
```

## Technical Details

- **Model**: Kokoro-82M (ONNX, ~311 MB download, cached at `~/.cache/hyperframes/tts/`)
- **Voices**: Bundled voices file (~27 MB, cached alongside model)
- **Runtime**: Python 3.8+ with `kokoro-onnx` (auto-installed on first run)
- **Speed**: ~5x realtime on CPU (a 10-second clip generates in ~2 seconds)
- **Output**: WAV format (16-bit PCM, 24kHz)
- **License**: Apache 2.0 (model), MIT (kokoro-onnx wrapper)
