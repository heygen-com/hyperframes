# The casual author's view of the FX rack

The schematic direction won because it *adds information* — signal order,
routing, what is driven versus set. But information a casual author cannot read
is decoration, and the rack speaks entirely in Hz, dB and ratios. So the drawing
stays and the **language changes**.

The plain-language layer over every effect in the registry now ships as
`packages/core/src/audioFxCopy.ts`, with the coverage that used to gate this
page — every effect, parameter and preset must have copy — as
`audioFxCopy.test.ts`. `build-preview.mts` renders the review page from it
**plus the real registry and preset catalogue**. Only `PROFILES` is still a
proposal, and it is all that is left in `copy.mts`.

```bash
bun plans/audio-fx-ux/build-preview.mts /tmp/rack-ux.html
```

## The three rules

1. **Two faces.** Every module opens plain: a name that says the outcome, one
   line about what it is for, and one control. The real parameters are one click
   away and never in the way. Nothing is hidden — it is ordered.
2. **One knob that matters.** A compressor has seven controls and an author
   wants one. Multi-knob modules get a single derived control, exactly as
   `carveProfile(strength)` already turns one number into six.
3. **Name the outcome, not the mechanism.** "Remove Rumble", not "High-pass".
   The DSP name stays in the corner of the module, so the vocabulary is taught
   rather than withheld — an author who learns "high-pass" here can carry it to
   any other tool.

## The shared vocabulary

Frequencies mean nothing to somebody who has not been taught them. `BANDS` names
the ranges in the words the same person would use unprompted — rumble, weight,
mud, middle, presence, edge, air — and every filter shows where it acts on that
one ruler. Naming them once makes the whole rack legible.

## What laying it all out exposed

**A preset can use the same module twice for different jobs.** "Clean Voice"
runs *Shape One Range* at node 02 (cutting mud at 250 Hz) and again at node 04
(adding clarity at 3 kHz). Read down the rack, an author sees the same words
twice and cannot tell them apart.

So one plain name per *effect* is not enough: a preset's node needs its own
**role label** — "Reduce Mud", "Add Clarity" — which means copy belongs on the
preset node as well as on the effect. This is invisible in a catalogue of cards
and obvious the moment every preset is drawn as the chain it actually builds.

## Family lettering, carried over from the first round

The identity device from the first rack pass — different type per family — was
lost when the direction moved to schematic, which lettered everything in the
same condensed caps. It is back, inside the schematic skeleton rather than
instead of it. You can tell what KIND of module you are looking at with the
label out of focus, before the word registers.

| Family | Treatment | Why |
| --- | --- | --- |
| Filter | condensed caps, wide tracking, light | measuring instruments |
| Dynamics | condensed caps, tight, heavy | grips the signal |
| Nonlinear | **italic serif** | the only generative family — it should not look like the others |
| Time | condensed caps, very wide, thin | atmosphere, not control |
| Smart | monospace, medium | it measures; it reads as a readout |

Two faces, as budgeted. The condensed sans carries four families apart by
weight, case, tracking and size; the serif is spent on the single family that
behaves differently from the rest.

Alongside it, a **tint step per module inside its family** — derived from
position in the registry, so adding an effect never re-colours its siblings by
hand. Two filters are visibly different modules without reading as two
different families.

The `Broadcast` preset is the test case: seven nodes across three families in
one rack, and each one is identifiable before it is read.

## The collapsed state is a sentence

Collapsed is the most-seen state by a distance: a rack of six modules is six
collapsed lines and nothing else. So `SUMMARY` writes each one as a phrase about
what is happening to the sound — "Cutting everything below 80 Hz", "Evening out
— moderate", "A medium room, lightly" — rather than the parameter that happens
to be first. Numbers stay in, because they are what makes it checkable, but they
arrive inside a sentence. An author should be able to read their own mix top to
bottom.

