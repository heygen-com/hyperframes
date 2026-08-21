# Audio engine — voiceover, music, SFX, captions, transcription

For a full audio pass (TTS voiceover + background music + sound effects in one
shot), use the shared engine at `audio/scripts/audio.mjs`. It takes a neutral
`audio_request.json` and writes `audio_meta.json` plus assets under
`.media/audio/{voice,bgm,sfx}`:

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json
```

- **Request** `{ provider?, lang?, speed?, lines: [{ id, text, sfx?: [names] }], bgm: { mode?, query?, prompt? } }`: `id` joins each line back to your model; `bgm.mode` = `retrieve | generate | none` (omit for auto). `--only tts,bgm,sfx` runs a subset and merges into an existing `--out`.
- **Output** `audio_meta.json` (id-keyed): `voices[].{path,duration_s,words[]}` (word timestamps for captions), `sfx[]`, `bgm`, `total_duration_s`.
- **HeyGen free-usage path**: HeyGen CLI auth unlocks TTS plus music/SFX retrieval. Local/provider-specific generators are explicit alternatives where installed; run `node <SKILL_DIR>/scripts/resolve.mjs --doctor` before assuming retrieval or TTS will work.
- If BGM took the generate path (`bgm_pending: true`), run `audio/scripts/wait-bgm.mjs` before final render.

Single-shot helpers: `audio/scripts/heygen-tts.mjs` (one voice file). Transcription / background removal / captions use the `hyperframes` CLI (`transcribe`, `remove-background`), see the per-topic guides in `audio/references/` (`tts.md`, `bgm.md`, `sfx.md`, `transcribe.md`, `remove-background.md`, `captions/`).

Transcription defaults to Parakeet (better than whisper.cpp: 6.05% vs 7.44% WER, 5-10x faster) via `scripts/transcribe.mjs`, with whisper.cpp auto-fallback (see `references/operations.md`).
