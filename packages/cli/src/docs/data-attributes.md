# Data Attributes

Core attributes for controlling element timing and behavior.

## Timing

- `data-start="0"` — Start time in seconds
- `data-duration="5"` — Duration in seconds
- `data-track-index="0"` — Studio timeline lane, display only. The render never reads it, and it does not control paint order (use CSS `z-index`) or prevent overlap. Optional.

## Media

- `data-media-start="2"` — Media playback offset / trim point (seconds)
- `data-volume="0.8"` — Audio/video gain. `1` is 0 dB, `0` is silence, and values above `1` boost up to `3.98` (+12 dB)
- `data-has-audio="true"` — Indicates video has an audio track

## Composition

- `data-composition-id="root"` — Unique ID for composition wrapper (required)
- `data-width="1920"` — Composition width in pixels
- `data-height="1080"` — Composition height in pixels
- `data-composition-src="./intro.html"` — Nested composition source

## Element Visibility

Add `class="clip"` to timed elements. The runtime keys visibility off `data-start`, not this class, but the shared `.clip` rule is what gives a scene its full-frame box and Studio treats it as an edit hint.