Rendering all fifteen at their defaults immediately caught one: a freshly added
Peaking EQ sits at 0 dB, and "Lifting 1 kHz by 0 dB" describes a non-event as
though it were a setting — while being the FIRST thing an author reads after
adding one. It now says "Sitting on 1 kHz, doing nothing yet".

## Trap: do not use String.raw here

Bun escapes every non-ASCII character in a raw template literal into literal
`\uXXXX` text, so em-dashes, curly quotes and any glyph in a CSS `content`
property print as their escape sequence on the page. This cost three rounds of
chasing what looked like three unrelated rendering bugs. The template is a plain
literal; keep it that way, and use HTML entities for typographic characters.

## The hole in the single-knob rule: picking the range

`Shape One Range` has three controls — where, how much, how wide — and the
copy nominated *how much* as the one that matters. That is incoherent, and it
took someone asking to see it: boosting an unspecified frequency means nothing.
**The range is the first decision, not the second.**

Two ways out:

**A — two controls.** Keep the module generic and make *where* a word from the
shared vocabulary rather than a frequency field. Honest, and the ruler does the
teaching, but it is still two decisions and the first is jargon in a friendly
coat.

**B — the range IS the module.** The add menu offers *jobs* — Reduce Mud, Add
Clarity, Tame Harshness — each a peaking node with its frequency already
chosen. Picking the module is picking the range, so one knob is honest rather
than a simplification hiding the real choice.

**B is the answer**, and it is the same insight as the EQ: an author does not
want a parametric equaliser, they want to fix a thing. It also dissolves the
duplicate-name problem at the root rather than papering it with a role label —
`Clean Voice` reads *Remove Rumble · Reduce Mud · Even Out Loudness · Add
Clarity · Peak Ceiling*, and nothing repeats.

Option A is not wasted: its band picker is exactly the right control for moving
the frequency under **Details**, for the author who wants to.

This changes the catalogue, not just the copy: the presets should reference
named jobs, and `EFFECT_COPY.peaking` stops being one entry.

## Shipped: a multi-band EQ ("Tone")

*Built in `e984a9e62` / `2eaa71cac`. The design below is what was built.*

The clearest failure this exercise surfaced is a rack holding two *Shape One
Range* modules doing different jobs. A multi-band EQ is the answer, and it is a
better one than a role label because an author already understands it: bass,
middle, treble is the most widely used audio control there is.

**Its bands can be the shared vocabulary.** Three bands are Bass / Middle /
Treble; five open up to Bass / Warmth / Middle / Clarity / Air. So using the EQ
teaches the words the rest of the rack relies on, instead of the vocabulary
living only on a ruler somebody has to read.

**Built like the carve, not like a new effect.** Carve already owns several
tagged nodes and presents as one module (`fromCarve`, filtered out of the
hand-built list). An EQ does the same with `fromEq`: three bands are a low
shelf, a peaking and a high shelf — all effects that already ship. Nothing new
in the render, nothing new in the graph, and the nodes stay ordinary, so an
author who opens the details finds exactly the filters they could have added by
hand.

The registry's parameter model is flat key/value, so an `eq` effect *type* with
N bands would need array-shaped params it does not support. The composite-module
route avoids that entirely and is the pattern this codebase already proved.

Faders rather than sliders, because a row of vertical faders around a centre
detent is what an equaliser looks like to everyone who has met one. Collapsed,
it reads like every other module: "Bass +3, Middle −2, Treble +2", or "Flat"
when nothing has been touched.

## Decided (2026-08-10)

All three were open until now, and the first was blocking the wiring.

**The plain name replaces the DSP name; the DSP name lives under Details.**
The rack reads plain top to bottom — `Remove Rumble`, not `highpass` — and the
header stays narrow, which matters because it already carries a summary, a
bypass, two arrows and a delete. Nothing is lost: opening a module shows the
DSP name beside its real parameters, so the author who wants the mapping finds
it exactly where the mechanism is, and the author who does not never meets it.

