# hdr-hlg-audio-windows

Regression test for HDR video clips that carry an audio track. Phone and camera
footage always does, but neither `hdr-regression` nor `hdr-hlg-regression` has
one. That gap is how #6556 shipped.

## What it covers

| Window | Time        | Source                                    | Expected                                      |
| ------ | ----------- | ----------------------------------------- | --------------------------------------------- |
| A      | 0.0 – 3.0 s | HLG clip with audio                       | every frame is its own source frame           |
| B      | 3.0 – 6.5 s | same clip, video starting 0.5 s after audio | first frame holds until 3.5 s, then it plays |

At 1080p a raw `rgb48le` frame is about 12 MB, so the default 512 MiB window holds
about 43 frames and each clip spans several extraction windows. Window A fails if
frames after the first window repeat. Window B fails if the delayed picture
starts early.

## Fixture

`src/hdr-hlg-audio.mp4` is the first 3 seconds of `hdr-hlg-regression`'s clip,
remuxed (no video re-encode) with a 440 Hz AAC tone.
`src/hdr-hlg-audio-delayed.mp4` is the same file with the video stream offset by
0.5 s (`-itsoffset 0.5`, stream copy).

## Running

```bash
cd packages/producer
bun run docker:test hdr-hlg-audio-windows

bun run docker:test:update hdr-hlg-audio-windows
```
