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
- `captions-gsap/` (positive): `captions` plus a badge that a GSAP `.from()`
  with lazy init (`immediateRender: false`, so it reads its end values the
  first time the playhead reaches it) slides in at 1 s and a `set()`
  recolours at 2 s. GSAP is the only writer, so flag on must take the
  passthrough: GSAP's own ticker frame is not a history-dependent driver.
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
  runtime's seek-time global, which no static check names (`seek_callback`:
  the analysis page's page code watch sees it run on eligibility's seeks), a
  three-frame flash on frames 50-52 of a cue-free composition from a raw
  `requestAnimationFrame` loop (`flash-raf`, declined where it registers as
  `seek_callback`) and from the same setter (`flash-setter`, `seek_callback`
  the same way), drivers whose output
  depends on the order or number of seeks rather than the time alone (a
  `requestAnimationFrame` counter, `raf-counter`; the same counter shown
  only for its first three callbacks, `raf-warmup`; a film-time
  `setInterval` that appends a mark every 0.5 s, `timer-append`: all
  `seek_callback`; a lazily initialised GSAP `.from()` whose end value a
  seek-time setter also writes, `gsap-from-lazy`: `seek_callback`; a
  `gsap.delayedCall` that recolours a badge at 1.5 s on GSAP's global
  timeline, `gsap-delayed-call`: `seek_callback`), a fade the capture
  fingerprint cannot see, inside a closed shadow root (`closed-shadow-root`)
  or an `<object>`'s SVG document (`embedded-document`), both
  `overlay_unreadable`, an
  animated GIF (`video_count`:
  the compiler turns it into a second video), a canvas (`canvas`), and
  a GSAP tween that changes the overlay on every frame
  (`overlay_continuous_animation`). Page code that runs on seeks and paints
  where no fingerprint reads, a custom highlight from a setter on the
  seek-time global (`setter-highlight`) or from an accessor a GSAP `set()`
  writes through (`gsap-proxy-highlight`), declines as `seek_callback`
  however the page compiled it or named it: the same setter from an inserted
  inline script, `eval`, `new Function`, a script named
  `hyperframes://injected/0`, an eval named like a DevTools evaluation, a
  string timer, and a file named `gsap-core.js` (`dynamic-inline-setter`,
  `eval-setter`, `new-function-setter`, `renderer-named-setter`,
  `devtools-named-setter`, `string-timer-setter`, `fake-gsap-filename`), and
  the accessor from an inserted script (`dynamic-inline-gsap-proxy`).
  `builtins-counter` replaces the builtins a shim could call and shows how
  often they ran; it declines on its `requestAnimationFrame` loop, and its
  flag-on (layered fallback) render must match flag off frame for frame,
  which holds only while nothing the passthrough adds to the page calls them.
  Pages that attack the passthrough's own checks: `fingerprint-digest`,
  `fingerprint-encode` and `fingerprint-json` replace the builtins an
  in-page fingerprint would hash with (`SubtleCrypto#digest`,
  `TextEncoder#encode`, `JSON.stringify`) by builtins that return a
  constant; `jsurl-location-setter` and `jsurl-anchor-setter` compile the
  seek-time setter from a `javascript:` URL named like a DevTools
  evaluation, through `location.href` and a clicked anchor;
  `error-getters-raf` paints whenever anything formats an error
  (`Error.prototype.name` / `message` getters) and runs an animation-frame
  loop; `shadow-worker-canvas` has a worker draw a counter into an offscreen
  canvas in an open shadow root: all `seek_callback`. `picker-icon-gif` and
  `scroll-button-gif` paint an animated GIF in `::picker-icon` and
  `::scroll-button()` (`overlay_unsupported`). `tostring-painter` paints the
  observer constructors' and `customElements.define`'s source text: it must
  take the passthrough and match the layered render, which holds only while
  nothing the passthrough does is visible to the page.
  `error-getters-raf`'s flag-on (layered fallback) render must match flag
  off frame for frame too, as must every repeatable fallback (`raf-counter`
  included: its count of seeks before frame 0 must be flag off's).
  `audio-controls-gsap` has GSAP turn an `<audio>`'s controls on for 0.6 s
  with no page code at all: only capture's per-frame probes see the control's
  playback position move (`overlay_unverified`).
  Pages whose paint follows browser state a seek leaves behind, with no page
  code after load, must take the passthrough and match the layered render:
  `scroll-clamp` (a `set()` shrinks a scroller's content at 1 s, which
  clamps its 1500 px offset for good) and `lazy-decode-popover` (a `set()`
  shows a lazy image at 1.5 s, whose `decode()` reaction opens a popover
  through a bound builtin), and `snap-anchor-scroll` (`set()`s of
  `scrollTop` on a snapping scroller and of row heights above its scroll
  anchor: the browser moves the offset, synchronously). `smooth-scroll`
  (GSAP `set()`s of `scrollTop` on a `scroll-behavior: smooth` scroller,
  which the browser animates after the probe) and `smooth-scroll-toggle`
  (the same scroller made smooth only inside the seek that scrolls it)
  decline as `overlay_unsupported` (wall clock: the layered render's
  screenshot catches a smooth scroll wherever the browser's clock has it,
  so two flag-off renders under load differ at the jump frames).
  `css-transition-set` (a GSAP `set()` of opacity on an element with a
  0.5 s CSS transition) declines as `overlay_non_gsap_animation` at the
  probe after the seek that starts the transition (wall clock). SVG
  images that animate once parsed as XML
  decline as `overlay_non_gsap_animation` (wall clock): `svg-prefixed-smil`
  (`<s:animate>`, `s` bound to the SVG namespace) and `svg-reference-css`
  (`anim&#97;tion` and `&#64;keyframes` in `<style>`).
  Run these with `--only on` when the check is only the route and reason
  (both sides would take the layered path); run `builtins-counter`,
  `error-getters-raf` and `tostring-painter` with both.

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
  (`framemd5`, which `parity.ts` checks by default).

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
| `--no-require-identical` | Drop the default `framemd5` check (every decoded frame must match) and pass on the PSNR / SSIM thresholds alone                                    |
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

| Check                                                                        | Threshold                                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| both renders exit 0                                                          | required                                                                                                              |
| flag-on route (`on.path`)                                                    | `captions`, `captions-offset`, `captions-gsap`: passthrough completed. `transformed`: fallback with `not_full_canvas` |
| HDR tags on each output                                                      | `bt2020` / `arib-std-b67` (`smpte2084` with `--transfer pq`) / `bt2020nc` / `yuv420p10le`                             |
| codec, profile, size, rate, tag, colour range, audio codec / rate / channels | identical                                                                                                             |
| video packet count                                                           | identical, and equal to duration x fps                                                                                |
| container duration                                                           | within 1 frame                                                                                                        |
| HDR side data on the first frame                                             | same entries, type and values (the HDR encode path writes mastering display + CLL for HLG too)                        |
| video stream side data (container `mdcv` / `clli`, Dolby Vision config)      | same entries, type and values                                                                                         |
| audio stream                                                                 | present on both                                                                                                       |
| decoded frames (`framemd5`)                                                  | all identical (default; `--no-require-identical` drops it)                                                            |
| PSNR, mean of per-frame `psnr_avg`                                           | >= 45 dB                                                                                                              |
| PSNR, worst frame                                                            | >= 40 dB                                                                                                              |
| SSIM, mean of per-frame `All`                                                | >= 0.990                                                                                                              |
| SSIM, worst frame                                                            | >= 0.980                                                                                                              |

PSNR and SSIM run on `yuv420p10le` for both inputs (peak 1023), after
`setpts=PTS-STARTPTS`, so they measure the 10-bit planes the HDR encoder
wrote rather than an 8-bit downconvert. A frame with MSE 0 counts as 100 dB.

### Why these numbers

The contract is bit-identical decoded frames, so `framemd5` is checked by
default and is the gate; PSNR and SSIM are there to say how far apart two
outputs are, not to excuse a difference. A small stale overlay does not
move them much: a 128 px badge missing on three frames of a 3 s clip scored
80.5 dB mean, 55.0 dB worst and SSIM 0.9996, well inside every threshold.

On the generated fixtures the two sides come out bit-identical: the
passthrough converts the source to `rgb48le` exactly as the layered frame
extraction does, blends the same LUT-mapped overlay pixels at 16 bits, and
hands the encoder the same `rgb48le` frames, so x265 makes the same
decisions. The thresholds leave room for what can still differ on other
content: the 16-bit `maskedmerge` rounds 1 LSB away from the Node blend on
some partial-alpha pixels, and one changed input pixel makes the CRF encoder
diverge for the rest of the GOP. With `--no-require-identical`, 45 dB mean /
40 dB worst is the level where that encoder noise sits: a full caption shown
on the wrong frame or an 8-bit (banded) blend costs a frame well below 40 dB,
and a wrong transfer mapping (overlays in SDR instead of HLG signal) pulls
every caption frame down, but a small overlay wrong on a few frames can pass. Read the worst frame
index (`psnr.min ... at frame N`) against the cue boundaries before
loosening a threshold: a dip exactly at a boundary is the off-by-one this
gate exists to catch.

## Measured

Since the passthrough paces the encoder like the layered path
(`services/hdrPassthrough/README.md`, "Encoder pacing"), a flag-on render
costs about the encoder's per-frame latency times the frame count plus the
page loads. On a shared 32-core Linux host, `--quality standard`,
`--workers 1`, software libx265, the 20 s `captions` and `captions-gsap`
fixtures render about 1.35-1.44x faster flag on than flag off at high load
(load average 33-174) and up to about 2x at moderate load; the gain shrinks
as the load grows. Compare job times (the render's own trace, compile
through assemble), not wall times: renders share one lock per user account.
A fallback costs a few seconds over a flag-off render: the eligibility
check plus the deferred video frame extraction, which the flag-off render
does earlier instead.