**Presets sort by complaint; the effect list stays in signal order.**
The two menus stop competing to be the same thing. Presets are the casual
author's door and `PRESET_PROBLEM` already carries the line for all 18 of them,
so this costs no new writing. The effect list stays Filters / Dynamics /
Non-linear / Time — it is the expert's tool, and that grouping teaches the
signal path the rack itself is ordered by.

**Everything auditions on hover, with a spinner for the ones that measure.**
Static presets apply to the playing audio and revert on leave, which the graph
rebuild path already supports. A carve or an Even Out Levels analyses first and
says so while it does — the same spinner the carve module already shows. This
is the expensive answer of the three: analysis is seconds, and a hover that
takes seconds is one the author has often already left, so whatever gets built
needs a cancel on leave and must not apply a result that arrives late.

## Status

The EQ, the named jobs and the levelling script are **built**, and the copy
layer has now landed as `packages/core/src/audioFxCopy.ts` — `EFFECT_COPY`,
`BANDS`, `PRESET_PROBLEM` and `SUMMARY`, with the completeness check as a test
beside it rather than a build step.

**It is wired.** `propertyPanelFxNodeRow.tsx` takes the name from `EFFECT_COPY`,
the sentence under it from `SUMMARY`, and every knob's name from the same place
via `plainDef` — which writes the words over the registry's def and leaves range,
step, unit and automatability alone. The DSP name sits above the knobs as
`Details — High-pass`. The preset shelf leads with `PRESET_PROBLEM` and follows
with the preset's own name. Hover and focus both audition, through the same
preview channel a slider drag uses; the leveller measures first, says
"measuring…" while it does, caches the decode per `src`, and drops a result that
arrives after the pointer has gone.

Three things that took a second pass, all worth knowing before touching this
again. An audition has to survive the panel re-rendering under it — the group
re-renders every playhead tick, so anything keyed on its inline callbacks tears
down thirty times a second. Applying must NOT revert, since the audition *was*
the thing applied. And moving between two entries in a shelf is not leaving it,
so each entry has to call its neighbours' auditions off itself.

**The three rules are built too**, and so is the visual direction:

- *Two faces.* A module opens on its name, what it is for, and the one control
  that carries it — `EFFECT_COPY.primary`, with `primaryEnds` saying what its
  two ends sound like. Everything else is behind a Details disclosure, which is
  also where the DSP name lives. Ten of fifteen effects; the five whose primary
  is "strength" open on all their controls until `PROFILES` ships, which is
  honest — inventing one knob for them now would be a knob that lies.
- *One knob that matters.* Half of it. The derived control is `PROFILES` and has
  not shipped; what HAS is the case that made the rule incoherent — see below.
- *Name the outcome.* Modules, knobs, the add menu and the preset shelf.

- **The range IS the module.** The add menu offers five named jobs — Tame
  Boominess, Reduce Mud, Reduce Boxiness, Add Clarity, Soften Harshness — and
  `peaking` is not offered as itself. `packages/core/src/audioFxJobs.ts`. Every
  one is a job the preset catalogue already ships, at the settings it ships it
  with, so the list names the vocabulary the presets were written in rather than
  inventing a second one.
- **The shared ruler.** Every spectral module shows where it acts across the
  seven named ranges, log-spaced, with the range it is in named underneath.
- **Family lettering and the tint step.** Four families told apart by the sans,
  the serif spent on non-linear, monospace for the measuring modules, and a
  lightness step per module derived from registry position.
- **The schematic**, translated to one column: IN and OUT terminals, every step
  numbered over what the rack shows, and a preset's consecutive nodes bracketed
  as the one thing that was added.

What is still not wired: `PROFILES`, below.

It has no entry for Tone or for the levelling module, because both carry their
own copy in core (`audioEqSummary`, `levellingSummary`). That is the right home
for it: a summary that has to read the chain belongs beside the code that
writes it.

The `PROFILES` figures — what one knob derives at gentle/middle/strong — are
**still proposed values, not measured ones**, which is why they stayed behind in
`copy.mts` rather than going to core with the rest. They want the same
before/after listen the clip-before-duck fix got before a knob is wired to
them.
