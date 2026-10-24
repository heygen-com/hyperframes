# Mixing in HyperFrames

Preview and render run the same Web Audio graph, so what plays while scrubbing is what renders. Everything lives in attributes on the `<audio>` or `<video>` element.

## Level and fades

| Attribute                       | Meaning                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `data-volume`                   | Track gain, 1 = 0 dB                                                                      |
| `data-fade-in`, `data-fade-out` | Edge fades in seconds                                                                     |
| `data-playback-rate`            | Constant speed, 0.1–10, pitch preserved; give a video and its paired audio the same value |

A crossfade is two clips on different tracks that overlap, each with a fade.

## `data-automation`: envelopes

```html
<audio
  id="music"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":2.5,"v":0.35}]}]}'
  …
></audio>
```

- `target` is `volume`, `rate` (a speed ramp, 0.1–10, overrides `data-playback-rate`) or `fx.<nodeId>.<param>`.
- `t` is seconds from the start of the clip, not of the composition. `v` is in the parameter's unit: 0..1 for volume, dB for a gain, Hz for a frequency.
- A lane holds its first value back to the clip's start and its last value to its end, so a bed that starts before the voice needs an explicit full-level point at `t: 0`.
- `curve` (-1..1) bends the segment leaving a point. 512 points per lane at most.
- Don't also tween `volume` with GSAP on a track that has a volume lane or a `data-volume`; lint flags both.

## `data-fx-chain`: effects

```json
{
  "version": 1,
  "nodes": [
    { "type": "highpass", "id": "n1", "label": "Remove rumble", "params": { "frequency": 80 } },
    {
      "type": "peaking",
      "id": "n2",
      "label": "Clarity",
      "params": { "frequency": 3000, "gain": 2.5, "q": 1 }
    },
    { "type": "limiter", "id": "n3", "params": { "limit": -1 } }
  ]
}
```

- Write the attribute double-quoted with the JSON's quotes as `&quot;`.
- Order is signal order. `id` is what automation targets (`fx.n2.gain`); give every node one, and a `label` when it does a named job. `enabled: false` bypasses a node.
- Effects: `gain`, `highpass`, `lowpass`, `peaking`, `lowshelf`, `highshelf`, `compressor`, `limiter`, `gate`, `saturate`, `delay`, `reverb`, `chorus`, `phaser`, `bitcrush`.
- `compressor`, `limiter`, `gate` and `bitcrush` can't be automated; a lane on them does nothing. Automate a `gain` before them instead.
- Never set `fromCarve` by hand.
- `reverb` and `delay` make the rendered track longer than its source; that is expected.

| It sounds like              | Reach for                                   |
| --------------------------- | ------------------------------------------- |
| Hum, rumble, handling noise | `highpass` at 80 Hz                         |
| Boomy, too close            | `peaking` 200 Hz, −4 dB                     |
| Muffled                     | `peaking` 250 Hz, −3 dB                     |
| Words hard to make out      | `peaking` 3 kHz, +2.5 dB, or duck the music |
| Harsh                       | `peaking` 3.2 kHz, −3 dB                    |
| Peaks clipping              | `limiter` last in the chain                 |

## Music under a voice

Duck the bed with a `volume` lane on the music: full level before the voice, down to about 0.3–0.4 while anyone speaks (word timings from `npx hyperframes transcribe` or the voiceover give the times), back up after. Then carve the bed, which dips only the bands the voice uses: `node <SKILL_DIR>/audio/scripts/carve.mjs --comp index.html` (needs `ffmpeg` and `@hyperframes/core` in the project; `--dry-run` to see the plan). It is the same analysis as Studio's carve panel. It reads only double-quoted attributes (JSON quotes as `&quot;`), so write the bed's chain and lanes that way or it overwrites them. Never put a carve on a voice track.

## Group buses

Give clips the same `data-audio-group="<id>"` to treat them as one group. An `<hf-audio-group id="<id>">` element with that id makes the group a submix bus with one `data-fx-chain`, one volume and one automation clock for every member. Keep one role per group: `voiceover`, `music`, `sfx`.
