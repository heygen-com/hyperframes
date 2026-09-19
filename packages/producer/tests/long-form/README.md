# Long-form render fixtures

Manual gates for the long-form render work (PRINFRA-1196; spec and phase plans live outside this repo). Not part of the automated lanes (they render for minutes and need ~600 MB of source).

## Generate the source once

```sh
mkdir -p /tmp/hf-longform/assets && cd /tmp/hf-longform
ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -t 300 -c:v libx264 -preset ultrafast -crf 23 -g 30 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart assets/long.mp4
node <repo>/packages/producer/tests/long-form/gen.mjs
```

For the 40-minute soak fixture use `-t 2400` and `DUR=2400 node .../gen.mjs`.

## Run a gate against the worktree build

```sh
cd <repo> && bun run build
cd /tmp/hf-longform
node <repo>/packages/cli/dist/cli.js render a-single --fps 30 -w 1 --quality draft -o a-single/renders/out.mp4
```

Check duration: `ffprobe -v error -show_entries format=duration -of csv=p=0 a-single/renders/out.mp4` → `300.000000`.

Never run two of these concurrently on a dev Mac — the fleet limit is why the gates are sequential.

## Gates by phase

| Phase | Command                                                   | Expect                                                                                          |
| ----- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0     | `render a-single --fps 30 -w 1` (stock env)               | log `streaming-encode gate {"enabled":true,"reason":"single_worker",...}`; output 300.000 s     |
| 1     | `render a-single --fps 30 -w 4` (stock env, Linux BeginFrame) | log `Parallel screenshot capture will stream to the encoder`; work dir < 2 GB; output 300.000 s. On macOS/Windows the default holds this back — stock `-w 4` must fail the disk preflight, and `HF_CAPTURE_PARALLEL_STREAM=true` must then route it (`reason: parallel_forced`) |
| 2a    | `HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 render a-single --fps 30 -w 1` | log `Segmented capture complete: 6 segment(s)`; output 300.000 s and exactly 9000 frames; no per-frame PSNR dip at a segment boundary (see below) |
| 2b    | kill the 2a render at ~40 %, rerun with `--resume`        | log `resuming: N segments complete` + N × `segment skipped (resume)`; output byte-identical to an uninterrupted run; the segment dir is gone afterwards unless `--keep-segments` |
| 2c    | 2a with `HF_SEGMENT_BROWSER_RECYCLE=1`                    | `segment browser recycled (cadence)` once per segment **after the first** (5 for 6 segments), each carrying the session's `rendererRssPeakMb`; output byte-identical to the single-session render |
| 2d    | 2a with `-w 3`                                            | `Segmented capture complete: 6 segment(s)`; output 300.000 s, 9000 frames, byte-identical to the `-w 1` segmented render |
| 1b (R3) | PRINFRA-694 fixture below: `HF_CAPTURE_PARALLEL_STREAM=true render inflow --fps 10 -w 2` | every frame of clip B (t ≥ 10 s) has mean luma ≥ 64; `-w 2` on `hyperframes@0.8.35` must fail this check (positive control) |

The Phase 0 mutation check is the same render with `PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED=true`: the gate line must flip to `"enabled":false,"reason":"duration_cap"` and the render must fail at the disk preflight on a host without ~75 GB free.

### Interrupting the 2b run

Kill on the manifest, not on a log line — the manifest is the resume contract:

```sh
HF_SEGMENTED_CAPTURE=true HF_SEGMENT_FRAMES=1500 node <repo>/packages/cli/dist/cli.js \
  render a-single --fps 30 -w 1 --quality draft -o a-single/renders/resumed.mp4 & RPID=$!
until [ "$(python3 -c "import json,glob;f=glob.glob('a-single/renders/.hf-segments/*/segments.json');print(len(json.load(open(f[0]))['completed']) if f else 0)")" -ge 2 ]; do sleep 1; done
kill -9 $RPID
```

A kill mid-segment leaves a tiny partial `segment_0000N.mp4` that is NOT in the
manifest — resume must re-capture it. Measured 2026-09-17: killed at 2 of 6,
resume logged `resuming: 2 segments complete`, finished in 3 m 32 s against
5 m 13 s uninterrupted, and the output was byte-identical to the full render
(whole file, not just the video stream).

