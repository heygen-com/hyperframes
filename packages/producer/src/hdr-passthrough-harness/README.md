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
../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --transfer pq \
  --out /tmp/hf-hdr-passthrough-pq                                                      # PQ source
../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 3 --ineligible \
  --out /tmp/hf-hdr-passthrough-neg                                                     # one fixture per fallback class
../../node_modules/.bin/tsx src/hdr-passthrough-harness/fixture.ts --duration 3 --edge \
  --out /tmp/hf-hdr-passthrough-edge                                                    # rate, size, duration, seek edge cases
```

`--cues <n>` overrides the cue count (default one per 2 s).

Default output is `$TMPDIR/hf-hdr-passthrough/`. Nothing it writes belongs in
git: the 20 s source is about 13 MB, the 3 min one about 120 MB.

- `assets/<transfer>-<n>s.mp4`: 1920x1080, 30 fps, HEVC Main10 `yuv420p10le`,
  tagged BT.2020 / ARIB STD-B67 (or SMPTE ST 2084 with HDR10 mastering
  display and content light level metadata for `--transfer pq`) / bt2020nc /
  limited range in both the container and the HEVC VUI, with a 48 kHz AAC tone. The picture is a slow
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
- `captions-offset/` (positive): `captions` on a stream-copy remux of the
  source whose streams all start 0.2 s into the file (`-output_ts_offset`,
  like a file without an edit list or a transport-stream remux). The layered
  path holds the first frame until the stream starts; flag on must take the
  passthrough and match it.
- `transformed/` (negative): identical, except the video carries
  `transform: scale(0.9) rotate(1.5deg)`. Flag on must fall back with
  `HDR passthrough off: not_full_canvas` (the transformed box no longer
  covers the canvas, which the layout probe checks before the transform
  itself), and both sides then render through the layered path.

- `ineligible-<case>/` (with `--ineligible`): the `captions` fixture with one
  thing changed that the passthrough cannot reproduce, each with the reason
  the flag-on render must log (`INELIGIBLE_CASES` in `fixture.ts`): an
  enlarged video (`not_full_canvas`), a mirrored or filtered video
  (`transform_or_filter`), a rounded video or rounded clipping ancestor
  (`clip_or_mask`), a CSS animation, a Lottie player
  element, three.js, a WebGPU element, SVG SMIL, animated WebP / APNG /
  AVIF images and an `hf-seek` listener that rewrites a counter
  (`overlay_non_gsap_animation`), the same counter driven by a setter on the
  runtime's seek-time global, which no static check names
  (`overlay_unverified`: capture's verification probes catch it), an animated GIF (`video_count`:
  the compiler turns it into a second video), a canvas (`canvas`), and
  a GSAP tween that changes the overlay on every frame
  (`overlay_continuous_animation`). Run these with `--only on`: the check is
  the route and reason, and both sides would take the layered path.

- `edge-<case>/` (with `--edge`): the `captions` layout with one thing
  varied that the `captions` fixture holds fixed, each on its own source
  clip (`EDGE_CASES` in `fixture.ts`): a 29.97 fps (30000/1001) source in a
  30 fps and in a 30000/1001 composition, a 23.976 fps (24000/1001) source in
  a 30 fps composition, a 1279x719 canvas over a 1280x720 source (scaled
  onto the odd canvas), a 4:3 source under `object-fit: cover` on a 16:9
  canvas (must fall back with `object_fit`), a 7.01 s composition (210.3
  frames, so the render writes 211), and `mediaStart` 13.37 s into a 20 s
  source with one keyframe every 300 frames. Each records its own rate and
  duration in the manifest, which `parity.ts` renders and checks with.
  Every positive case must decode to the same frames as the layered render
  (run with `--require-identical`).

`fixtures.json` in the output directory records the projects, the transfer
and what each expects; `parity.ts --fixtures` reads it.

## Running the parity check

```sh
cd packages/producer
../../node_modules/.bin/tsx src/hdr-passthrough-harness/parity.ts --fixtures /tmp/hf-hdr-passthrough
```

Per project it writes `<fixtures>/parity/<project>/{off,on}.{mp4,log}`,
`psnr.log`, `ssim.log` and `report.json`, and prints a summary, including the
ffmpeg version, each side's job time (the `assemble` end checkpoint of its
`[Render:trace]` lines, compile through assemble) and wall time, the
`framemd5` comparison of the two outputs' decoded frames, and the
passthrough's overlay capture counts (states, candidates, screenshots, unique
PNGs, capture time) read from its log. The speedup is by job time when both
logs have it. The exit code is 0 only when every check passes.

Useful options:

| Option                   | Effect                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--projects a,b`         | Only these manifest projects (with `--fixtures`)                                                                                                   |
| `--only off` / `on`      | Render one side only (single-output checks: render ok, HDR tags, audio, frames)                                                                    |
| `--skip-render`          | Re-run the comparison on existing `off.mp4` / `on.mp4`                                                                                             |
| `--require-identical`    | Also fail unless every decoded frame matches (`framemd5`), not just the PSNR / SSIM thresholds                                                     |
| `--fps <rate>`           | Render rate for `--project`: `30` or `30000/1001` (manifest projects use their own)                                                                |
| `--project <dir>`        | Any project instead of the generated fixtures (`--duration` enables the frame check, `--expect passthrough\|fallback`, `--expect-reason <reason>`) |
| `--render-arg <arg>`     | Extra CLI argument for both sides, repeatable (for example `--render-arg=--gpu`)                                                                   |
| `--quality`, `--workers` | Passed to both renders (defaults `standard`, `1`)                                                                                                  |
| `--cli "<cmd>"`          | CLI to run instead of the worktree source                                                                                                          |
| `--transfer hlg\|pq`     | Expected output transfer; defaults to the manifest's (`hlg` for `--project`)                                                                       |
| `--min-mean-psnr` etc.   | Override a threshold                                                                                                                               |

