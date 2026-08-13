# Effect registry

Every effect, its parameters and the usable range of each. Values outside a range
are clamped on read, so anything that parses is safe to realise. **AUTO** marks a
parameter an automation lane can drive; anything unmarked cannot move over time
(see the note at the bottom).

Generated from `HF_AUDIO_FX` in `@hyperframes/core/audio-fx`, which is the source
of truth — if this table and the code disagree, the code is right.

## Filter — which frequencies a track may occupy

| Effect      | Parameter                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `highpass`  | `frequency` 20–20000 Hz (300, log) **AUTO** · `q` 0.1–20 (0.707, log) **AUTO** · `poles` `1`\|`2` (2)       |
| `lowpass`   | `frequency` 100–20000 Hz (8000, log) **AUTO** · `q` 0.1–20 (0.707, log) **AUTO** · `poles` `1`\|`2` (2)     |
| `peaking`   | `frequency` 20–20000 Hz (1000, log) **AUTO** · `gain` −40–40 dB (0) **AUTO** · `q` 0.1–20 (1, log) **AUTO** |
| `lowshelf`  | `frequency` 20–2000 Hz (200, log) **AUTO** · `gain` −40–40 dB (0) **AUTO**                                  |
| `highshelf` | `frequency` 500–20000 Hz (4000, log) **AUTO** · `gain` −40–40 dB (0) **AUTO**                               |

`q` is bandwidth — higher is narrower. `poles` is the slope: `2` is the usual
biquad (12 dB/oct), `1` is gentler (6 dB/oct). Shelving filters have no `q`: the
Web Audio spec leaves it unused for them, so a control would have moved nothing.

## Dynamics — how level behaves over time

| Effect       | Parameter                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gain`       | `gain` −60–12 dB (0) **AUTO**                                                                                                                                                  |
| `compressor` | `threshold` −60–0 dB (−24) · `ratio` 1–20 (4) · `attack` 0.01–2000 ms (20, log) · `release` 0.01–9000 ms (250, log) · `knee` 1–8 (2.83) · `makeup` 0–36 dB (0) · `mix` 0–1 (1) |
| `limiter`    | `limit` −24–0 dB (−1) · `attack` 0.1–80 ms (5) · `release` 1–8000 ms (50, log) · `level_out` −24–24 dB (0)                                                                     |
| `gate`       | `threshold` −80–0 dB (−35) · `range` −80–0 dB (−24) · `ratio` 1–20 (10) · `attack` 0.01–9000 ms (1, log) · `release` 0.01–9000 ms (100, log) · `knee` 1–8 (2.83)               |

Cuts on `gain` go to −60 dB, boosts stop at +12: it is a level stage for making
room, and a chain that could add 40 dB would clip long before that was useful.
`knee` of 1 is a hard corner, higher eases into it. `mix` below 1 blends the dry
signal back in (parallel compression). `range` is how far down the gate pulls
when closed — a gate that pulls all the way to silence sounds like a switch.

## Nonlinear — changes the waveform's shape

| Effect     | Parameter                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saturate` | `type` `tanh`\|`atan`\|`cubic`\|`exp`\|`alg`\|`quintic`\|`sin`\|`erf`\|`hard` (tanh) · `threshold` −40–0 dB (−6) · `output` −24–24 dB (0) **AUTO** · `oversample` 1–8× (4) |
| `bitcrush` | `bits` 1–32 (8) · `samples` 1–250× (1) · `mix` 0–1 (1)                                                                                                                     |

`tanh` is the gentlest curve and `hard` is outright clipping. Higher `oversample`
costs more CPU and keeps aliasing down. `samples` repeats each sample N times — a
crude downsample, which is where the lo-fi character comes from.

## Time — space and width

| Effect   | Parameter                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delay`  | `time` 1–5000 ms (250, log) **AUTO** · `feedback` 0.01–0.95 (0.35) **AUTO** · `mix` 0–1 (0.4) **AUTO**                                                              |
| `reverb` | `size` 0.05–1 (0.7) · `damping` 0–1 (0.5) · `wet` 0–1 (0.35) **AUTO** · `dry` 0–1 (0.7) **AUTO**                                                                    |
| `chorus` | `delay` 1–100 ms (7) **AUTO** · `depth` 0–10 ms (2) **AUTO** · `speed` 0.01–10 Hz (1) **AUTO** · `mix` 0–1 (0.5) **AUTO**                                           |
| `phaser` | `in_gain` 0–1 (0.4) **AUTO** · `out_gain` 0–2 (0.74) **AUTO** · `delay` 0.1–5 ms (3) · `decay` 0–0.99 (0.4) · `speed` 0.1–2 Hz (0.5) **AUTO** · `type` `0`\|`1` (0) |

Reverb convolves a _generated_ impulse, and both preview and render generate the
same one — so a room is reproducible without shipping an impulse file. Higher
`damping` rolls the top off the tail faster, which is what makes a large room
sound like a soft one. `feedback` near the top of its range is a very long tail;
it is bounded below 1 because at 1 it never decays.

## Why some parameters cannot be automated

Automation is handed to the audio thread once, as native `AudioParam` ramps and
curves, which is what keeps it sample-accurate and identical between preview and
render. A parameter can therefore only be automated if an `AudioParam` backs it.
Three kinds do not:

- **worklet processor options** — `compressor`, `limiter`, `gate` and `bitcrush`
  are AudioWorklets configured wholesale, so **none of their parameters are
  automatable at all**.
- **a WaveShaper curve** — `saturate`'s `type`, `threshold` and `oversample`
  rebuild the curve; only its `output` stage is a real param.
- **a convolution impulse** — `reverb`'s `size` and `damping` regenerate the
  impulse; `wet`/`dry` are gain stages and automate fine.

To make one of those behave differently over time, automate a `gain` stage
around it instead: a lane on a `gain` before a compressor changes how hard the
compressor is driven, which is most of what automating its threshold would have
done.
