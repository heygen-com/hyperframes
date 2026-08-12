# Audio automation lanes

Breakpoint envelopes on audio tracks, edited in the timeline the way Ableton
Live edits arrangement automation: expand a lane under the track, pick a
parameter, click to add points, drag to shape. Applies to track volume and to
FX-chain parameters.

Status: SPEC — not implemented. Builds on the `wa-*` Web Audio FX stack.

---

## 1. Why this shape

Two facts make this cheaper here than in most editors:

1. **Web Audio has native envelope playback.** `AudioParam` scheduling
   (`linearRampToValueAtTime`, `setValueCurveAtTime`) is sample-accurate and
   runs on the audio thread. No per-frame JS evaluates the envelope; the studio
   only _schedules_ it.
2. **Preview and render share one graph.** The render runs the same builders in
   an `OfflineAudioContext`, so an envelope scheduled the same way in both
   places is identical by construction. No parity harness needed.

And one fact makes the UI cheap: the FX registry already declares `min` /
`max` / `step` / `unit` / `scale` for every parameter. A lane's y-axis,
clamping, and log/linear mapping are read from the registry — the lane
component knows nothing about any specific effect (same principle as the
panel).

## 2. What exists today (grounding)

- **Static volume**: `data-volume` on the element; baseline gain.
- **GSAP volume tweens**: `tl.to("#bgm", { volume: 0 })` — probed at 60 Hz into
  `volumeKeyframes`, applied in preview via `interpolateVolumeGain`
  (`runtime/media.ts`) and baked into PCM at render via
  `applyVolumeEnvelopeToWav` (sample-accurate) with an ffmpeg-expression
  fallback (`MAX_VOLUME_SEGMENTS = 32`).
- **FX chains**: `data-fx-chain` serialised on the element; transport splices
  the graph between decoded source and gain (`attachElementFxChain`); render
  runs the same graph offline. Worklet params are set via `port.postMessage`,
  **not** AudioParams.
- **Transport scheduling**: sources are (re)scheduled on play, seek, and rate
  change (`scheduleWebAudioForActiveClips`), started with an `elapsed` offset
  into the buffer. Envelope scheduling piggybacks on exactly these moments.
- **Timeline lanes**: `TimelineLanes.tsx` renders track rows;
  `TimelinePropertyLanes.tsx` is the keyframe-lane precedent;
  `AudioWaveform.tsx` already draws the waveform the envelope will sit over.
- **Edit plumbing**: `onSetAttributeLive` (coalesced, no preview refresh) for
  drags; `onSetAttribute` persists on gesture end. Proven by the wa-8 fix.

## 3. UX spec (Ableton mapping)

| Ableton                                       | Here                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Automation triangle on track header           | Expand toggle on audio track rows in the timeline gutter                                               |
| One parameter per lane, selector at lane left | Same. Selector lists `Volume` + every automatable param of every chain node (`Compressor · Threshold`) |
| Breakpoint envelope over the clip             | SVG envelope drawn over the existing waveform, clip-local                                              |
| Double-click segment → add point              | Same                                                                                                   |
| Drag point (value tooltip)                    | Same; tooltip shows value + unit from the registry                                                     |
| Drag segment vertically → bend curvature      | Same (Phase 2; format supports it from v1)                                                             |
| Delete key / right-click → remove point       | Same                                                                                                   |
| Dimmed line when no automation                | Flat line at the current static value; first edit creates the lane                                     |

Lane height ~48 px expanded. Multiple lanes per track may be open at once
(one per parameter), matching Ableton's "+" lanes — Phase 2; V1 shows one lane
per track with the selector.

**Editing writes:** point drags go through `onSetAttributeLive`; release
persists via `onSetAttribute`. The running graph follows the attribute (wa-8
observer), so edits are audible without a reload. Undo = attribute history,
coalesced per gesture — free.

## 4. Data model

Serialised on the element, versioned, same pattern as `data-fx-chain`:

```html
<audio
  id="music"
  src="..."
  data-volume="0.55"
  data-fx-chain='{"version":1,"nodes":[{"id":"n1","type":"peaking",...}]}'
  data-automation='{
    "version": 1,
    "lanes": [
      { "target": "volume",
        "points": [ {"t":0,"v":0.55}, {"t":2.5,"v":0.2,"curve":-0.4}, {"t":6,"v":0.55} ] },
      { "target": "fx.n1.frequency",
        "points": [ {"t":0,"v":200}, {"t":4,"v":8000} ] }
    ]
  }'
></audio>
```