Do not pass `--start` / `--end`: a range render is always SDR, so it never
reaches either HDR path.

The flag-off side always runs with `HF_EXPERIMENTAL_HDR_PASSTHROUGH` removed
from its environment, so a shell that exports it cannot turn both sides into
passthrough renders.

## Checks and thresholds

Layered (flag off) is the reference.

| Check                                                                        | Threshold                                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| both renders exit 0                                                          | required                                                                                             |
| flag-on route (`on.path`)                                                    | `captions`, `captions-offset`: passthrough completed. `transformed`: fallback with `not_full_canvas` |
| HDR tags on each output                                                      | `bt2020` / `arib-std-b67` (`smpte2084` with `--transfer pq`) / `bt2020nc` / `yuv420p10le`            |
| codec, profile, size, rate, tag, colour range, audio codec / rate / channels | identical                                                                                            |
| video packet count                                                           | identical, and equal to duration x fps                                                               |
| container duration                                                           | within 1 frame                                                                                       |
| HDR side data on the first frame                                             | same set (the HDR encode path writes mastering display + CLL for HLG too)                            |
| audio stream                                                                 | present on both                                                                                      |
| PSNR, mean of per-frame `psnr_avg`                                           | >= 45 dB                                                                                             |
| PSNR, worst frame                                                            | >= 40 dB                                                                                             |
| SSIM, mean of per-frame `All`                                                | >= 0.990                                                                                             |
| SSIM, worst frame                                                            | >= 0.980                                                                                             |

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

2026-11-22, Linux x64, 32 cores shared with other jobs (load average 15-45
during the runs), `--quality standard`, `--workers 1`, software libx265, no
GPU encoder. Renders share one lock per user account, so wall time can
include waiting for an unrelated render; "job" is the render's own elapsed
time from its trace (compile through assemble), the fair comparison.

