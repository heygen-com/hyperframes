# Transcript Guide

## How Transcripts Are Generated

`hyperframes transcribe` handles both transcription and format conversion:

```bash
# Transcribe audio/video (uses whisper.cpp locally, no API key needed)
npx hyperframes transcribe audio.mp3

# Use a larger model for better accuracy
npx hyperframes transcribe audio.mp3 --model medium.en

# Filter to English only (skips non-English speech)
npx hyperframes transcribe audio.mp3 --language en

# Import an existing transcript from another tool
npx hyperframes transcribe captions.srt
npx hyperframes transcribe captions.vtt
npx hyperframes transcribe openai-response.json
```

## Supported Input Formats

The CLI auto-detects and normalizes these formats:

| Format                | Extension | Source                                                                      | Word-level?       |
| --------------------- | --------- | --------------------------------------------------------------------------- | ----------------- |
| whisper.cpp JSON      | `.json`   | `hyperframes init --video`, `hyperframes transcribe`                        | Yes               |
| OpenAI Whisper API    | `.json`   | `openai.audio.transcriptions.create({ timestamp_granularities: ["word"] })` | Yes               |
| SRT subtitles         | `.srt`    | Video editors, subtitle tools, YouTube                                      | No (phrase-level) |
| VTT subtitles         | `.vtt`    | Web players, YouTube, transcription services                                | No (phrase-level) |
| Normalized word array | `.json`   | Pre-processed by any tool                                                   | Yes               |

**Word-level timestamps produce better captions.** SRT/VTT give phrase-level timing, which works but can't do per-word animation effects.

## Whisper Model Guide

The default model (`small.en`) balances accuracy and speed. For better results, use a larger model:

| Model       | Size   | Speed    | Accuracy  | When to use                           |
| ----------- | ------ | -------- | --------- | ------------------------------------- |
| `tiny.en`   | 75 MB  | Fastest  | Low       | Quick previews, testing pipeline      |
| `base.en`   | 142 MB | Fast     | Fair      | Short clips, clear audio              |
| `small.en`  | 466 MB | Moderate | Good      | **Default** — good for most content   |
| `medium.en` | 1.5 GB | Slow     | Very good | Important content, noisy audio, music |
| `large-v3`  | 3.1 GB | Slowest  | Best      | Multilingual, production captions     |

`.en` models are English-only and more accurate for English. Drop the `.en` suffix for multilingual (e.g., `medium` instead of `medium.en`).

**Music and vocals over instrumentation**: `small.en` will misidentify lyrics — use `medium.en` as the minimum, or import lyrics manually. Even `medium.en` struggles with heavily produced tracks; for music videos, providing known lyrics as an SRT/VTT and importing with `hyperframes transcribe lyrics.srt` will always beat automated transcription.

## Using External Transcription APIs

For the best accuracy, use an external API and import the result:

**OpenAI Whisper API** (recommended for quality):

```bash
# Generate with word timestamps, then import
curl https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file=@audio.mp3 -F model=whisper-1 \
  -F response_format=verbose_json \
  -F "timestamp_granularities[]=word" \
  -o transcript-openai.json

npx hyperframes transcribe transcript-openai.json
```

**Groq Whisper API** (fast, free tier available):

```bash
curl https://api.groq.com/openai/v1/audio/transcriptions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F file=@audio.mp3 -F model=whisper-large-v3 \
  -F response_format=verbose_json \
  -F "timestamp_granularities[]=word" \
  -o transcript-groq.json

npx hyperframes transcribe transcript-groq.json
```

## If No Transcript Exists

1. Check the project root for `transcript.json`, `.srt`, or `.vtt` files
2. If none found, ask the user to provide one or run:
   ```bash
   npx hyperframes transcribe <audio-or-video-file>
   ```
3. If transcription quality is poor (words at wrong times, gibberish), suggest upgrading the model:
   ```bash
   npx hyperframes transcribe audio.mp3 --model medium.en
   ```
