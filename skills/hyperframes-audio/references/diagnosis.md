# Diagnosing audio you cannot hear

The symptom table in `SKILL.md` starts from "it sounds boomy". That presumes
somebody already listened and said so. Handed a file and "fix this", you have
no such sentence — and you cannot listen. This is how to get one.

It is worth being blunt about the difficulty first, because the failure mode is
not "no answer", it is **a confident wrong answer**:

> **The absolute spectrum of a single unknown voice cannot be diagnosed.**

Every voice has peaks and dips of exactly the size an injected filter has.
Formants are ±10 dB. A speaker's fundamental sits anywhere from 85 to 255 Hz.
Sentences decline 5–6 dB from start to end as a matter of ordinary prosody. Look
at one spectrum on its own and you will find "defects" in all of it, and the
ones you find will be the speaker.

So diagnosis is always **comparison**. The whole method is choosing the right
thing to compare against.

---

## Compare against something inside the same file

Ranked by how much they can tell you. Prefer the highest one available.

### 1. The clean original, if it exists

If the undamaged take is on disk, this is the whole job — measure both, subtract,
and the difference *is* the defect. Nothing below is as good. Look for it before
anything else.

### 2. The pauses

The strongest reference that lives inside a single file. Speech stops; whatever
is still there in the gap is not the voice.

- **Anything audible in the pauses is additive** — hum, rumble, hiss, room tone.
  It was laid on top, so it can be subtracted.
- **The pause spectrum is the file's own transfer function.** Silence carries no
  consonants, so a hump in the noise floor at 7 kHz is the channel, not
  sibilance. This is the measurement that separates "an EQ was applied" from
  "this speaker is just bright" — and it is the one that cannot be faked by
  reasoning about the voice.

### 3. The file against itself over time

For anything level-related, compare each passage to the track's own median rather
than to a target. That is what `levellingResult` does, and it is why an already
even track comes back untouched.

---

## Do not compare against a different voice

Both wrong answers in the evaluation that produced this page came from an
external reference, and both were argued rigorously from bad ground:

- **A published average spectrum** (LTASS and friends). One run concluded
  "+10 dB above 7 kHz, split-half stable, gating-independent" on a file whose
  actual defect was +6.6 dB at 200 Hz. Its supporting claim — 10 kHz sitting
  6.2 dB above 6.3 kHz — measured 0.6 dB on re-check, and measured the same in
  the clean original. Published curves are mixed-sex, mixed-corpus, and
  mixed-microphone; the gap between them and any one speaker is larger than most
  defects.
- **A synthesised control voice** (`say`, a TTS take, another narrator). One run
  generated a control this way, found the spectrum "normal", and missed a −6.9 dB
  shelf. Two speakers differ by more than 7 dB across the top octaves as a matter
  of course, so a cross-voice comparison cannot resolve a defect that size.

If neither the original nor usable pauses exist — continuous speech, no silence,
no reference — then a static tonal defect is **genuinely under-determined**. Say
so. Offer the author the two or three readings that fit, and ask which they hear.
That is a better answer than a chain built on a guess, and much better than one
built on a published average.

---

## Recipes

All verified with ffmpeg 8.1.1. `-hide_banner` keeps the output readable;
`volumedetect` prints to stderr, so do not silence it with `-v error`.

### Band energy, in proportional bands

**Use proportional bandwidths or the numbers lie.** A fixed 2000 Hz-wide band at
10 kHz collects more energy than a 1200 Hz-wide band at 6.3 kHz for no reason but
its width, which manufactures a high-frequency excess that is not there. One
third of an octave is `f × 0.2316`.

```bash
third() {
  w=$(python3 -c "print(round($2*0.2316))")
  ffmpeg -hide_banner -i "$1" -af "bandpass=f=$2:width_type=h:w=$w,volumedetect" \
    -f null - 2>&1 | grep -m1 mean_volume
}
third voice.wav 200     # weight / boom
third voice.wav 3200    # presence / harshness
```

Read them as a shape across 100 / 200 / 400 / 1k / 3.2k / 7k, and read the shape
against a reference from the list above — never on its own.

### The noise floor, and what is in it

```bash
ffmpeg -hide_banner -i voice.wav -af astats=metadata=1 -f null - 2>&1 | grep -i 'noise floor'
```

`-inf` means digital silence in the gaps: no additive noise, so rumble, hiss and
room tone are all ruled out in one command. A real number is the level of
whatever is sitting under the voice. To see its *shape*, cut a pause out with
`-ss`/`-t` and run the band recipe on that slice alone.

### Level over time

```bash
ffmpeg -hide_banner -i voice.wav -af ebur128=framelog=quiet -f null - 2>&1 | tail -6
```

LRA under ~3 LU is even. Then window it, because LRA hides a single sagging
passage:

```bash
for s in 0 1.2 2.4 3.6 4.8 6.0; do
  ffmpeg -hide_banner -ss $s -t 1.2 -i voice.wav -af volumedetect -f null - 2>&1 |
    grep -m1 mean_volume
done
```

**A 4–6 dB spread across windows is normal speech**, not a defect — sentences
decline as they end. Injected unevenness looks like 12 dB or more. Levelling a
track that only has declination flattens the prosody and is heard as robotic.

### Pitch, before blaming the low end

```bash
ffmpeg -hide_banner -i voice.wav -af "lowpass=f=400,astats=metadata=1" -f null - 2>&1 | grep -i 'peak level'
```

A voice has no energy below its own fundamental, so a "missing" 100 Hz on a
speaker whose F0 is 210 Hz is the speaker, not a rolloff. The same fact runs the
other way and is the harder trap: **a boost at 200 Hz on a voice whose
fundamental is near 200 Hz is nearly indistinguishable from that voice being
naturally chesty.** Without a pause reference or the original, name the
ambiguity rather than resolving it by assertion.

---

## Then, and only then, the symptom table

Measurement gives you the band and the kind. `SKILL.md`'s table and
`presets.md`'s fuller one turn that into a fix. Going the other way round —
picking a plausible fix and finding evidence for it — is how both wrong answers
in the evaluation happened, and both were long, careful and confident.

One habit that catches it: before applying anything, state what you would expect
to measure **if you are wrong**, and check that too.
