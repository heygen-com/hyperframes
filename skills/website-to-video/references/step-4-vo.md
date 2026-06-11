# Step 4: VO, Timing + Captions

## If Step 2 said "no narration"

Skip the TTS sections below. The storyboard already has beat durations planned based on pacing and rhythm — those become `data-start` and `data-duration` values directly in Step 5.

**Background music:** Ask the user before moving to Step 5:

> "Do you have a music track for this video? If not, I can suggest where to find one:
>
> - **Artlist.io** or **Musicbed** — licensed music for commercial use
> - **Uppbeat.io** or **Pixabay Music** — free tracks with attribution
> - **Freesound.org** — free samples and loops
>
> Or share a reference track ('something like this') and I can find something similar."

If the user provides a track: note the file path and BPM in the storyboard for Step 5 to wire into `index.html`. If they skip music entirely, the video uses SFX only — confirm that's intentional.

Move to Step 5.

---

## Generate a test clip before full narration — calibrate timing first

Generate a 2-sentence test clip NOW using the script's opening lines. Measure the actual duration. Kokoro compresses scripts by ~40% (35s planned → 19s actual) and HeyGen runs faster than expected. If you discover the audio is 40% shorter than expected, you'll need to revise the storyboard beat timings before investing time in full narration generation.

**Do this before committing to beat count and durations:**

```bash
# Quick Kokoro test (2 sentences):
npx hyperframes tts "First sentence. Second sentence." --voice af_nova --output /tmp/test-tts.wav
# Measure: seconds ÷ words × total script words = estimated full audio length
```

If the estimate puts your video at ±15% of the planned duration, proceed. If it's more than 15% off, recalibrate the script length first:

- **Audio TOO SHORT** (more than 15% under planned duration) → add strategic pauses. In `narration.txt`, insert blank lines between paragraphs (≈0.6s each) or `...` between sentences (≈0.4s each). Aim for the pauses to land at storyboard beat boundaries so the silence feels intentional, not dead air.
- **Audio TOO LONG** (more than 15% over planned duration) → identify the beat in your storyboard with the highest words-per-second density. Cut one supporting sentence from THAT beat's lines — preserve the lead sentence (the one that names the beat's idea). Re-measure with another test clip before committing to full generation.
- **Audio matches plan but beat boundaries drift** → adjust the storyboard durations to match the actual narration, not the other way around. The audio is the ground truth once narration is generated.

The script formula assumes constant words-per-second, but punctuation, dramatic pauses, and silence cues all stretch real audio. Always trust a measured test clip over the formula.

## Background music

**Always ask about background music** — even when narration is present:

> "Do you want background music under the narration? (Artlist.io, Musicbed for licensed; Uppbeat/Pixabay for free; or share a reference track). Even a subtle ambient underscore makes pauses between sentences feel intentional rather than empty."

If they want music, note the track in the storyboard for Step 5 to wire into `index.html`.

## TTS Provider

Ask the user which voice provider they'd like:

> **Which voice provider would you like to use for narration?**
>
> 1. **HeyGen TTS** — Good quality voices, and it returns word-level timestamps automatically (saves a separate transcription step). Requires HeyGen API key.
> 2. **ElevenLabs** — Large voice library, very natural output. Requires ElevenLabs API key. Does not return word timestamps — you'll transcribe separately.
> 3. **Kokoro** (Free) — Runs locally, no API key needed. Decent quality but more robotic than the others. Good for drafts or budget runs.

If the user picks ElevenLabs or HeyGen and doesn't have a key set up yet, help them:

- **ElevenLabs:** "Add `ELEVENLABS_API_KEY=your-key` to a `.env` file in the project root, or just paste it here and I'll set it up."
- **HeyGen:** "Add `HEYGEN_API_KEY=your-key` to a `.env` file, or paste it here."

Don't judge or critique if the user pastes a key directly in chat — just use it and move on.

## Audition voices

After the provider is selected, audition at least 2 voices with the first sentence of SCRIPT.md.