| Fixture                           | off: job (wall)       | on: job (wall)     | overlay states (candidates / screenshots) | capture | speedup (job) | off vs on            |
| --------------------------------- | --------------------- | ------------------ | ----------------------------------------- | ------- | ------------- | -------------------- |
| HLG `captions` 20 s, 10 cues      | 174.7 s (179.5 s)     | 13.8 s (18.0 s)    | 21 (84 / 11)                              | 2.8 s   | 12.6x         | identical, 600/600   |
| HLG `captions` 60 s, 30 cues      | 529.4 s (545.1 s)     | 37.2 s (56.8 s)    | 61 (244 / 31)                             | 7.8 s   | 14.2x         | identical, 1800/1800 |
| HLG `captions` 180 s, 90 cues     | 1592.1 s (1597.0 s)   | 182.6 s (213.9 s)  | 181 (724 / 91)                            | 30.2 s  | 8.7x          | identical, 5400/5400 |
| PQ `captions` 20 s, 10 cues       | 164.1 s (174.5 s)     | 13.4 s (31.5 s)    | 21 (84 / 11)                              | 2.4 s   | 12.3x         | identical, 600/600   |
| HLG 120 s, a cue every 3 s        | 1087.9 s (2262.2 s)   | 84.8 s (113.3 s)   | 81 (324 / 41)                             | 13.4 s  | 12.8x         | identical, 3600/3600 |
| HLG 16 min, a cue every 3 s       | ~8790 s, extrapolated | 758.1 s (1673.6 s) | 641 (2564 / 321)                          | 142.6 s | ~11.6x        | flag-on side only    |
| HLG `transformed` 20 s (fallback) | 326.0 s (330.1 s)     | 334.3 s (359.1 s)  | fallback `not_full_canvas`                | -       | 0.98x         | identical, 600/600   |
| PQ `transformed` 20 s (fallback)  | 272.6 s (288.1 s)     | 289.9 s (315.2 s)  | fallback `not_full_canvas`                | -       | 0.94x         | identical, 600/600   |

"Identical" means every decoded frame matched (PSNR 100 dB / SSIM 1.0 on
every frame, and the same `framemd5`). The 16 min flag-off side was not
rendered: at the 120 s run's 0.302 s per frame it would take about 2.4 h, so
the figure is 28800 frames at that rate plus extraction. Every other check
passed on every output: HEVC Main10 `yuv420p10le`, BT.2020 / ARIB STD-B67 or
SMPTE ST 2084 / bt2020nc / tv, `hvc1`, exact frame count and duration, AAC
48 kHz stereo, same first-frame side data (mastering display, content light
level).

On the passthrough side, overlay capture costs about 20 ms per candidate
probe plus about 110 ms per screenshot; the rest of the stage is one ffmpeg
composite and encode (35-50 fps at 1080p on this host), which is what bounds
the speedup on long renders. The layered stage runs at about 0.3 s per frame.
A fallback costs a few seconds over a flag-off render: the eligibility check
plus the deferred video frame extraction (1.2-1.8 s at 20 s), which the
flag-off render does earlier instead.

Every `--ineligible` class (3 s fixtures) fell back with its expected reason.

### With the seek-hook check and verification probes

Same host and settings, ffmpeg 7.0.2, after the planner started declining
`hf-seek` listeners and overlay capture started re-probing each candidate's
ends and every 0.5 s inside it. "verify" is the number of extra probes.

