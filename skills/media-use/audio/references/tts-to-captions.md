# TTS → Captions

When no recorded voiceover exists, generate one and obtain word-level caption timing. Two paths depending on which TTS provider is in use.

## Path A — HeyGen (single call, no Whisper)

HeyGen returns word timestamps in the same response as the audio. Use the standalone HeyGen helper script and pass `--words`:

```bash
node skills/media-use/audio/scripts/heygen-tts.mjs script.txt -o narration.wav --words narration.words.json
```

`narration.words.json` is already in the `[{ id, text, start, end }]` shape the captions pipeline consumes — no separate transcribe pass.

## Path B — ElevenLabs / Cartesia / Kokoro (TTS → Whisper)

These providers don't return word data. Generate the audio through the shared audio engine, then transcribe:

```bash
# audio_request.json
# {
#   "provider": "cartesia",
#   "lines": [{ "id": "01", "text": "Welcome to HyperFrames." }]
# }

node skills/media-use/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json
npx hyperframes transcribe assets/voice/01.wav --model small.en
```

Whisper extracts precise word boundaries from the generated audio, so caption timing matches delivery without hand-tuning. Match `--model` to the voice's language (use `small.en` for `a`/`b` prefixes and Cartesia English, `small --language <code>` otherwise). Then consume `transcript.json` via the caption references in `captions/`.

The local `npx hyperframes tts` command is Kokoro-only. It does not accept `--provider` for cloud voices; cloud providers are accessed through the shared audio engine request above.