**ElevenLabs:**

- If the ElevenLabs MCP is available: use `mcp__elevenlabs__search_voices` to browse, `mcp__elevenlabs__text_to_speech` to generate.
- If no MCP: call the REST API directly:

  ```bash
  # List voices
  curl -s "https://api.elevenlabs.io/v1/voices" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" | jq '.voices[:5] | .[].name'

  # Generate speech (replace VOICE_ID with chosen voice)
  curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"text":"First sentence of your script","model_id":"eleven_multilingual_v2"}' \
    --output narration.mp3
  ```

- Does not return word timestamps — transcribe separately after generating.

**HeyGen TTS:**

- If the HeyGen MCP is available: use the TTS tool directly.
- If no MCP: use the v3 API (current; v1/v2 deprecated, supported until Oct 2026). **Auth depends on credential type:** the `x-api-key` header below works only with an **account API key** (`HEYGEN_API_KEY`). If you authenticated via **OAuth** (e.g. claude.ai / the HeyGen MCP login), `x-api-key` will 401 — send `Authorization: Bearer $HEYGEN_OAUTH_TOKEN` instead, or just use the MCP TTS tool above.

  ```bash
  # List voices — response shape: { "data": [...], "has_more": bool }
  # data is a direct list (NOT data.voices — that was v2)
  curl -s "https://api.heygen.com/v3/voices?engine=starfish&type=public&limit=20" \
    -H "x-api-key: $HEYGEN_API_KEY" | python3 -c \
    "import json,sys; v=json.load(sys.stdin)['data']; [print(x['voice_id'], x['name'], x['language']) for x in v[:10]]"

  # Generate audio — response: { "data": { "audio_url": ..., "word_timestamps": [...] } }
  curl -s -X POST "https://api.heygen.com/v3/voices/speech" \
    -H "x-api-key: $HEYGEN_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"text":"Your script here","voice_id":"VOICE_ID","speed":1.0}' \
    | python3 -c "
  import json,sys
  r=json.load(sys.stdin)
  d=r['data']
  print(d['audio_url'])
  open('transcript_raw.json','w').write(json.dumps(d.get('word_timestamps',[]),indent=2))
  "

  # Then download the audio
  curl -sL "AUDIO_URL_FROM_ABOVE" --output narration.mp3
  ```

- Returns word-level timestamps directly in the response — no separate transcription step needed.

**Kokoro (free, local):**

```bash
npx hyperframes tts SCRIPT.md --voice af_nova --output narration.wav
```

No API key, no MCP needed. Runs locally. Use `--list` to see all 54 available voices.

Pick the voice that sounds most natural and conversational. Listen for pacing — does it breathe between sentences? Does it sound like a person or a robot?

## Script length check

Before generating, verify the script makes sense for the video. Word count depends entirely on the creative direction. The storyboard's pacing and style determine how much narration the video needs.

The key check: are there stretches where NOTHING is happening — no narration AND no compelling visual movement? Those are dead spots that lose the viewer. Every second needs either spoken words or strong visual energy carrying it.

## Generate full narration

Generate the full script as `narration.wav` (or `.mp3`) in the project directory.

**If any command hangs for more than 60 seconds — don't just wait.** The user is sitting there watching you do nothing. Escalation order:

1. **Try again** — kill the process, run the same command again (transient failures are common)
2. **Try different flags** — smaller model (`--model tiny.en`), different voice, shorter test sentence first
3. **Try a different tool for the same task** — if `hyperframes transcribe` hangs, try `whisper-cli` directly, or Groq API (`npx hyperframes transcribe --provider groq`), or OpenAI API
4. **Switch provider entirely** — if ElevenLabs is down, try HeyGen or Kokoro. If Kokoro hangs, try ElevenLabs.

Never sit idle for 10 minutes hoping a stuck process will finish.

**Kokoro pronunciation issues:** Kokoro mispronounces product names and tech terms. Always apply substitutions before generating. Known problems and fixes:

