# TTS → Captions

When no recorded voiceover exists, generate one and obtain word-level caption timing. Two paths depending on which TTS provider is in use:

## Path A — HeyGen (single call, no Whisper)

HeyGen returns word timestamps in the same response as the audio. Pass `--words` and you're done:

```bash
npx hyperframes tts script.txt --provider heygen --output narration.wav --words narration.words.json
```

`narration.words.json` is already in the `[{ id, text, start, end }]` shape the captions pipeline consumes — no separate transcribe pass.

## Path B — ElevenLabs / Kokoro (TTS → Whisper)

These providers don't return word data. Generate the audio, then transcribe:

```bash
npx hyperframes tts script.txt --voice af_heart --output narration.wav
npx hyperframes transcribe narration.wav --model small.en   # voice af_heart is American English
```

Whisper extracts precise word boundaries from the generated audio, so caption timing matches delivery without hand-tuning. Match `--model` to the voice's language (use `small.en` for `a`/`b` prefixes, `small --language <code>` otherwise). Then consume `transcript.json` via the caption references in `captions/`.
