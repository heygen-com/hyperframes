# The three audio attributes

All three go on the `<audio>` / `<video>` element itself, JSON-encoded, so a
composition carries its whole mix in the HTML with nothing to load beside it.
Nothing static validates them: preview plays an unreadable chain dry to stay
workable, and the render refuses the whole mix rather than shipping a dry track
that sounds plausible and is wrong.

## `data-fx-chain` — the effects

```json
{
  "version": 1,
  "nodes": [
    { "type": "highpass", "id": "n1", "params": { "frequency": 120, "q": 0.707, "poles": "2" } },
    {
      "type": "peaking",
      "id": "n2",
      "fromCarve": true,
      "params": { "frequency": 1600, "gain": -6, "q": 1.4 }
    },
    {
      "type": "limiter",
      "id": "n3",
      "enabled": false,
      "params": { "limit": -1, "attack": 5, "release": 50, "level_out": 0 }
    }
  ]
}
```

- **Order is signal order.** Each node processes what the one before produced.
- `type` is an effect id from the registry. `params` are in the units a person
  thinks in — dB, ms, Hz — and out-of-range values are clamped on read, so a
  chain that parses is always safe to realise.
- `id` is a stable handle. Automation addresses nodes by id, never by position,
  so reordering the chain cannot re-point a lane at a different effect. A node
  with no id loads fine but cannot be automated. Writing a chain by hand, any
  unique string works; Studio hands out the first free `n1`, `n2`, … so matching
  that convention keeps a hand-written chain and an edited one looking alike.
- `enabled: false` is bypass — the node stays in the chain, out of the signal
  path. Absent means enabled.
- `fromCarve: true` marks a node the carve analysis generated. Re-running the
  carve replaces exactly these and leaves hand-built effects alone. **Do not set
  it by hand**: a node tagged this way will be deleted by the next carve.

## `data-automation` — the envelopes

```json
{
  "version": 1,
  "lanes": [
    {
      "target": "volume",
      "points": [
        { "t": 0, "v": 1 },
        { "t": 2.5, "v": 0.4 }
      ]
    },
    {
      "target": "fx.n2.gain",
      "points": [
        { "t": 0, "v": 0 },
        { "t": 1, "v": -6, "curve": 0.4 }
      ]
    }
  ]
}
```

- `target` is `volume` for the track's own level, or `fx.<nodeId>.<param>`.
- `t` is **seconds from the start of the clip**, not of the composition. A bed
  starting at `data-start="8"` has `t: 0` at composition time 8.
- `v` is in the parameter's own unit: dB for a gain, Hz for a frequency, 0..1 for
  volume.
- A lane holds its first value backwards to the start of its clip and its last
  value forward to the end. So a bed that begins before the voice needs an
  explicit "no cut" point at `t: 0`, or it starts out already ducked.
- `curve` (-1..1) bends the segment _leaving_ a point: positive holds low then
  rises late. `viaX`/`viaY` name an interior point the segment passes through
  (progress 0..1, value travelled 0..1) and supersede `curve` when both are
  present — that is what the timeline writes when a bend is dragged.
- 512 points per lane, maximum.
- A lane whose node is gone is pruned on read rather than erroring.

**A lane on a non-automatable parameter is silently inert.** Automation is
delivered as native `AudioParam` scheduling, so a knob that no `AudioParam` backs
cannot move: worklet processor options, a WaveShaper curve and a convolution
impulse are all set wholesale. `fx-registry.md` marks each parameter; the four
worklet effects (`compressor`, `limiter`, `gate`, `bitcrush`) have none at all.

## `data-fx-carve` — the carve's settings

```json
{ "enabled": true, "sources": ["narration", "interview-guest"], "strength": 0.35 }
```

- `sources` are the **element ids of every voice this bed makes room for**. They live
  on the bed being processed, not on the voices. Summed onto the bed's clock before
  the analysis, so one set of filters and envelopes covers all of them.
- `strength` 0..1 derives the whole mechanism (see `carveProfile`).
- There is no `dynamic`: a carve always follows the speech.
- `enabled` is whether the carve applies. It exists because a bed with exactly one
  candidate voice is carved by default: with "off" represented by an absent
  attribute, switching it off would read as never-configured and the default would
  put it back. `enabled: false` keeps the settings and stops the carve.

This attribute is not read at playback — the chain and lanes it produced are what
play. It exists so the settings can be read back and re-derived rather than
guessed from the filters, which is what makes changing strength on an existing
carve possible.

Older projects may carry the six mechanism numbers (`maxCutDb`, `bands`, `q`,
`intelligibilityBias`, `duckDb`, `headroomDb`) instead of `strength`. They still
load: the depth maps back onto a strength and everything else is re-derived. A
stored carve with no `enabled` reads as on, and a single `source` reads as a one-voice
`sources` list. A stored `dynamic` is ignored — every carve follows the speech now.
