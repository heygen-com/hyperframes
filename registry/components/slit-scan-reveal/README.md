# slit-scan-reveal

Time experiment primitive: the frame's rows sample the subject at offset
times. An authored token mark (accent-ringed disc with an orbit dot)
sweeps in on ONE pure position function pos(t); a canvas painter draws the
frame as row (or column) slices, slice i showing the subject's state at
t - offset(i). Arrival smears through time, near bands leading, far bands
trailing; on the resolve cue the offsets collapse to zero with one eased
0.6s pass and the mark holds coherent. 4s authored, elastic HOLD (never
time-scaled).

## Mounting

```html
<div
  class="clip"
  data-composition-id="slit-scan-reveal"
  data-composition-src="./components/slit-scan-reveal.html"
  data-variable-values='{"axis":"cols","spread":0.6,"accent":"violet"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

## Variables

| id         | type   | default | notes                                                                    |
| ---------- | ------ | ------- | ------------------------------------------------------------------------ |
| axis       | enum   | rows    | rows smears across horizontal slices, cols across vertical slices.       |
| spread     | number | 0.45    | Maximum sampling offset in seconds across the frame (clamped 0.1 to 1.2). |
| resolve_at | number | 2.2     | Seconds when the offsets start collapsing. Clamped so the 0.6s collapse and any exit fit inside the clip. |
| accent     | enum   | green   | green maps to --brand, blue to --accent, violet to --accent-2.           |
| exit       | enum   | none    | none holds the resolved mark (frame roots own transitions); fade or up add a 0.45s departure. |

## Choreography

- 0.25s: the subject starts its sweep from the wing (rows: in from the
  left; cols: down from the top, so the slices always cut across the
  travel): cubic-eased travel to dead center with a decaying two-cycle
  sine bob (integer cycles, exactly zero at rest) and a settling scale.
- Throughout the sweep the slices smear it through time: slice 0 shows
  now, the far slice shows spread seconds ago, with a seeded hairline
  jitter per slice so the edge stays organic.
- resolve_at: the offsets collapse to zero over 0.6s (eased both ends);
  the smear zips shut onto the resting subject.
- HOLD: dead still and coherent, elastic with the clip duration.

Sync point `resolved` fires as the collapse completes; align SFX to it.

## Determinism

pos(t) is closed-form, so any sampled time t - offset is exact; per-slice
jitter is one table computed once at build from fixed LCG seed 0x51175c4e.
One plain-object anchor tween feeds one painter that clears and redraws
every slice from scratch as a pure function of the timeline time, so
eventful seeks land identical frames in any order and either direction.
The raster basis is the host box measured once at mount; sampled times
before mount clamp to the subject's start state (not-yet-appeared), and
after the collapse every slice samples the same resting state.
