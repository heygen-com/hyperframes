# Presets, jobs and one-knob profiles

Everything here is a shortcut to a chain you could have built by hand. A preset
writes ordinary nodes tagged with `fromPreset`, a job writes one ordinary node
with a name, and a profile is one control over several parameters of one effect.
Nothing is opaque: open any of them and you find effects from
[`fx-registry.md`](./fx-registry.md) with their parameters showing.

Reach for one when it names the problem you actually have. Build by hand when
none of them does — a preset applied because it was nearby is worse than three
deliberate nodes.

---

## Diagnose first: what to listen for, and what fixes it

Work from the symptom, not from the effect list. Most bad audio is one or two of
these, and the fix is usually a job rather than a whole preset.

| It sounds like                                | Where it lives | Reach for                                                    |
| --------------------------------------------- | -------------- | ------------------------------------------------------------ |
| Hum, rumble, traffic, footsteps, handling     | 20–80 Hz       | `rumble-cut` preset, or a `highpass` at 80 Hz                |
| Boomy, chesty, too close to the mic           | 80–250 Hz      | **Tame Boominess** job (200 Hz, −4 dB)                       |
| Muffled, like it is behind cardboard          | 250–600 Hz     | **Reduce Mud** job (250 Hz, −3 dB)                           |
| Boxy, like a small room                       | ~400 Hz        | **Reduce Boxiness** job (400 Hz, −3 dB)                      |
| Words hard to make out, sits behind the music | 2–5 kHz        | **Add Clarity** job (3 kHz, +2.5 dB), or carve the bed       |
| Harsh, brittle, tiring over a whole listen    | 3–5 kHz        | **Soften Harshness** job (3.2 kHz, −3 dB)                    |
| Sibilant — `s` sounds spitting                | 5–10 kHz       | Nothing shipped does this properly; see "Not covered" below  |
| Dull, closed-in, lifeless                     | 10–20 kHz      | `highshelf` lift, or `voice-broadcast` which includes one    |
| Some words much louder than others            | not a band     | **Evenness** profile on a `compressor`, or `levellingResult` |
| Room tone audible between sentences           | not a band     | `room-gate` preset (**Tightness** profile)                   |
| Peaks clipping or spiking                     | not a band     | `limiter` last in the chain — every voice preset ends in one |
| Voice and music fighting each other           | 1–3 kHz mostly | **Voiceover carve**, not an EQ on either track               |
| Dry, stuck to the speaker, recorded nowhere   | not a band     | `room-tight` or `room-natural`                               |

**The band vocabulary** these map onto — the same names the rack shows:

| Range          | Name     | What lives there             |
| -------------- | -------- | ---------------------------- |
| 20–80 Hz       | Rumble   | traffic, footsteps, handling |
| 80–250 Hz      | Weight   | chest, body, warmth          |
| 250–600 Hz     | Mud      | boxy, muffled, cardboard     |
| 600–2000 Hz    | Middle   | the body of a voice          |
| 2000–5000 Hz   | Presence | consonants, intelligibility  |
| 5000–10000 Hz  | Edge     | sibilance, harshness         |
| 10000–20000 Hz | Air      | sparkle, openness            |

### Order of operations

Diagnose in this order, because each step changes what the next one hears:

1. **Subtract before you add.** Cut rumble and mud first. A voice that sounds
   dull often has too much low-mid, not too little top — lifting the top of a
   muddy voice makes it muddy _and_ harsh.
2. **Level after you filter.** A compressor reacts to whatever is loudest, and
   a rumble it can no longer see is a rumble it stops chasing.
3. **Relationships after level.** Carve a bed against a voice once the voice
   itself is settled, or the analysis measures a problem you are about to fix.
4. **Character, then ceiling.** Saturation and space go late; a `limiter` goes
   last, where it can actually act as a ceiling. Anything after it is not
   bounded by it.

---

## Presets

Four families, listed in full below. Apply one and it **appends** — stacking a character preset
onto an already-cleaned voice is a real thing to want. Re-applying one that is
already present replaces its own nodes in place, because position in the chain
is signal order.

### Voice — make a real voice sound like its better self

| Preset            | Answers                         | Chain                                                                                               |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `voice-clean`     | "My voice sounds amateur"       | Remove Rumble → Reduce Mud → Even Out Loudness → Add Clarity → Peak Ceiling                         |
| `voice-broadcast` | "I want it to sound like radio" | Remove Rumble → Reduce Boxiness → Even Out Loudness → Add Clarity → Add Air → Warmth → Peak Ceiling |
| `voice-warm`      | "I want it intimate and close"  | Remove Rumble → Add Weight → Even Out Loudness → Add Clarity → Peak Ceiling                         |

`voice-clean` is the default answer to "fix this voiceover". The other two are
the same idea pushed in one direction: broadcast is denser and more forward,
warm has body added rather than cut.

### Repair — one problem, one node

| Preset       | Answers                                 | Does                                                                        |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------- |
| `rumble-cut` | "There's a hum or thump underneath"     | High-pass under the voice                                                   |
| `room-gate`  | "I can hear the room between sentences" | Closes the pauses. **Does not remove noise** — room tone under speech stays |
| `boom-tame`  | "My voice sounds boomy"                 | Cuts the chestiness of a too-close mic                                      |
| `harsh-tame` | "It's harsh and tiring to listen to"    | Rounds a brittle upper-mid, broad and always-on                             |

### Character — deliberate, not corrective

`telephone`, `radio-am`, `megaphone`, `lofi-tape`, `pa-system` (Tannoy),
`intercom`, `doofus-worble`.

These are costumes. Each is a band restriction plus a resonance plus its own kind
of dirt, and they are tuned to be distinguishable from one another — measured on
a log sweep, no two sit closer than the signal itself. Do not stack two.

