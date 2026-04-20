# Step 5: Generate VO + Map Timing

## Audition voices

Never use the first voice you find. Audition 2-3 voices with the first sentence of SCRIPT.md:

- **Kokoro** (try first — free, no API key) — `npx hyperframes tts SCRIPT.md --voice af_nova --output narration.wav`. Runs locally on CPU. Requires Python 3.10+ (macOS system Python 3.9 won't work — if it fails with an onnxruntime error, move to the next option).
- **ElevenLabs** (best voice quality, widest selection) — `mcp__elevenlabs__search_voices` to browse, `mcp__elevenlabs__text_to_speech` to generate. Does not return timestamps — transcribe separately after.
- **HeyGen TTS** (returns word timestamps automatically — saves a transcribe step) — `mcp__claude_ai_HeyGen__text_to_speech`. Use when you want timestamps without a separate transcription pass.

Pick the voice that sounds most natural and conversational. Listen for pacing — does it breathe between sentences? Does it sound like a person or a robot?

## Generate full narration

Generate the full script as `narration.wav` (or `.mp3`) in the project directory.

**Also save the exact spoken text** — with pronunciation substitutions applied (e.g., `API` → `A P I`, `$2T` → `two trillion`) — as `narration.txt` in the same directory. This is the string passed to TTS, distinct from `SCRIPT.md` which is the human-readable creative doc. Having `narration.txt` makes it trivial to regenerate the audio later with a different voice without re-deriving the substitutions. Name it exactly `narration.txt`.

## Transcribe for word-level timestamps

```bash
npx hyperframes transcribe narration.wav
```

Produces `transcript.json` with `[{ text, start, end }]` for every word. These timestamps are the source of truth for all beat durations.

## Map timestamps to beats

Go through STORYBOARD.md beat by beat. For each beat:

1. Find the first word of that beat's VO cue in `transcript.json`
2. Find the last word of that beat's VO cue
3. Set `beat.start = firstWord.start`, `beat.end = lastWord.end`
4. Add 0.3-0.5s padding at the end for visual breathing room

Update STORYBOARD.md with real durations. Replace estimated times (e.g., "0:00-0:05") with actual timestamps (e.g., "0.00-3.21s").

Beat boundaries land on word onsets — hard cuts to the VO.

## Update index.html

Update each scene slot's `data-start` and `data-duration` to match the real beat timings from the transcript. Also update the total composition duration and audio element duration.
