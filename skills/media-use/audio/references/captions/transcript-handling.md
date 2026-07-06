# Transcript Guide

For the `transcribe` CLI invocation, the `.en`-translates-non-English rule, and whisper model selection, see [`../transcribe.md`](../transcribe.md). This file covers what to do with the resulting transcript when authoring captions: input formats, mandatory quality checks, cleaning code, external-API fallbacks.

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

## Transcript Quality Check (Mandatory)

After every transcription, **read the transcript and check for quality issues before proceeding.** Bad transcripts produce nonsensical captions. Never skip this step.

### What to look for

| Signal                       | Example                                | Cause                                                                        |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| Music note tokens (`♪`, `�`) | `{ "text": "♪" }` or `{ "text": "�" }` | Whisper detected music, not speech                                           |
| Garbled / nonsense words     | "Do a chin", "Get so gay", "huh"       | Model misheard lyrics or background noise                                    |
| Long gaps with no words      | 20+ seconds of only `♪` tokens         | Instrumental section — expected, but high ratio means speech is being missed |
| Repeated filler              | Many "huh", "uh", "oh" entries         | Model is hallucinating on music                                              |
| Very short word spans        | Words with `end - start < 0.05`        | Unreliable timestamp alignment                                               |

### Automatic retry rules

**If more than 20% of entries are `♪`/`�` tokens, or the transcript contains obvious nonsense words, the transcription failed.** Do not proceed with the bad transcript. Instead:

1. **Retry with `medium.en`** if the original used `small.en` or smaller:
   ```bash
   npx hyperframes transcribe audio.mp3 --model medium.en
   ```
2. **If `medium.en` also fails** (still >20% music tokens or garbled), tell the user the audio is too noisy for local transcription and suggest:
   - Providing lyrics manually as an SRT/VTT file
   - Using an external API (OpenAI or Groq Whisper — see below)
3. **Always clean the transcript** before building captions — filter out `♪`/`�` tokens and entries where `text` is a single non-word character. Only real words should reach the caption composition.

### Cleaning a transcript

After transcription (even with a good model), strip non-word entries:

```js
var raw = JSON.parse(transcriptJson);
var words = raw.filter(function (w) {
  if (!w.text || w.text.trim().length === 0) return false;
  if (/^[♪�\u266a\u266b\u266c\u266d\u266e\u266f]+$/.test(w.text)) return false;
  if (/^(huh|uh|um|ah|oh)$/i.test(w.text) && w.end - w.start < 0.1) return false;
  return true;
});
```

For model-selection guidance by content type, see [`../transcribe.md`](../transcribe.md) → "Picking a model by content type".

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

1. Check the project root for `transcript.json`, `.srt`, or `.vtt` files.
2. If none found, run [`../transcribe.md`](../transcribe.md) — pick the starting model from "Picking a model by content type" there.
3. Run the quality check above. If it fails, retry with a larger model or fall back to manual lyrics / external API.