- `API` → `A P I` (spell it out)
- `UI` → `U I`, `SaaS` → `sass`, `DevOps` → `dev ops`
- Product names with unusual spelling: test the first sentence first and listen. Common failure: "Vercel" → "versatile", "WorkOS" → "work O S", "One API" → "Wanna PI"
- If a name sounds wrong: write it phonetically in `narration.txt` (e.g., `Vercel` → `Ver-sell`, `Supabase` → `Soopa-base`)
- Always generate a short test clip with the first 2 sentences before generating the full audio
- **No SSML tags** — Kokoro reads them as literal text. `<break time="1s"/>` is spoken as "break time equals one slash." Use blank lines or `...` for pauses in `narration.txt`

For ElevenLabs and HeyGen TTS, substitutions are usually unnecessary — they handle product names correctly.

**Also save the exact spoken text** — with pronunciation substitutions applied (e.g., `API` → `A P I`, `$2T` → `two trillion` and etc.) — as `narration.txt` in the same directory. This is the string passed to TTS, distinct from `SCRIPT.md` which is the human-readable creative doc. Having `narration.txt` makes it trivial to regenerate the audio later with a different voice without re-deriving the substitutions. Name it exactly `narration.txt`.

## Transcribe for word-level timestamps

**If you used HeyGen v3 TTS:** word timestamps were returned in the generate call. Normalize the format before saving — HeyGen v3 uses `word` but the pipeline expects `text`:

```python
import json
raw = json.load(open('transcript_raw.json'))
normalized = [{"text": w["word"], "start": w["start"], "end": w["end"]} for w in raw]
json.dump(normalized, open('transcript.json', 'w'), indent=2)
```

No separate transcription step needed.

**If you used ElevenLabs or Kokoro:**

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

Update STORYBOARD.md with real durations. Replace estimated times (e.g., "0:00-0:05") with actual timestamps as precise as possible (e.g., "0.00-3.21s").

Beat boundaries land on word onsets — hard cuts to the VO.

## Timing reconciliation — required before Step 5

After mapping all beats, compare real total audio duration against the storyboard's planned duration:

```
real_total = last_word.end + cta_hold (typically 2–3s)
planned_total = sum of all beat planned durations
delta = |real_total - planned_total|
```

**If delta > 15% of planned total — do not proceed to Step 5 without resolving it.** Common causes and fixes:

- **Audio shorter than planned (most common with Kokoro):** Kokoro generates compressed speech with minimal pauses. Proportionally scale all non-CTA beat durations down to match the real audio. Example: planned 30s, audio 19s — multiply each beat duration by 19/30 (excluding the CTA hold). Update STORYBOARD.md.
- **Audio much longer than planned (>30% over):** The script was too long for the intended duration. Trim the script (remove one beat's VO), regenerate audio, re-transcribe.
- **CTA beat timing:** The CTA beat should hold for 2–3 seconds after the last spoken word — not extend to fill empty time. `cta_start = last_word.end + 0.3s`, `cta_duration = 2.5s`. Hard cap. Dead silence after the CTA hold loses the viewer.

**Always tell the user** if you adjusted durations significantly from the storyboard plan. They approved a specific beat structure — if it changed, they need to know.

## Captions

After the narration is generated and transcribed, ask the user:

> **Would you like captions on the video?**
>
> - **Yes** — per-word captions synced to the narration. Great for social media (most viewers watch on mute) and accessibility.
> - **No** — narration audio only, no text overlay.

If yes, captions are built as a separate composition (`compositions/captions.html`) in Step 5. The `transcript.json` drives the timing — each word appears/highlights as it's spoken. Read [the captions reference](../../hyperframes/references/captions.md) for styling options (scale-pop, typewriter, fade+slide, etc.) and positioning rules.

## Save timing data for Step 5

Record the final beat timings (start, duration) so Step 5 (Build) can use them when building `index.html`. The storyboard now has real timestamps — these become `data-start` and `data-duration` values on each scene slot when the root composition is assembled in Step 5.