- **`t`** — seconds, **clip-local** (relative to the element's `data-start`).
  The attribute lives on the element, so automation travels with the clip when
  it moves. (Ableton note: arrangement automation stays put when clips move;
  clip envelopes travel. We are the clip-envelope model. Stated, not hidden.)
- **`v`** — value in the parameter's own unit as declared in the registry
  (dB for a compressor threshold, Hz for a cutoff). Volume is **linear 0..1**,
  consistent with `data-volume` and the existing linear-domain envelope
  machinery — no dB conversion enters the volume path.
- **`curve`** — optional, `-1..1`, curvature of the segment _leaving_ this
  point. `0`/absent = linear. Power-curve bend, Ableton-style.
- **`target`** — `"volume"` or `"fx.<nodeId>.<paramKey>"`.

**Chain node ids.** `HfAudioFxNode` gains an optional `id` (short random,
minted by the panel when a node is added). Automation addresses nodes by id,
so reordering the chain never re-targets a lane. Chains without ids stay
valid — they just can't be automation targets until the panel touches them.

**Normalization** (`normalizeAutomation`, mirrors `normalizeAudioFxParams`):

- points sorted by `t`; duplicate `t` keeps the later point
- `v` clamped to the target's registry range; non-finite → point dropped
- lanes targeting a node id that no longer exists in the chain are **dropped**
  (the author deleted the device; its automation dies with it — panel also
  removes them eagerly on node delete)
- 1-point lane = constant; empty lanes array = attribute removed

**Precedence for volume** (documented + linted):
`data-automation` volume lane → GSAP volume tween → `data-volume`.
New lint rule `audio_volume_double_automation` (warning) when an element has
both a volume lane and a GSAP tween on `volume`.

## 5. Interpolation semantics

- Between points: linear in the parameter's **working domain**. Params with
  registry `scale: "log"` (frequency, some times) interpolate in log domain —
  a 200 Hz → 8 kHz sweep is perceptually linear, matching what a DAW does.
- `curve` bends the segment: `f(x) = x^(2^(k·s))` shaping applied in the
  working domain (s = curve, k ≈ 2). Exact constant chosen to visually match
  Ableton's feel; pinned by unit tests once chosen.
- Before the first point: hold first value. After the last: hold last value.
- One shared implementation `sampleAutomationLane(lane, t)` in core — used by
  the lane renderer (drawing), the scheduler (curve sampling), and the render
  path. One interpolator, three consumers, or preview and picture drift.

## 6. Preview architecture

Scheduling hooks into `schedulePlayback` (transport), which already runs on
play / seek / rate change with the clip's `elapsed` offset:

- **Volume lane** → scheduled on the source's existing `gainNode.gain`
  (post-FX, i.e. fader semantics — matches Ableton, matches the render order
  where FX runs before the volume bake).
- **FX param lanes** → scheduled on AudioParams exposed by the graph builders
  (§8) of the chain instance spliced for this source.

Mechanics per lane, at schedule time:

1. Convert clip-local envelope → context-time segments starting at
   `scheduledAt`, offset by `elapsed`, scaled by playback rate.
2. Linear segments → `setValueAtTime` + `linearRampToValueAtTime` (log-domain
   params ramp via sampled curve, below).
3. Curved or log-domain segments → `setValueCurveAtTime` with the segment
   sampled at 100 pts/s (min 8 per segment).
4. On stop/dispose → `cancelScheduledValues` before the nodes disconnect.

**Live edit while playing:** the wa-8 attribute observer already re-parameterises
the running chain. Extend it: on an automation change, `cancelScheduledValues`
from `currentTime` and re-schedule the remainder. Point drags are audible
mid-playback without rescheduling the source.

## 7. Render architecture

- **Volume lane**: sampled into the `volumeKeyframes` shape (dense linear
  points for curved segments, ~20/segment) and fed to the existing
  `applyVolumeEnvelopeToWav` PCM bake. Zero new render machinery; existing
  order (FX → volume bake) already matches fader-post-FX semantics.
- **FX param lanes**: the injectable audio-fx runtime entry
  (`audio-fx-runtime-entry.ts`) grows an `automation` argument; it schedules
  lanes on the offline graph exactly as §6 does on the live one. The engine
  passes the element's `data-automation` through `applyAudioFxChain`.
- Parity is structural (same interpolator, same scheduler code path), but one
  fixture test renders a swept filter offline and asserts the sweep landed
  (spectral check at two timestamps) so a regression is loud.

## 8. Registry & graph-builder changes

- `HfAudioFxNumberParam` gains `automatable?: boolean`.
- `FxNodeHandle` gains `params?: Record<string, AudioParam>` — each builder
  exposes the AudioParams backing its automatable params.
- **Invariant test**: for every registry param with `automatable: true`, the
  built node exposes a matching AudioParam. The flag can never lie.

**Automatable in V1** (param maps to a real AudioParam):

| Effect                 | Params                          |
| ---------------------- | ------------------------------- |
| Peaking / shelves      | frequency, gain, Q              |
| High/low-pass (2-pole) | frequency, Q                    |
| Delay                  | time (delayTime), feedback, mix |
| Chorus                 | rate, depth, mix                |
| Phaser                 | rate, wet/dry gains             |
| Reverb                 | wet, dry                        |
| _Volume_               | (transport gainNode)            |

**Not automatable in V1**, greyed out in the selector, with reasons:

- **Worklet effects** (compressor, limiter, gate, bitcrush): params travel by
  `postMessage`, not AudioParams. V2 path: declare
  `parameterDescriptors` in the processors and read `parameters` in
  `process()` — mechanical but touches every processor; separate PR.
- **Saturation** type/threshold: a WaveShaper curve is not an AudioParam.
- **Reverb size/damping**: changing them regenerates the IR; not continuously
  automatable by construction. Output gain via post-node possible later.
- **1-pole filter frequency**: IIRFilterNode coefficients are immutable.

## 9. Studio UI components

- `TimelineAutomationLane.tsx` — SVG envelope over `AudioWaveform`, driven by
  registry metadata (range/scale/unit). Hit-testing, point drag with tooltip,
  double-click add, right-click/Delete remove.
- Track header expand toggle + param selector (grouped: Volume, then per
  chain node by label).
- `TimelineElement` (playerStore) gains a parsed `automation?` summary the
  same way it carries `volumeKeyframes`, populated at manifest translation.
- Orphan handling: deleting a chain node in the panel deletes its lanes in the
  same attribute write (atomic — both live in element attributes).

## 10. Edge cases

- Clip trimmed shorter than envelope: points beyond `data-duration` are kept
  in data, drawn dimmed, inert at playback (hold-last stops at clip end).
- Clip start moved: clip-local times mean the envelope moves with it. This is
  the chosen semantic, not an accident.
- `data-playback-rate` ≠ 1: envelope times are clip-timeline seconds; the
  scheduler divides by rate when mapping to context time (same as the buffer).
- Unreadable `data-automation`: preview plays without it (dry-not-silent
  philosophy); render **fails loudly** (same split as chains — plausible-but-
  wrong renders are the worst outcome).
- Element with automation but no chain: volume lane still valid.

## 11. PR breakdown (all < 1000 LOC)

| PR                            | Scope                                                                                                     | Est. LOC |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| A `wa-10-automation-model`    | core: types, parse/normalize/serialize, `sampleAutomationLane`, curvature math, chain node ids, lint rule | ~450     |
| B `wa-11-param-exposure`      | core: `automatable` flags, `FxNodeHandle.params`, invariant test                                          | ~350     |
| C `wa-12-preview-scheduling`  | core: transport + attach-path scheduling, cancel/re-schedule on live edit                                 | ~400     |
| D `wa-13-render-scheduling`   | core/engine: offline scheduling in runtime entry, volume→bake bridge, sweep fixture test                  | ~350     |
| E `wa-14-lane-ui`             | studio: lane component, expand toggle, selector, point editing, orphan cleanup                            | ~800     |
| F `wa-15-curvature` (Phase 2) | studio: segment-bend drag; worklet `parameterDescriptors` migration                                       | ~300+    |

A→B→C→D are dependency-ordered; E needs A+B (draws and writes) and benefits
from C (audible while editing). F is optional polish.

## 12. Open questions (need a call before building)

1. **Volume lane display unit** — data stays linear either way; show the axis
   as % (matches `data-volume`) or dB (matches DAW muscle memory)?
   _Default if unanswered: %._
2. **Curvature in V1?** Format supports it from day one regardless. Building
   the bend-drag in V1 adds ~2 days to E. _Default: defer to F, straight lines
   first._
3. **Worklet-param automation deferral acceptable?** Compressor threshold
   automation is the notable absence. _Default: defer; it's a self-contained
   follow-up._
4. **Clip-envelope semantics confirmed?** Automation travels with the clip.
   If you expected Ableton _arrangement_ behaviour (stays put), say so now —
   it changes the data model (composition-global times, stored off-element).
