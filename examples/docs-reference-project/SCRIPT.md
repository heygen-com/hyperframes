# SCRIPT — example.com intro

**Voice:** River — ElevenLabs, voice id `SAz9YHcvj6GT2YYXdXww`
**Model:** `eleven_multilingual_v2` · `mp3_44100_128` → 44.1 kHz mono WAV
**Voice direction:** Calm and unhurried. Low-key confidence, no sell. Read it the way
you would read a footnote you happen to find interesting.

The whole script is **one** synthesis call so the sentence-to-sentence prosody is real
rather than three clips butted together. The `**Time:**` values below are not
estimates — they are the measured word timings from
`npx hyperframes transcribe assets/narration.wav --model small.en`, offset by the
narration clip's `data-start` of `1.00s`.

---

## Line 1 — Name it (Frame 1)

**Time:** 1.10 – 2.81s
**Delivery:** Flat, factual. The period is real; let it land.

    This is example dot com.

## Line 2 — What it is for (Frame 1)

**Time:** 2.81 – 5.38s
**Delivery:** Slightly warmer. "Reserved" carries the sentence.

    The domain reserved for documentation examples.

## Line 3 — The payoff (Frame 1)

**Time:** 5.48 – 7.68s
**Delivery:** The lift of the piece, but quiet. Space before "no permission needed."

    Use it in your docs — no permission needed.

---

## Spoken vs. captioned

One deliberate divergence: the TTS text says **"example dot com"** because that is how
the string is pronounced; the caption reads **"example.com"** because that is how the
string is written. Whisper transcribed the spoken form back as `example.com,`, which is
why the caption group's word timing for it spans a full 1.27s.

## Regenerating

```bash
# 1 — synthesize (ElevenLabs, via the /media-use audio engine)
node -e '
  import("'"$HOME"'/.claude/skills/media-use/audio/scripts/lib/tts.mjs").then(m =>
    m.synthesizeOne({
      provider: "elevenlabs",
      voiceId: "SAz9YHcvj6GT2YYXdXww",
      text: "This is example dot com. The domain reserved for documentation examples. Use it in your docs — no permission needed.",
      wavAbs: process.cwd() + "/.work/narration.raw",
      hyperframesDir: process.cwd(),
    }).then(r => console.log(r)))'

# 2 — normalize to 44.1k mono PCM
ffmpeg -y -i .work/narration.raw -ac 1 -ar 44100 -c:a pcm_s16le assets/narration.wav

# 3 — word timings for the caption groups
npx hyperframes transcribe assets/narration.wav --model small.en
```

Step 3 rewrites `.work/transcript.json`. If the timings move, the caption group
boundaries in `compositions/captions.html` and the `WORDS` table in this file's
consumer must move with them — they are hand-committed on purpose so the composition
has no build step.