### Space — put it somewhere

`room-tight` (presence without wash), `room-natural` (recorded somewhere rather
than nowhere), `hall` (far back and big), `slap-echo` (one quick repeat),
`dub-throw` (repeats trailing well behind).

Use these on whatever should sit _behind_ something else, and keep the wet amount
lower than sounds right in isolation — a tail occupies the room a voice needs.

### The whole preset as one control

A preset's nodes are wrapped in a wet/dry blend, so `presetAmount` (0..1) fades
the entire thing in or out, and `fx.preset.<id>` is an automation target that
ramps it over time. This is the only way to automate a preset as a unit: its
nodes share no common parameter, and worklet effects (compressor, limiter, gate,
bitcrush) expose no automatable parameters at all.

---

## Jobs — the range IS the module

Five named peaking filters with the frequency already chosen. Picking the job is
picking the range, which is what makes a single "how much" knob honest.

| Job              | Symptom                              | Sets                  |
| ---------------- | ------------------------------------ | --------------------- |
| Tame Boominess   | Too much chest — it booms            | 200 Hz, −4 dB, Q 1.4  |
| Reduce Mud       | Muffled, like it is behind cardboard | 250 Hz, −3 dB, Q 1.2  |
| Reduce Boxiness  | Sounds like a small room, or a box   | 400 Hz, −3 dB, Q 1.4  |
| Add Clarity      | Words are hard to make out           | 3 kHz, +2.5 dB, Q 1   |
| Soften Harshness | Harsh and tiring to listen to        | 3.2 kHz, −3 dB, Q 1.6 |

Each is an ordinary `peaking` node underneath — the frequency is a starting
point, not a cage. Prefer a job to a bare `peaking` when one matches: it arrives
already aimed, and the rack names it for the work rather than the mechanism.

Writing one by hand, **carry the name in `label`** — `{"type":"peaking","id":"n2",
"label":"Reduce Mud","params":{"frequency":250,"gain":-3,"q":1.2}}`. The
parameters alone are not the job. A chain with three unlabelled `peaking` nodes
shows the author three identical rows, which is the exact problem jobs exist to
dissolve.

**Every job also ships inside a preset, at identical settings** — that is where
the five came from. `boom-tame` _is_ Tame Boominess; `harsh-tame` _is_ Soften
Harshness; `voice-clean` contains Reduce Mud and Add Clarity; `voice-broadcast`
contains Reduce Boxiness. So check what a preset already contains before adding
a job on top of it, or the cut lands twice — `voice-clean` plus a Reduce Mud job
is −6 dB at 250 Hz where −3 was meant. The rack shows the contained nodes by
name once the preset is expanded, which is the fastest way to see it.

---

## One-knob profiles

Five effects have no single parameter that can honestly be their face — a
compressor's threshold means nothing without its ratio. They get a derived
control instead, 0..1, which sets several parameters together.

| Effect       | Knob      | 0 → 1                                      | Sets                                      |
| ------------ | --------- | ------------------------------------------ | ----------------------------------------- |
| `compressor` | Evenness  | Barely touched → Very even, quite squashed | threshold, ratio, attack, release, makeup |
| `gate`       | Tightness | Only true silence → Cuts quiet words too   | threshold, range, release                 |
| `saturate`   | Warmth    | Just a sheen → Openly distorted            | threshold, output                         |
| `reverb`     | Space     | A small tight room → A big open hall       | size, wet, dry                            |
| `bitcrush`   | Crush     | Slightly gritty → Destroyed                | bits, samples, mix                        |

**Evenness, Warmth and Space are level-matched** — the make-up gain, the output
trim and the dry leg move with the drive, so turning the knob up does not also
turn the track up or down. Those figures were solved by measurement, not chosen:
the compressor originally left a track 2.5 dB _quieter_ at full evenness, and
saturation's trim ran the wrong way entirely.

Tightness and Crush are not level-matched, because neither has a trim to move —
a gate only removes, and Crush's `mix` is the effect itself rather than a
make-up.

The chain stores the mechanism values, not the knob position; the knob is read
back by inverting the curve. So hand-editing a parameter under a profile is
allowed and will simply move the knob.

---

## Measuring scripts, not presets

Two things measure the audio before they act, so they cannot be a fixed chain:

- **Voiceover carve** — analyses the voice and cuts the bed in the bands the
  voice occupies. The answer to "the music is fighting the voice". See the
  carve section in `SKILL.md`.
- **Even Out Levels** (`levellingResult`) — measures the track's own speaking
  windows and writes a gain envelope. Its target is the 80th percentile of that
  track, not an absolute level, so an already-even track is left alone. Use it
  over a compressor when the problem is passages drifting over a whole take
  rather than word-to-word dynamics.

---

## Not covered by anything shipped

Name the gap rather than reaching for the nearest preset and calling it the
thing — but then **ship the honest fallback anyway**, with its cost stated. An
author who asked for a fix and got only an explanation has been told something
true and handed nothing. Say what it is, say what it costs, apply it.

- **De-essing.** `harsh-tame` is a broad always-on cut centred a band too low,
  not a de-esser. A real one needs a detector faster than the analysis hop
  available here. _Fallback:_ a narrow `peaking` cut in the Edge band — sweep
  5–9 kHz to find where this voice actually spits, Q 3–4, −3 to −5 dB. It is
  always on, so it costs a little air on every word; that trade is usually worth
  it and is the author's to reject.
- **Tone matching** one track to another. _Fallback:_ the Tone EQ by hand, which
  is predictable in a way a match curve derived from two takes would not be.
- **Noise removal.** `room-gate` closes the gaps; the noise under speech is
  untouched. There is no fallback for hiss beneath the words — a source with
  audible hiss needs a better source, and saying so is the whole answer.