Verify byte-identity:

```sh
cmp full.mp4 resumed.mp4 && echo BYTE_IDENTICAL
# if only container metadata differs, compare the video stream instead:
ffmpeg -v error -i full.mp4 -map 0:v -c copy -f md5 -
```

This gate is also the only check on the CLI flag wiring: `--resume` and
`--keep-segments` cross plan → options → request → config, and a dropped
hand-off there silently renders without resuming.

PSNR between two renders:

```sh
ffmpeg -i a.mp4 -i b.mp4 -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*'
```

### Reading the segmented-capture PSNR

The average against a single-encoder reference is **not** the criterion, and the
spec's "≥ 45 dB" reads as a failure when nothing is wrong. Two independent CRF
encodes of identical frames differ anyway, and segmented capture additionally
forces a closed GOP with scene-cut detection off, which costs roughly another
dB. Measured 2026-09-17 on the 300 s fixture: average 44.4 dB, median 44.3,
minimum 42.97, frame count and duration both exact.

What actually detects a boundary defect is the per-frame series, so compare
that instead:

```sh
ffmpeg -i ref.mp4 -i phase2a.mp4 -lavfi "[0:v][1:v]psnr=stats_file=/tmp/psnr.log" -f null -
grep -oE 'n:[0-9]+ .*psnr_avg:[0-9.inf]+' /tmp/psnr.log | sort -t: -k5 -n | head
```

Healthy output has its **highest** PSNR at the boundary frames — they are
forced IDRs, so they encode more faithfully than their neighbours (measured
48–62 dB at n = 1501, 3001, 4501, 6001, 7501 with `HF_SEGMENT_FRAMES=1500`).
A dip at exactly those indices is the failure this gate is looking for.

### What the 2c gate is really testing

That a browser restart is invisible in the output. Measured 2026-09-17 with
`HF_SEGMENT_BROWSER_RECYCLE=1`: byte-identical to the single-session render,
5 m 18 s against 5 m 13 s, so five browser launches cost about five seconds.
Each recycle logged `rendererRssPeakMb` between 1426 and 1470 — a session's
renderer reaches ~1.4 GB per 1500-frame segment and the restart returns it,
which is the whole reason the cadence exists.

Determinism across restarts is also what makes the 2c retry safe: a segment
re-captured on a fresh session is indistinguishable from one that never
failed.

### What the 2d gate is really testing

That the worker count is invisible in the output. Measured 2026-09-17 with
`-w 3`: byte-identical to the single-worker segmented render, 3 m 14 s against
5 m 13 s (1.6x). Segments finish out of order, so a mismatch here would mean
the concat list had picked up completion order.

Do not run more than 3 Chrome fleets at once on a dev Mac (vault: kernel-panic
history) — that is why this gate is `-w 3` and not `-w 4`.

With the default recycle cadence of 3 and 6 segments over 3 workers, each
worker only captures 2 segments, so no `segment browser recycled` line appears
in this gate. Combine with `HF_SEGMENT_BROWSER_RECYCLE=1` to exercise both.

### Known cost: segmented capture is slower

The segmented stage runs the plain `captureFrameToBuffer` loop, while the
single-encoder streaming stage uses the depth-2 worker-encode pipeline when the
session supports it. On the 300 s fixture that is 5 m 16 s segmented vs 2 m 43 s
streaming (both drawElement capture). Segmentation buys bounded scratch,
resumability and blast radius, not speed; threading the worker-encode loop
through the segmented stage is the follow-up that would close the gap.

### Known cost: a narrower retry surface than plain streaming

Segmented capture retries one thing: a Chrome target loss, once, on a fresh
session (Phase 2c). It has no orchestrator-level fallback. A drawElement
self-verify miss, a sequential stall, an encoder failure on a segment after the
first, or a concat failure ends the render, where the plain streaming path would
have re-run it on a fresh screenshot session. Opting a specific composition into
`HF_SEGMENTED_CAPTURE=true` therefore trades some resilience for the bounded
scratch and resume. Wiring the streaming path's failure classification into the
segmented branch is the other follow-up before the R4 flip.

