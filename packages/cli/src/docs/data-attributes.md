# Data Attributes

Core attributes for controlling element timing and behavior.

## Timing

- `data-start="0"` — Start time in seconds
- `data-duration="5"` — Duration in seconds
- `data-track-index="0"` — Timeline track number (controls z-ordering)

## Media

- `data-media-start="2"` — Media playback offset / trim point (seconds)
- `data-volume="0.8"` — Audio/video volume, 0 to 1
- `data-has-audio="true"` — Indicates video has an audio track

## Composition

- `data-composition-id="root"` — Unique ID for composition wrapper (required)
- `data-width="1920"` — Composition width in pixels
- `data-height="1080"` — Composition height in pixels
- `data-composition-src="./intro.html"` — Nested composition source

## Element Visibility

Add `class="clip"` to timed elements so the runtime can manage their visibility lifecycle.
