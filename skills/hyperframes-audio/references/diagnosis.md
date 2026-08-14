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
and the difference _is_ the defect. Nothing below is as good. Look for it before
anything else.

### 2. The pauses

The strongest reference that lives inside a single file. Speech stops; whatever
is still there in the gap is not the voice.

**What it answers: "was something added?"**

Anything audible in the pauses is additive — hum, rumble, hiss, room tone. It was
laid on top, so it can be subtracted, and this is a reliable positive finding.

**What it does NOT answer: "was something filtered?"** — and getting this
backwards is how the method produces a confident wrong answer.

A filter multiplies. Applied to a file whose gaps already sit at the
quantisation floor, it leaves them at the quantisation floor: near-silence times
anything is still near-silence. So the pause carries no trace of it. Measured on
one take with a −9 dB shelf above 2.5 kHz applied to the whole file:

|                   | 1 kHz | 5 kHz | tilt      |
| ----------------- | ----- | ----- | --------- |
| pause, undamaged  | −91.0 | −91.0 | +0.0      |
| pause, shelved    | −91.0 | −91.0 | **+0.0**  |
| speech, undamaged | −34.7 | −42.8 | −8.1      |
| speech, shelved   | −35.4 | −48.5 | **−13.1** |

The defect is a clear 5 dB in the speech and **exactly zero** in the pause.

So: **never use a null result from the pause spectrum to rule out EQ.** A run
that did exactly that — measured the pause, found it smooth, and concluded
"static EQ of any type or Q is ruled out" — went on to treat an inaudible
−72 dBFS rumble as the defect and shipped a high-pass for a file whose actual
problem was that it had no top end.

The pause spectrum _is_ a transfer function only when the gaps carry a real
recorded noise floor that passed through the same filter. A room-tone bed does;
a digitally clean take does not. Check which you have before trusting it: if the
gaps are within a few dB of the quantisation floor, this reference can find
additive content and nothing else.

### 3. The speech's own tilt, for a suspected filter

When the pause cannot see a filter (above), the only thing left carrying it is
the speech. Read the tilt across a few 1/3-octave bands rather than any single
one — `1k / 3.2k / 5k / 7k` is enough to see a shelf:

```bash
for f in 1000 3200 5000 7000; do third voice.wav $f; done
```

Speech falls away steadily above about 1 kHz, so a downward slope is expected;
what you are looking for is a slope that keeps steepening, or a step. In the
table above, −8.1 dB from 1 k to 5 k is an ordinary voice and −13.1 dB is the
same voice with 9 dB taken off the top.

**This is a candidate, not a verdict.** Where the ordinary slope ends and a
defect begins is speaker-dependent, and you have no baseline for this speaker.
Say what you measured and what it would mean, and let somebody hear it.

### 4. The file against itself over time

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

If neither the original nor usable pauses exist — continuous speech, or gaps that
are digital silence and so carry no channel — then a static tonal defect is
**genuinely under-determined**.

Report that. It is a finding, not a failure to find one, and it is the correct
answer rather than the fallback when the better methods are unavailable. Give
the author the two or three readings that fit and ask which they hear; they can
listen, and that one sentence from them collapses the whole problem.

**This is the point where a capable agent goes wrong.** Told a thing is
under-determined, the instinct is to invent a cleverer measurement and escape
it — and something will always be found, because a single voice's spectrum is
full of peaks and valleys that survive any amount of statistical rigour. An
elaborate novel method reaching a confident conclusion, on a file where the two
reliable references were both unavailable, is the _signature_ of this failure,
not evidence against it. If you notice yourself building one, stop and report
the ambiguity instead.

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
whatever is sitting under the voice. To see its _shape_, cut a pause out with
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
speaker whose F0 is 210 Hz is the speaker, not a rolloff.

The same fact runs the other way, and that direction is the trap: **a boost near
the fundamental is indistinguishable from that voice being naturally chesty.**
Both look like energy at F0, because both are.

So the rule is symmetric, and the dangerous half is the second one:

- Do not call a peak at F0 a defect on its own evidence.
- **Do not dismiss one either.** "The peak is at 200 Hz, F0 is 185 Hz, therefore
  it is the fundamental" is not a diagnosis — it is the same observation
  restated, and it discards the one candidate most likely to be real. Boominess
  _is_ excess energy at the bottom of a voice; that is what the word means.

What you can do is measure how much, against the same file's midrange:

```bash
third voice.wav 200      # or the nearest 1/3-octave band to F0
third voice.wav 1000
```

In an ordinary take these land within a couple of dB of each other. A low band
sitting **more than about 4 dB above the 1 kHz band** is a strong boom or mud
candidate. Measured across one voice damaged several ways: undamaged +0.9,
harsh +0.6, dull +2.0; boomy +6.7, muddy +5.8. Treat the figure as indicative
rather than a threshold — it is one speaker — but the separation is wide, and a
reading up at +6 is worth raising even when you cannot explain it.

It still cannot tell you whether a filter did that or the speaker did, so report
it as a candidate. That is the whole answer here: measure it, name it, hand the
choice to somebody who can hear it.

---

## Then, and only then, the symptom table

Measurement gives you the band and the kind. `SKILL.md`'s table and
`presets.md`'s fuller one turn that into a fix. Going the other way round —
picking a plausible fix and finding evidence for it — is how both wrong answers
in the evaluation happened, and both were long, careful and confident.

One habit that catches it: before applying anything, state what you would expect
to measure **if you are wrong**, and check that too.