| Fixture                           | off: job | on: job | overlay states (candidates / screenshots / verify) | capture | speedup (job) | off vs on            |
| --------------------------------- | -------- | ------- | -------------------------------------------------- | ------- | ------------- | -------------------- |
| HLG `captions` 20 s, 10 cues      | 222.0 s  | 22.0 s  | 21 (84 / 11 / 62)                                  | 4.2 s   | 10.1x         | identical, 600/600   |
| HLG `captions-offset` 20 s        | 259.3 s  | 28.3 s  | 21 (84 / 11 / 62)                                  | 4.8 s   | 9.2x          | identical, 600/600   |
| HLG `captions` 60 s, 30 cues      | 591.5 s  | 44.8 s  | 61 (244 / 31 / 182)                                | 11.5 s  | 13.2x         | identical, 1800/1800 |
| HLG `captions` 180 s, 90 cues     | 1689.7 s | 102.0 s | 181 (724 / 91 / 542)                               | 31.7 s  | 16.6x         | identical, 5400/5400 |
| PQ `captions` 20 s, 10 cues       | 242.0 s  | 24.6 s  | 21 (84 / 11 / 62)                                  | 4.4 s   | 9.8x          | identical, 600/600   |
| PQ `captions-offset` 20 s         | 266.6 s  | 22.0 s  | 21 (84 / 11 / 62)                                  | 4.2 s   | 12.1x         | identical, 600/600   |
| HLG `transformed` 20 s (fallback) | 343.9 s  | 375.0 s | fallback `not_full_canvas`                         | -       | 0.92x         | identical, 600/600   |
| PQ `transformed` 20 s (fallback)  | 411.4 s  | 356.2 s | fallback `not_full_canvas`                         | -       | 1.15x         | identical, 600/600   |

All 18 `--ineligible` classes (3 s) fell back with their expected reason,
including `hf-seek-listener` (`overlay_non_gsap_animation`) and
`seek-time-setter` (`overlay_unverified`).

### Edge cases

Same host, 2026-11-22, after merging main, ffmpeg 7.0.2 unless noted,
`--require-identical`. `--edge` fixtures are 5 s (7.01 s for the
fractional duration) with a caption cue every 2 s; layered extraction reads
1080p sources in 43-frame windows, so every case re-seeks the source between
windows on the flag-off side.

| Fixture                                      | off: job | on: job | overlay states (candidates / screenshots)                    | speedup (job) | off vs on          |
| -------------------------------------------- | -------- | ------- | ------------------------------------------------------------ | ------------- | ------------------ |
| 29.97 (30000/1001) source, 30 fps comp       | 47.7 s   | 8.1 s   | 7 (28 / 4)                                                   | 5.9x          | identical, 150/150 |
| 29.97 source, 30000/1001 comp                | 53.5 s   | 8.8 s   | 7 (28 / 4)                                                   | 6.1x          | identical, 150/150 |
| 23.976 (24000/1001) source, 30 fps comp      | 49.6 s   | 9.6 s   | 7 (28 / 4)                                                   | 5.2x          | identical, 150/150 |
| 1280x720 source on a 1279x719 canvas         | 32.1 s   | 7.7 s   | 7 (28 / 4)                                                   | 4.2x          | identical, 150/150 |
| 1440x1080 source, `cover` on 1920x1080       | 63.1 s   | 46.1 s  | fallback `object_fit` (source 1440x1080 vs canvas 1920x1080) | 1.4x          | identical, 150/150 |
| 7.01 s composition (211 frames)              | 60.7 s   | 7.6 s   | 9 (37 / 5)                                                   | 8.0x          | identical, 211/211 |
| `mediaStart` 13.37 in a 20 s source, GOP 300 | 43.2 s   | 6.0 s   | 7 (28 / 4)                                                   | 7.2x          | identical, 150/150 |
| HLG `captions` 3 s (merge smoke)             | 30.6 s   | 7.0 s   | 5 (20 / 3)                                                   | 4.3x          | identical, 90/90   |
| HLG `captions` 20 s, ffmpeg n8.0.1 (CI pin)  | 173.3 s  | 15.8 s  | 21 (84 / 11)                                                 | 11.0x         | identical, 600/600 |

"Identical" is `framemd5` equality of every decoded frame. The cover-scaled
fallback's speedup is load noise: both sides took the layered path. The
ffmpeg 8 row ran both renders and the harness on the BtbN n8.0.1 build the
Dockerfiles and CI pin (both outputs carry `Lavc62` / `Lavf62`). On that
build `maskedmerge` in `gbrp16le` with `m = a8 * 257` matches the layered
blend (`Math.round(dom * a + hdr * (1 - a))`, `a = a8 / 255`) on every one of
307200 samples (all 256 alphas, 400 random pairs per alpha, three planes),
as on 7.0.2; Ubuntu's 4.2.7 misses 51810 of them by 1 LSB.
