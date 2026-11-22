# HDR passthrough parity harness

Manual gate for `--experimental-hdr-passthrough` (HDR video passthrough with
cached overlays, `services/hdrPassthrough/`). It renders one composition
twice through the CLI, once with the flag off (the layered HDR composite) and
once with it on, and checks that the outputs match. It is not part of the
automated lanes: a 20 s 1080p HLG render through the layered path takes about
two minutes. The unit tests for its parsers and argument builders
(`*.test.ts` here) do run in the producer unit lane.

| File         | What it does                                                                          |
| ------------ | ------------------------------------------------------------------------------------- |
| `fixture.ts` | Generates the HLG source clip and the two compositions (positive + negative fixture). |
| `parity.ts`  | Renders both sides, probes, computes 10-bit PSNR / SSIM, prints and writes a report.  |
| `stats.ts`   | Pure parsing, comparison and threshold logic used by `parity.ts`.                     |

## Prerequisites

- `ffmpeg` / `ffprobe` with `libx265` on `PATH` (or `FFMPEG_PATH` / `FFPROBE_PATH`).
- One `bun install` and one `bun run build` at the repo root. The harness runs
  the CLI from source (`tsx packages/cli/src/cli.ts`), so later engine and
  producer changes are picked up without rebuilding, but `@hyperframes/core`
  resolves to its `dist/` under Node and needs the build once. Pass
  `--cli "node <repo>/packages/cli/dist/cli.js"` to test a built CLI instead.

## Fixtures

```sh
cd packages/producer
../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts                     # 20 s, 10 cues
../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 180 \
  --out /tmp/hf-hdr-passthrough-3min                                                    # benchmark, 90 cues
```

Default output is `$TMPDIR/hf-hdr-passthrough/`. Nothing it writes belongs in
git: the 20 s source is about 13 MB, the 3 min one about 120 MB.

- `assets/hlg-<n>s.mp4`: 1920x1080, 30 fps, HEVC Main10 `yuv420p10le`,
  tagged BT.2020 / ARIB STD-B67 / bt2020nc / limited range in both the
  container and the HEVC VUI, with a 48 kHz AAC tone. The picture is a slow
  four-colour `gradients` field (smooth ramps, where 8-bit handling bands)
  with a `testsrc2` inset in the middle (motion, hard edges, a frame counter).
- `captions/` (positive): the clip full-bleed on track 0
  (`position:absolute; inset:0; object-fit:cover`, same size as the canvas)
  and one caption clip per cue on track 1 (`data-start` / `data-duration`,
  frame-aligned, with a caption-free gap between cues). Captions are white
  bold text with a text shadow on a `rgba(12,14,20,0.58)` rounded box with a
  soft box shadow, so the overlays carry partial alpha on every edge. No
  timeline script (`data-no-timeline`): every overlay change is a clip
  boundary. Flag on must take the passthrough.
- `transformed/` (negative): identical, except the video carries
  `transform: scale(0.9) rotate(1.5deg)`. Flag on must fall back with
  `HDR passthrough off: not_full_canvas` (the transformed box no longer
  covers the canvas, which the layout probe checks before the transform
  itself), and both sides then render through the layered path.

`fixtures.json` in the output directory records the projects and what each
expects; `parity.ts --fixtures` reads it.

## Running the parity check

```sh
cd packages/producer
../../node_modules/.bin/tsx src/hdr-passthrough-harness/parity.ts --fixtures /tmp/hf-hdr-passthrough
```

Per project it writes `<fixtures>/parity/<project>/{off,on}.{mp4,log}`,
`psnr.log`, `ssim.log` and `report.json`, and prints a summary. The exit code
is 0 only when every check passes.

Useful options:

| Option                   | Effect                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--only off` / `on`      | Render one side only (single-output checks: render ok, HDR tags, audio, frames)                                                                    |
| `--skip-render`          | Re-run the comparison on existing `off.mp4` / `on.mp4`                                                                                             |
| `--project <dir>`        | Any project instead of the generated fixtures (`--duration` enables the frame check, `--expect passthrough\|fallback`, `--expect-reason <reason>`) |
| `--render-arg <arg>`     | Extra CLI argument for both sides, repeatable (for example `--render-arg=--gpu`)                                                                   |
| `--quality`, `--workers` | Passed to both renders (defaults `standard`, `1`)                                                                                                  |
| `--cli "<cmd>"`          | CLI to run instead of the worktree source                                                                                                          |
| `--min-mean-psnr` etc.   | Override a threshold                                                                                                                               |

Do not pass `--start` / `--end`: a range render is always SDR, so it never
reaches either HDR path.

The flag-off side always runs with `HF_EXPERIMENTAL_HDR_PASSTHROUGH` removed
from its environment, so a shell that exports it cannot turn both sides into
passthrough renders.

## Checks and thresholds

Layered (flag off) is the reference.

| Check                                                                        | Threshold                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| both renders exit 0                                                          | required                                                                                  |
| flag-on route (`on.path`)                                                    | `captions`: passthrough completed. `transformed`: fallback with `not_full_canvas`         |
| HDR tags on each output                                                      | `bt2020` / `arib-std-b67` (`smpte2084` with `--transfer pq`) / `bt2020nc` / `yuv420p10le` |
| codec, profile, size, rate, tag, colour range, audio codec / rate / channels | identical                                                                                 |
| video packet count                                                           | identical, and equal to duration x fps                                                    |
| container duration                                                           | within 1 frame                                                                            |
| HDR side data on the first frame                                             | same set (the HDR encode path writes mastering display + CLL for HLG too)                 |
| audio stream                                                                 | present on both                                                                           |
| PSNR, mean of per-frame `psnr_avg`                                           | >= 45 dB                                                                                  |
| PSNR, worst frame                                                            | >= 40 dB                                                                                  |
| SSIM, mean of per-frame `All`                                                | >= 0.990                                                                                  |
| SSIM, worst frame                                                            | >= 0.980                                                                                  |

PSNR and SSIM run on `yuv420p10le` for both inputs (peak 1023), after
`setpts=PTS-STARTPTS`, so they measure the 10-bit planes the HDR encoder
wrote rather than an 8-bit downconvert. A frame with MSE 0 counts as 100 dB.

### Why these numbers

On the generated fixtures the two sides come out bit-identical: the
passthrough converts the source to `rgb48le` exactly as the layered frame
extraction does, blends the same LUT-mapped overlay pixels at 16 bits, and
hands the encoder the same `rgb48le` frames, so x265 makes the same
decisions. The thresholds leave room for what can still differ on other
content: the 16-bit `maskedmerge` rounds 1 LSB away from the Node blend on
some partial-alpha pixels, and one changed input pixel makes the CRF encoder
diverge for the rest of the GOP. 45 dB mean / 40 dB worst is the level where
that encoder noise sits and a real defect does not: a caption shown on the
wrong frame, a missing overlay state or an 8-bit (banded) blend costs a
frame well below 40 dB, and a wrong transfer mapping (overlays in SDR
instead of HLG signal) pulls every caption frame down. Read the worst frame
index (`psnr.min ... at frame N`) against the cue boundaries before
loosening a threshold: a dip exactly at a boundary is the off-by-one this
gate exists to catch.

## Measured

2026-11-22, Linux x64, 32 cores shared with other jobs (load average 50-100
during the runs, so absolute wall times are inflated), `--quality standard`,
`--workers 1`, software libx265.

| Fixture            | off wall (layered stage)      | on wall (passthrough stage)               | speedup | PSNR / SSIM                 |
| ------------------ | ----------------------------- | ----------------------------------------- | ------- | --------------------------- |
| `captions` 20 s    | 324.0 s                       | 61.4 s (84 states, 11 unique)             | 5.3x    | identical, 600/600 frames   |
| `captions` 60 s    | 640.8 s (634.7 s)             | 87.5 s (81.4 s: 23.6 s capture, 244/31)   | 7.3x    | identical, 1800/1800 frames |
| `captions` 180 s   | not run, ~1920 s at 60 s rate | 170.9 s (160.0 s: 75.5 s capture, 724/91) | ~11x    | (flag-on side only)         |
| `transformed` 20 s | 319.9 s                       | 437.9 s, fallback `not_full_canvas`       | -       | identical, 600/600 frames   |

Every other check passed: HEVC Main10 `yuv420p10le`, BT.2020 / ARIB STD-B67
/ bt2020nc / tv, `hvc1`, exact frame count and duration, AAC 48 kHz stereo,
same first-frame side data (mastering display, content light level). On the
passthrough side the stage is overlay capture (about 100 ms per planned
state) followed by one ffmpeg composite + encode (about 60 fps at 1080p
here); the layered stage runs at about 350 ms per frame on the same host.
