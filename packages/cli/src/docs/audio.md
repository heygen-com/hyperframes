# Audio

Audio plays from `<audio>` and `<video>` elements, timed like any other clip.

## Timing and trim

- `data-start` and `data-duration` — when the clip plays and for how long, in seconds
- `data-media-start` — where in the file playback begins (trim point)

## Level

- `data-volume` — gain. `1` is 0 dB, `0` is silence, values above `1` boost up to `3.98` (+12 dB)
- `data-fade-in` and `data-fade-out` — linear fades at the clip edges, in seconds
- `data-has-audio="true"` — keeps a video's own sound (the default for footage with sound); use `muted` on silent footage
- `data-automation` volume lane — ducking and shaped envelopes, multiplied on top of the above

## Related

- `hyperframes docs data-attributes` — every timing and media attribute
- `hyperframes transcribe` — word timestamps for captions; see `hyperframes docs transcribe`