### Operational note: `--resume` state lives in the project directory

Segments are written to `<project>/renders/.hf-segments/<planHash>/` rather than
the ephemeral work directory, and they are deliberately left in place after a
failed render because that is what `--resume` reads. A project that iterates on
a long render grows by one segment directory per distinct plan hash until a run
succeeds without `--keep-segments`, which removes its own hash directory. Stale
hash directories from earlier settings are not swept.

## PRINFRA-694 gate for the R3 flip

R3 turns the interleaved parallel-stream router on for screenshot capture, so
every non-first worker captures frames its session did not start at. PRINFRA-694
was exactly that shape on the disk path: a root-level `<video>` laid out in
normal document flow (no authored `position`) rendered solid black for its whole
active window whenever a worker other than the first captured it. This gate
checks the streaming route against the same fixture, with a positive control
that proves the check detects the defect.

Fixture: a 20 s root with two sequential 10 s in-flow clips at 640×360 / 10 fps.
Clip B is flat gray (mean luma 188) so a black frame (mean luma 16) cannot be
mistaken for content.

```sh
mkdir -p /tmp/hf-694-gate/inflow && cd /tmp/hf-694-gate/inflow
ffmpeg -v error -y -f lavfi -i "testsrc2=size=640x360:rate=10" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -t 10 -c:v libx264 -preset ultrafast -crf 20 -g 10 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart a.mp4
ffmpeg -v error -y -f lavfi -i "color=c=0xC8C8C8:size=640x360:rate=10" -f lavfi -i "sine=frequency=660:sample_rate=48000" \
  -t 10 -c:v libx264 -preset ultrafast -crf 20 -g 10 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart b.mp4
cat > index.html <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}#root{position:relative;width:640px;height:360px;overflow:hidden;background:#000}video{display:block;width:100%;height:100%;object-fit:cover}</style></head><body>
<div id="root" data-composition-id="root" data-width="640" data-height="360" data-start="0" data-duration="20" data-no-timeline>
<video class="clip" id="a" src="a.mp4" data-start="0" data-duration="10" data-media-start="0" data-has-audio="true"></video>
<video class="clip" id="b" src="b.mp4" data-start="10" data-duration="10" data-media-start="0" data-has-audio="true"></video>
</div></body></html>
HTML
echo '{"name":"inflow","fps":10,"width":640,"height":360}' > hyperframes.json
cd .. && HF_CAPTURE_PARALLEL_STREAM=true node <repo>/packages/cli/dist/cli.js render inflow --fps 10 -w 2 -o inflow/renders/w2-stream.mp4
```

The check is the per-frame mean luma over clip B's window:

```sh
ffprobe -v error -f lavfi -i "movie=inflow/renders/w2-stream.mp4,signalstats" \
  -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG -of csv=p=0 \
  | awk -F, '$1>=10{n++; if($2<64)b++} END{printf "clip B: %d of %d frames black\n", b, n}'
```

Measured 2026-09-18 on macOS (every worker's session logged
`[initSession:screenshot]`, which is the R3 cohort):

| Render                                                            | clip B black frames |
| ----------------------------------------------------------------- | ------------------- |
| this branch, `-w 1` (single-worker streaming)                     | 0 / 100             |
| this branch, `-w 2` stock (multi-worker disk path)                | 0 / 100             |
| this branch, `-w 2` + `HF_CAPTURE_PARALLEL_STREAM=true` (R3 route) | 0 / 100             |
| this branch, same but `position:absolute; inset:0` on the clips   | 0 / 100             |
| published `hyperframes@0.8.44`, `-w 2`                            | 0 / 100             |
| `hyperframes@0.8.35` and `0.8.36`, `-w 2` (positive control)      | **99 / 100**        |
| `hyperframes@0.8.37`, `-w 2`                                      | 0 / 100             |

