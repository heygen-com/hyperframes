# Audio treatment presets — research and proposed catalog

Written 2026-08-09. The ask: voice carve turned a pile of effects into one
understandable feature; what else can, using only the effects already shipped?

This is a research + design doc. Nothing here is built.

---

## 1. The governing precedent

**`wiki/decisions/vst-studio-integration-cancelled.md`** is the most important
prior art, and it is a warning. A VST spectral-carve integration was built to
completion — 4-PR stack, published PyPI host — and then **cancelled**, because
of its standing costs:

- a spawned WebSocket sidecar with its own lifecycle
- an external GPL repo with its own release cadence
- a non-bundled runtime dependency users had to install
- VST logic permanently in the render path, hard-failing renders on a missing
  plugin

Everything proposed here is the **inverse of all four**: preset values are
data, and the adaptive scripts reuse analysis code that already ships. No new
process, no new dependency, no new render-path failure mode. A preset that goes
wrong produces a chain the author can see and edit in the rack — the same chain
they could have built by hand.

That is the argument for doing this at all, and the bar any proposal here has
to keep clearing.

### What already exists, so this does not duplicate it

- **`skills/hyperframes-audio`** teaches the effect _families_ and when to
  reach for each ("Reach for a family by the problem, not the name"), and
  documents carve. It contains **no recipes and no named looks** — it explains
  the why, and stops short of the one-click. This catalog is the complement,
  not a rewrite. It also already fixes the canonical order this doc adopts:
  _"corrective filtering goes early, character in the middle, and a limiter
  last."_
- **`carveBandsToChain()`** already proves the mechanism: an analysis produces
  an ordinary `HfAudioFxChain`, which the rack then owns like any other.
