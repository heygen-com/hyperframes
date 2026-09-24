# TTS → Captions

When no recorded voiceover exists, generate one and obtain word-level caption timing. Two paths depending on which TTS provider is in use:

## Path A — HeyGen (single call, no Whisper)

HeyGen returns word timestamps in the same response as the audio. Use the
bundled REST helper (the `hyperframes tts` command is Kokoro-only):

```bash
node skills/media-use/audio/scripts/heygen-tts.mjs \
  script.txt --output narration.wav --words narration.words.json
```

`narration.words.json` is already in the `[{ id, text, start, end }]` shape the captions pipeline consumes — no separate transcribe pass.

## Path B — Gemini / ElevenLabs / Kokoro (TTS → transcription)

These adapters supply audio without word data. The shared audio engine runs
transcription automatically when timings are absent. For Gemini, use the
request in [Text to speech](tts.md#gemini-narration), then consume
`audio_meta.json` → `voices[].words`.

For a standalone local Kokoro generation, generate the audio, then transcribe:

```bash
npx hyperframes tts script.txt --voice af_heart --output narration.wav
npx hyperframes transcribe narration.wav --model small.en   # voice af_heart is American English
```

Whisper extracts precise word boundaries from the generated audio, so caption timing matches delivery without hand-tuning. Match `--model` to the voice's language (use `small.en` for `a`/`b` prefixes, `small --language <code>` otherwise). Then consume `transcript.json` via the caption references in `captions/`.

For Gemini, verify that transcription preserved the script, especially names,
numbers, and delivery pauses. If `words` is empty, resolve the transcription
failure before captioning. Generate and align again after changing the read.