So the defect is real, the check catches it, and it was fixed in 0.8.37 by
#3893 (`fix(core): un-hide a later root-level clip instead of leaving it
display:none forever`): a root-level clip with no authored `position` was hidden
with `display:none` while inactive and the un-hide check later disagreed with
the hide check. The streaming route inherits that fix because it is a runtime
fix, not a capture-path one. What this gate guards going forward is a
regression of that runtime behaviour under the route R3 makes the default. Run
it before flipping R3; a positive control on an old version is a one-liner:

```sh
npm install --prefix /tmp/hf835 hyperframes@0.8.35
node /tmp/hf835/node_modules/hyperframes/bin/hyperframes.mjs render inflow --fps 10 -w 2 --quality high -o inflow/renders/r0835.mp4
```

Do not read the multi-worker `[Render:trace]` line's `"captureMode"` as the
engine's mode on older builds: with the probe session closed before capture it
fell back to `"beginframe"` on every platform. The `[initSession:<mode>]` log
prefix is the per-worker truth. This branch makes the trace fall back to the
platform rule instead.

## Fault-injection checks for the R3 hardening

Unit tests pin each guard; these four renders exercise the retry paths for real.
Fixture: the 60 s `a-single` (`DUR=60 node gen.mjs` in a scratch dir that holds
`assets/long.mp4`), 1800 frames at 1080p30, `-w 2`, one render at a time. `$RPID`
is the render's node pid; its direct children are one `ffmpeg` and one
`chrome-headless-shell` per worker.

```sh
HF_CAPTURE_PARALLEL_STREAM=true node <repo>/packages/cli/dist/cli.js render a-single --fps 30 -w 2 --quality draft -o a-single/renders/out.mp4 > out.log 2>&1 & RPID=$!
until grep -q '"phase":"capture_streaming","status":"start"' out.log; do sleep 1; done; sleep 12
kill -9 "$(pgrep -P $RPID -x ffmpeg | head -1)"                 # A: encoder death
kill -9 "$(pgrep -P $RPID -x chrome-headless-shell | head -1)"  # B: worker death
kill -STOP "$(pgrep -P $RPID -x chrome-headless-shell | head -1)"  # D: frozen worker (run with HF_DE_STALL_MS=5000)
wait $RPID; ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 a-single/renders/out.mp4
```

Measured 2026-09-18 on macOS (screenshot capture on every worker):

| Case | Injected at | What the log shows | Retry | Output |
| --- | --- | --- | --- | --- |
| A `kill -9` ffmpeg, `HF_CAPTURE_PARALLEL_STREAM=true` | frame ~376 | `Streaming encoder exited before frame 376 was written: [FFmpeg] …` with ffmpeg's stderr, then `streaming encoder died mid-render; retrying` | 1 worker, forceScreenshot | 1800 frames, 60.000 s |
| B `kill -9` one worker's Chrome, same route | +12 s | `Protocol error (Page.captureScreenshot): Target closed` surfaced **0.9 s** after the kill; no "stalled" anywhere | 1 worker | 1800 frames |
| C `kill -9` one worker's Chrome, `HF_DE_PARALLEL_STREAM=true` (manual opt-in) | +12 s | gate `parallel_forced`, 2 workers interleaved; `Target closed` within a second | **1 worker** (was N before the plan carried the opt-in) | 1800 frames |
| D `kill -STOP` one worker's Chrome, `HF_DE_STALL_MS=5000` | +12 s | `Parallel screenshot capture stalled: no frame progress for 5000ms (stuck at 336/1800)` — typed, labelled screenshot, not "drawElement" | 1 worker | 1800 frames |

Before this branch, A hard-failed with a bare `write EPIPE`, B and C waited out the
60 s watchdog and hard-failed as a "drawElement" stall, and D hard-failed with no
retry.

**Caveat on D.** The watchdog aborts the pool's signal and the writer at the
stall window, but the stage waits for the pool to settle before it throws, and a
`SIGSTOP`-frozen renderer cannot observe the abort: its in-flight CDP call only
returns at the protocol timeout or when the process dies. In this run the retry
started ~90 s later, when the frozen process was killed by hand. A worker that is
slow rather than frozen (the field "stuck at 0/N" shape: browsers still
initialising) observes the abort between steps and the retry starts at the
window. Closing the frozen case means force-killing worker browsers on stall in
the engine's abort path; not done.