- **Demand is real and internal.** Cortex carries user asks for
  [audio reprocessing for studio acoustics](https://heygen.slack.com/archives/C0A9ZHLSQFN/p1781063751377189),
  [voice loudness and gain boosting](https://heygen.slack.com/archives/C07BR8QRE4T/p1769062551169729),
  and auto-enhance across scenes. Nobody has built a preset catalog for it.

---

## 2. What consumer tools actually ship

Three distinct tiers, and only two are reachable for us.

### Tier 1 — ML enhancement (NOT reachable)

Adobe Podcast Enhance Speech and Descript Studio Sound are **one button** that
strips background noise, echo and room reverb, and rebuild the voice as if
recorded in a studio. Adobe's v3 does source separation and exposes a strength
slider. This is generative ML, not filtering — there is no arrangement of EQ,
compression or gating that reaches it. Denoising and de-reverberation are the
single most-requested thing in our own internal feedback, and we cannot do
them with this effect set. Any catalog that quietly implies otherwise is lying.

### Tier 2 — intent panels over conventional DSP (the model to copy)

Premiere Pro's **Essential Sound** panel is the closest analogue to what is
being asked for, and it is the design worth stealing. The author tags a clip by
_what it is_ — Dialogue, Music, SFX, Ambience — and then gets a small set of
outcome-named controls rather than effects:

- **Loudness**, with an Auto-Match that normalises to a broadcast target
- **Repair** — Reduce Noise, Reduce Rumble, DeHum, DeEss, Reduce Reverb, each a
  single intensity slider
- **Clarity**, which boosts the bands that make consonants distinct
- **Creative**, for reverb/space

Note the shape: **one noun per problem, one slider per noun, no frequencies on
screen.** That is exactly what carve does with its strength knob, and it is the
contract this catalog should hold to.

### Tier 3 — character effects (fully reachable, and where consumer volume is)

CapCut ships ~100 voice filters and ~100 "voice characters". The named ones
that recur across tools: Telephone, Megaphone, Radio/Radio Fuzz, Loudspeaker /
PA Speaker, Intercom, Lo-Fi, Cassette Tape, Cave, Echo, Broadcast, Retro.

These are ordinary filter + saturation + bitcrush recipes and we can do all of
them. **The character half of CapCut's list we cannot do**: Chipmunk, Deep
Voice, Robot, Alien, Monster, Elf — every one of those is pitch, formant or
ring modulation, and the registry has no pitch shifter, no time-stretch and no
ring mod. Out of scope unless a new effect is added.

---

## 3. What our 15 effects reach

| Family    | Effects                                               | Reaches                                                    |
| --------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| Filter    | `highpass` `lowpass` `peaking` `lowshelf` `highshelf` | tone shaping, band isolation, rumble/mud removal, presence |
| Dynamics  | `gain` `compressor` `limiter` `gate`                  | levelling, consistency, ceilings, room-tone gating         |
| Nonlinear | `saturate` `bitcrush`                                 | warmth, grit, distortion, digital degradation              |
| Time      | `delay` `reverb` `chorus` `phaser`                    | space, slap, width, wow/flutter, movement                  |

Plus two force multipliers the catalog depends on:

- **Automation lanes** on `gain` and on most effect parameters — so a preset can
  be a _moving_ treatment, not just a static one.
- **Offline analysis** (`powerSpectrum`, `windowDb`, `analyseCarveDynamics`,
  `analyseCarveDuck`) already runs in the panel over decoded audio. This is what
  makes the adaptive tier possible without new machinery.

**Hard limits, stated once:** no noise reduction, no de-reverberation, no pitch
or formant shift, no time-stretch, no spectral repair, no stereo widening
beyond `chorus`, no true multiband compression (though stacked peaking + a
`mix`-blended compressor approximates it).

---

## 4. Two mechanisms, and carve is already the second

The user's instinct to say "presets/**scripts**" is the right split.

### Static presets — a chain literal

Mirrors `HF_COLOR_GRADING_PRESETS` exactly: named, fixed parameter values,
one click, fully editable afterwards. Suits anything whose right answer does
not depend on the audio — every character effect, every space, and the
corrective voice chains at a sensible default.

### Adaptive scripts — measure, then generate

The carve pattern: read the decoded samples, measure something, emit a chain
and/or automation lanes. **The machinery for this is already built and shipped**
— what carve does with a voice against a bed generalises:

| Script                              | Reuses                                             | Emits                         |
| ----------------------------------- | -------------------------------------------------- | ----------------------------- |
| Voice carve _(shipped)_             | `analyseCarveBands`                                | peaking cuts + per-band lanes |
| Auto-duck _(shipped, inside carve)_ | `analyseCarveDuck`                                 | one volume lane               |
| De-esser                            | `analyseCarveDynamics`, re-parameterised (see §5e) | lane on a peaking cut         |
| Leveller                            | `windowDb` walk                                    | lane on a `gain` node         |
| Tone match                          | `powerSpectrum` vs a target curve                  | 3–5 peaking nodes             |

This is the strongest argument in the doc: **none of them needs new DSP** —
only a different question asked of code that already runs. One (de-ess) needs
that code re-parameterised for a shorter timescale; the rest reuse it as-is.

---

## 5. Proposed catalog

Every value below is inside the registry's declared range. Node order is the
canonical one the skill already states: **gate → subtractive EQ → compressor →
presence EQ → saturation → limiter last.**

### 5a. Voice (static)

**`voice-clean` — "Clean Voice"** · the safe default, roughly Premiere's
Dialogue preset

```
highpass   frequency 80    q 0.707  poles 2
peaking    frequency 250   gain -3   q 1.2      (mud)
compressor threshold -20  ratio 3  attack 12  release 180  makeup 3
peaking    frequency 3000  gain +2.5 q 1.0      (presence / consonants)
limiter    limit -1  attack 5  release 50
```

**`voice-broadcast` — "Broadcast"** · denser, more forward

```
highpass   frequency 90    q 0.707  poles 2
peaking    frequency 400   gain -3   q 1.4
compressor threshold -24  ratio 4  attack 8  release 150  makeup 5
peaking    frequency 2500  gain +3   q 0.9
highshelf  frequency 8000  gain +2                        (air)
saturate   type tanh  threshold -12  output 0             (glue)
limiter    limit -1  attack 5  release 60
```

**`voice-warm` — "Close & Warm"** · intimate, less processed

```
highpass   frequency 70    q 0.707  poles 2
lowshelf   frequency 180   gain +2
compressor threshold -18  ratio 2.5  attack 20  release 250  makeup 2
peaking    frequency 3000  gain +1.5 q 0.8
limiter    limit -1.5
```

Frequency choices are the documented conventions: high-pass at 60–80 Hz for
voice, 150–300 Hz is where proximity-effect mud lives, and presence for
consonant intelligibility sits around 2–4 kHz.

### 5b. Repair — honestly named (static)

These are the _reachable half_ of Premiere's Repair section. The names must not
promise noise removal.

**`rumble-cut` — "Cut Rumble"** — `highpass` 100 Hz, poles 2. Two stacked nodes
for 24 dB/oct when a source is badly affected.

**`room-gate` — "Quiet Between Phrases"** — `gate` threshold −45, range −18,
ratio 10, attack 2, release 180. **This gates, it does not denoise**: room tone
still sits under speech, it is only silenced in the gaps. Label it that way in
the UI or it will be mistaken for Tier 1.

**`boom-tame` — "Tame Boominess"** — `peaking` 200 Hz, −4 dB, Q 1.4.

**`harsh-tame` — "Soften Harshness"** — `peaking` 3.2 kHz, −3 dB, Q 1.6. Static
and broad on purpose; sibilance proper is a script (§5e), not a fixed cut.

### 5c. Character (static)

**`telephone` — "Telephone"** · the researched 300–3400 Hz band, steepened

```
highpass   frequency 300   q 0.707  poles 2   ×2 stacked  (24 dB/oct)
lowpass    frequency 3400  q 0.707  poles 2   ×2 stacked
peaking    frequency 1200  gain +6  q 1.2                 (the "honk")
peaking    frequency 550   gain -4  q 1.0                 (de-mud)
saturate   type tanh  threshold -18  output -2            (circuit colour)
```

The registry maxes at 12 dB/oct per node (`poles: "2"`), so the classic
24 dB/oct skirts need **two stacked nodes each**. Worth encoding once here
rather than having every author rediscover it.

**`radio-am` — "AM Radio"** — band 400–3000 Hz, `saturate` tanh threshold −15
output −2, `bitcrush` bits 10 samples 1 mix 0.25.

**`megaphone` — "Megaphone"** — highpass 500, lowpass 4000, `peaking` 1800 +8
Q 1.5, `saturate` **hard** threshold −12 output −3, `delay` time 40 ms feedback
0.15 mix 0.15 (the horn's slap).

**`lofi-tape` — "Tape"** — `lowpass` 6500, `lowshelf` 120 +2, `bitcrush` bits 12
samples 2 mix 0.35, `saturate` tanh threshold −14, and **`chorus` delay 6,
depth 0.6, speed 0.4, mix 0.15** — a slow shallow chorus is exactly how you
fake wow and flutter, which is a genuinely nice use of an effect we have.

**`pa-system` — "Tannoy / PA"** — band 350–3500, `peaking` 1500 +5 Q 1.2,
`saturate` tanh threshold −16, `reverb` size 0.5 damping 0.7 wet 0.25 dry 0.8.

**`intercom` — "Intercom"** — band 500–3000, `peaking` 2000 +6 Q 2,
`bitcrush` bits 11 mix 0.3, `gate` threshold −40 range −30 (the squelch).

### 5d. Space (static)

**`room-tight`** — `reverb` size 0.25, damping 0.6, wet 0.18, dry 0.9
**`room-natural`** — size 0.5, damping 0.5, wet 0.25, dry 0.85
**`hall`** — size 0.9, damping 0.3, wet 0.4, dry 0.75
**`slap-echo`** — `delay` time 110 ms, feedback 0.12, mix 0.22
**`dub-throw`** — `delay` time 375 ms, feedback 0.55, mix 0.3

### 5e. Adaptive scripts

**`de-ess` — "Soften Sibilance"** — _must be a script, not a preset._ A fixed
−6 dB at 7 kHz dulls the whole voice; a de-esser only acts when sibilance is
present. Run the carve pattern against the track's own 5–8 kHz band and emit a
`peaking` node at the measured centre with a **lane on its gain** that dips only
during sibilant windows. Sibilance centres around 5–6 kHz for lower voices,
7–8 kHz for higher — measure it rather than assuming.

`analyseCarveDynamics` cannot be reused _unchanged_ here, and this is the one
place in §5e that needs work rather than a new caller. Its hop is
`max(FRAME, length / POINT_BUDGET)` — 85 ms at best and ~150 ms on a
real-length track — while sibilants are 50–150 ms events, so at that resolution
the envelope cannot land on them. Its `ATTACK_S`/`RELEASE_S` ballistics are
tuned for musical ducking and are far too slow as well. Same machinery, same
FFT, but it needs a sibilance-scale hop and much faster attack/release.

**`level-out` — "Even Out Levels"** — walk `windowDb`, emit a lane that lifts
quiet passages and holds loud ones, against a target range rather than a fixed
gain.

**The lane must ride a `gain` node, not the volume lane.** `VOLUME_RANGE` is
0..1 and `normaliseEnvelope` clamps every keyframe into it, so a volume lane can
only ever attenuate — it cannot lift anything. A `gain` node spans −60..+12 dB
and is automatable, which is exactly what the audio skill means when it calls
`gain` "what an automation lane rides when a track has to move". So this script
emits both a chain (one `gain` node) and the lane addressing it. **Do not call this LUFS.** `windowDb` is plain RMS; platform
targets (−14 LUFS for Spotify/YouTube/TikTok/Instagram, −16 for Apple
Music/podcasts) are ITU-R BS.1770 K-weighted and gated. Either implement the
K-weighting prefilter — two biquads, entirely feasible offline with the filters
we have — or name the feature "even out" and cite the targets as context only.

**`tone-match` — "Match Tone"** — `powerSpectrum` of the track against a target
curve (a built-in "broadcast voice" curve, or another clip in the project),
emitting 3–5 corrective `peaking` nodes. This is iZotope's Tonal Balance idea
at a tenth of the complexity, and `powerSpectrum` already returns exactly the
data it needs.

---

## 5f. Module identity in the rack

The rack is a 292&nbsp;px column of stacked modules — which is, near enough, a
Eurorack case. Worth leaning into: a faceplate recognised by colour and
lettering before the label is read. Carve already gets a distinct treatment
(`hf-fx-carve-module`); this generalises it.

**Direction chosen 2026-08-09: schematic** — picked from four mocked
alternatives (hardware silkscreen, vintage test equipment, risograph,
schematic). Recorded with its principles in `.impeccable.md` at the repo root.

The rack is drawn as the signal path it is: numbered nodes on a dashed spine
running from an `IN` terminal to an `OUT`, leader-dotted dimension lines,
three-letter stage tags, family colour restricted to the node ring and the tag.

**Why it won over the louder options:** it is the only one that _adds
information_. Chain order is load-bearing — a limiter first and a limiter last
are different sounds — and nothing in the panel communicated it. It is also the
quietest, which matters on a surface authors stare at while mixing.

**What the drawing carries that the current rack cannot say:**

| Drawn as                                                                                                     | Instead of                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `IN` names the source, `OUT` names the destination and the FX tail                                           | nothing — the tail was invisible                  |
| Numbered nodes 01…06                                                                                         | implicit top-to-bottom order                      |
| Bypassed node: ring drawn open, wire beside it solid and unbroken                                            | a row at 50% opacity                              |
| Preset nodes gathered under a right-hand brace with its name                                                 | no grouping at all                                |
| An automated parameter's value reads **live at the playhead** and ticks while the transport runs, marked `~` | the stale seed the lane already replaced          |
| A measuring module gets a second ring                                                                        | nothing distinguishes carve from a hand-set chain |

That last pair is the static-versus-script distinction from §4, delivered as
drawing rather than documentation.

**Automated parameters show numbers, not shapes.** An earlier pass drew each
lane's envelope inside the module; that was dropped. The lane already has a home
in the timeline, and a second small drawing of it in the rack is decoration —
what the rack is missing is the _current_ value. The panel already receives it:
`FxSectionProps.liveAutomationValues` exists precisely because "an automated
parameter's stored number is only the seed the lane replaced, so a rack that
shows it stands still while the carve is audibly working". So the row is an
ordinary parameter row whose number is live, `~` on the label saying it is
driven rather than set, and the marker moving with it. Stopped, the values go
grey and hold at the playhead.

**The preset menu preview is the chain** — each row previews the nodes it will
draw as small connected rings in their family colours, so the shape you pick is
the shape you get. Smart entries read `MEASURES` instead.

**The empty state keeps the wire.** `IN` and `OUT` remain, connected, with "no
effects, signal passes straight through" between them — which teaches that the
rack is a path before the author has added anything to it.

**Not carried over from the first pass:** the 3 px coloured rail down each
module's left edge. It is the most overused device in dashboard UI, and
forcing each direction to find another answer is what separated them.

**Family hues**, chosen to sit on `#0C0C0E` without competing with the studio's
`#3CE6AC` accent:

| Family    | Hue       | Why                                                                  |
| --------- | --------- | -------------------------------------------------------------------- |
| Filter    | `#4FA8FF` | the measuring family                                                 |
| Dynamics  | `#FFB443` | grips the signal                                                     |
| Nonlinear | `#FF6B5C` | the only generative family                                           |
| Time      | `#B98CFF` | atmosphere, not control                                              |
| Smart     | `#3CE6AC` | the studio's own accent — reserved for modules that act on their own |

**This needs almost no new plumbing.** `group` is already on every effect in the
registry, so hue and lettering are derived, not hand-assigned. And every module
already renders `data-fx-node="<type>"`, so the whole identity layer is CSS on
an attribute that exists today. Only "Smart" is new, and carve already lives
there in spirit.

**Type budget is the real decision.** Fonts must be self-hosted (no CDN).
Recommended: **two faces** — the UI sans plus one characterful display face
split across families. One face is too subtle at 11 px; five is a bundle cost
and starts reading as a collage on a surface authors stare at while mixing.

**Preset menu**: grouped by the same families, so the colour picked in the menu
is the colour that appears in the rack. Each row carries the number of modules
it drops in — which quietly teaches that a preset _is_ a chain. Smart entries
say "measures" instead of a count, which is the entire static-vs-adaptive
distinction delivered in one word.

Open decisions: whether applying a preset appends or replaces (suggest append,
replace on modifier, re-apply swapping its own `fromPreset` nodes); the type
budget above; and whether character presets get drawn glyphs on their plates —
the biggest step toward "fun", and the only part needing artwork rather than
CSS.

Mockup at the real panel width: published as an artifact, 2026-08-09.

## 6. Architecture

Mirror colour grading, because the author already understands that surface.

```ts
export interface HfAudioFxPreset {
  id: string; // "telephone"
  label: string; // "Telephone"
  family: "voice" | "repair" | "character" | "space";
  description: string; // one line, in the author's language
  chain: HfAudioFxChain; // an ordinary chain — nothing special
  automation?: HfAutomation; // for presets that move
}
```

Four notes:

1. **A preset is just a chain.** Applying one writes `data-fx-chain` exactly as
   hand-building would. It is inspectable, editable and undoable, and it cannot
   introduce a failure mode the rack does not already have.
2. **Tag the nodes.** `HfAudioFxNode` already carries `fromCarve`; an analogous
   `fromPreset: "telephone"` lets the panel show "Telephone (edited)" and lets a
   re-apply replace its own nodes without touching hand-added ones.
3. **Fixed values in v1, no intensity knob.** Colour grading's presets are
   fixed; carve earned its strength knob by being adaptive. Most effects carry a
   `mix` parameter, which is the natural hook if intensity is wanted later —
   note it, don't build it.
4. **Scripts need a separate registry** with an `analyse(samples, sampleRate) →
{ chain, automation }` contract, because they cannot be static data. Carve is
   the reference implementation.

### Two things that will otherwise be filed as bugs

- **Boost presets must end in a limiter.** `voice-broadcast` adds presence and
  +5 dB makeup; without its limiter it will overshoot full scale. The
  clip-before-duck fix (`55f852a72`) makes that survivable, but the measured
  damage still scales with overshoot — 2.7× peak destroys 19% of samples. A
  preset that ships hot is a bad preset regardless of what the render does
  about it.
- **Worklet-backed presets play dry for a moment in preview.** Anything
  containing `compressor`, `limiter`, `gate` or `bitcrush` waits for
  `ensureAudioFxWorklets` before it can be built — so nearly every voice preset
  is momentarily dry on first apply, then swaps in. Expected, not a defect.

---

## 7. What to build first

1. **Character presets** (§5c) — highest ratio of delight to risk. Pure
   filter/saturation data, instantly recognisable, nothing to measure, and the
   category consumer tools get the most use out of.
2. **Voice presets** (§5a/b) — the practical value, and the answer to the
   internal asks already in cortex.
3. **`level-out`** — the most-wanted adaptive one, and the smallest script.
4. **`de-ess`**, then **`tone-match`** — both reuse carve's analysis directly.

Deliberately not proposed: anything requiring a new effect. If pitch shifting
ever lands, the whole character half of CapCut's list opens up at once — but
that is a new DSP conversation, and this doc is explicitly the one that does not
need one.

### If this ships

`CLAUDE.md`'s skill-catalog rules apply: a preset catalog changes what
`/hyperframes-audio` covers, so the skill's `description:` and the surfaces
listed under "Skill catalog maintenance" have to move in lockstep.

---

## Sources

Internal: `wiki/decisions/vst-studio-integration-cancelled.md`;
`skills/hyperframes-audio/SKILL.md`; `packages/core/src/audioFx.ts` (ranges);
`packages/core/src/audioCarve.ts` (the script pattern);
`packages/core/src/colorGrading.ts` (the preset pattern). Cortex:
[studio acoustics reprocessing](https://heygen.slack.com/archives/C0A9ZHLSQFN/p1781063751377189),
[voice loudness and gain boosting](https://heygen.slack.com/archives/C07BR8QRE4T/p1769062551169729).

External:

- [Adobe Podcast Enhance Speech guide](https://thepodcastconsultant.com/blog/adobe-podcast-enhance) and [Adobe vs Descript shootout](https://thepodcasthaven.com/adobe-speech-enhancement-vs-descript-studio-sound-a-shootout/) — Tier 1 boundary
- [Premiere Pro Essential Sound panel guide](https://josephnilo.com/blog/the-ultimate-guide-to-the-premiere-pro-essential-sound-panel/) and [Envato's dialogue walkthrough](https://photography.tutsplus.com/articles/how-to-use-the-essential-sound-panel-to-edit-dialogue-in-premiere-pro--cms-41936) — the intent-panel model
- [Rode's podcast processing guide](https://rode.com/en-us/about/news-info/a-guide-to-audio-processing-and-fx-for-podcasting), [Podigy on podcast EQ](https://www.podigy.co/podcasters-eq) and [iZotope on de-essing](https://www.izotope.com/en/learn/the-dos-and-donts-of-de-essing.html) — voice chain values and sibilance ranges
- [CapCut voice filters](https://www.capcut.com/tools/voice-filters) and [its full effect list](<https://irda27987s-random-pages.fandom.com/wiki/All_Voice_Filters_and_Voice_Characters_in_App!_(Capcut)>) — Tier 3 vocabulary
- [Telephone effect settings](https://voxbooster.com/blog/telephone-voice-effect-online/) and [Audiotent's walkthrough](https://www.audiotent.com/blogs/production-tips/create-telephone-vocal-effect) — the 300–3400 Hz band and its refinements
- [LUFS targets per platform 2026](https://www.forasoft.com/learn/audio-for-video/articles-audio/lufs-targets-per-platform-2026) and [podcast loudness standards](https://sone.app/blog/podcast-loudness-standards-2026-spotify-apple-youtube) — why `level-out` must not claim LUFS
