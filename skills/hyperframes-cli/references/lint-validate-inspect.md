# lint, check, snapshot

Use `lint` for fast static feedback while iterating. Use `check` as the required final gate: it reruns the same linter, then audits runtime, layout, motion, and contrast in one browser session. Do not chain a redundant standalone `lint` immediately before `check`. `snapshot` is the standalone utility for capturing still frames and zoomed crops. `validate`, `inspect`, and `layout` still run but are deprecated: `check` covers all of them in one invocation.

## Discipline (motion-heavy work)

When the composition is animation-driven, run the checks before you reach for `preview` or `render`:

- Run `lint` after the first HTML pass for early feedback. It is an iteration aid, not a separate final gate.
- Run `check --snapshots` at the first full pass: the overview frames and per-finding crops show you what the auditor saw.
- Look at the PNGs before tuning automated warnings: your eye catches what the auditor misses, and the auditor catches what your eye misses.
- Treat layout errors as defects unless a snapshot proves the layering is intentional, in which case mark it with `data-layout-allow-overflow` / `data-layout-allow-overlap` / `data-layout-allow-occlusion` / `data-layout-allow-caption-zone` (caption band only).
- State motion intent in a `*.motion.json` sidecar so `check` verifies it automatically (entrances firing under seek, stagger order, in-frame, liveness). This is the closest automated proxy for "watch the MP4" and catches render-vs-preview bugs the eye misses (see **Motion verification** below).

## lint

```bash
npx hyperframes lint                  # current directory
npx hyperframes lint ./my-project     # specific project
npx hyperframes lint --verbose        # info-level findings
npx hyperframes lint --json           # machine-readable
```

Lints `index.html` and all files in `compositions/`. Reports errors (must fix), warnings (should fix), and info (with `--verbose`). Catches missing `data-composition-id`, overlapping tracks on the same `data-track-index`, unregistered timelines, and GSAP/CSS transform conflicts.

`<video>`/`<audio>` work at any nesting depth, including inside a `compositions/*.html` sub-composition or a wrapper `<div>`: the runtime discovers media with a flat DOM query and seeks/decodes it wherever it lives (`packages/core/src/runtime/{media,startResolver}.ts`). After a render, `snapshot` each scene that has a video and confirm the panel actually shows footage (a blank/black panel where a clip should play is a real bug, not a placeholder).

## check

```bash
npx hyperframes check                    # current directory: the full browser gate
npx hyperframes check ./my-project       # specific project
npx hyperframes check --json             # agent-readable envelope {ok, browserSkipped, lint, runtime, layout, motion, contrast, craft, hdr, snapshots}
npx hyperframes check --snapshots        # also write overview frames (annotated) + per-finding crops
npx hyperframes check --samples 15       # denser timeline sweep (default 9)
npx hyperframes check --at 1.5,4,7.25    # explicit hero-frame timestamps
npx hyperframes check --at-transitions   # also sample every tween start/end boundary
npx hyperframes check --tolerance 4      # allowed overflow px before reporting (default 2)
npx hyperframes check --timeout 30000    # initial render-ready + navigation minimum in ms (defaults: 3000 / 10000)
npx hyperframes check --no-contrast      # skip the WCAG audit while iterating
npx hyperframes check --strict           # exit non-zero on warnings too (default: only errors)
```

One command, one Chrome boot. `check` runs the linter first and skips the browser entirely when lint reports errors. When the browser never ran (lint errors, a linter crash, or a browser launch failure), `browserSkipped` is `true` and the `layout`, `motion` and `contrast` sections are empty, not clean. Otherwise it loads the bundled composition once, wires runtime listeners before navigation, and sweeps one seek grid running every audit per sample:

- **Runtime**: JavaScript console errors, unhandled exceptions, failed network requests (media-file `ERR_ABORTED` filtered out), HTTP 4xx/5xx.
- **Layout**: text extending outside its container or the canvas, text clipped by its own box, held text overlaps and occlusion (with an approximate covered fraction), an opaque element covering the canvas above every other clip for most of the film (`canvas_covered`, naming it), children escaping clipping containers. Text under a transparent `<video>` (a `remove-background` cutout) is measured per word against the frame's alpha: partial cover is info with the share hidden, a word 80% hidden or two neighbouring words each half hidden is an error, and a frame that cannot be read falls back to opaque with a `video_alpha_unread` note.
- **Motion**: `*.motion.json` sidecar assertions against the same seeked timeline (see below).
- **Contrast**: WCAG AA on visible text, sampled at 5 grid points. Failures are **errors** and each finding carries the sampled fg/bg colors, measured vs required ratio, and a suggested compliant color in the same palette direction, so most contrast fixes need no screenshot at all.
- **Craft**: warnings only, even under `--strict` (a film may break one on purpose), measured on an 8 fps sweep of the whole film and skipped under `--range`. Each message names the fix and the reference to read.
  - `line_unread`: a reading-size line (≥ 30 px tall at 1080) on screen under its floor: 0.4 s for 1–2 words, otherwise ¾ of 0.5 s + 0.3 s a word (3 words 1.05 s, 6 words 1.73 s); the film's last line needs 2 s. Edges are re-measured to ~0.01 s. Captions-track text and `data-layout-ignore` are exempt.
  - `dead_stretch`: more than 3 s where the `keepsMoving` classifier sees nothing change. The final 3 s and any time a `data-hold` element is on screen are exempt; it stays quiet when `sweep_static` fires or a whole-composition `keepsMoving` assertion sets the limit.
  - `text_below_floor`: text under 2.6% of the frame's short side (28 px on 1080) held 0.5 s or more, one finding per file listing every element.
  - `first_frame_empty`: frame 0 paints nothing but the background (no text, image, video, canvas or svg), or an opaque element covers every other clip and the message names it; it is the thumbnail on social players.
  - `film_silent`: a film over 15 s with no unmuted `<audio>` or audible `<video>`.
- **Audio**: the clips the render mixes, in the report's `audio` section. It runs even when lint stops the browser pass. Remote sources are not fetched.
  - `audio_source_unreadable` (error): the file cannot be read as audio, so the render's mix fails and the render stops. Point `src` at a file with an audio track, or re-export it.
  - `audio_source_rejected` (error): the file has no audio track, so render stops before it starts. Point `src` at a file with audio, or remove `data-has-audio="true"` from a `<video>`.
  - `audio_starts_past_source_end` (warning): `data-media-start` is at or past the file's length, so the clip plays nothing. Lower `data-media-start` below the length.
  - `audio_clip_silent` (warning): the file is silent for the whole part the clip plays. Check the file has sound there, or move `data-media-start` to where it does.
  - `audio_none` (info): no clip plays audio and no unmuted `<video>` has an audio track. Fine for a silent film; otherwise add the `<audio>`.
  - `audio_check_unavailable` (info): the audio check itself failed (the message says why), so the clips were not checked. Re-run; if it repeats, run `hyperframes doctor`.
  - `audio_src_not_found` (error, from `lint`): an `<audio src>` names a file not in the project, so the render is silent. Add the file or fix the path.
  - Cost: each media probe (the audio metadata render uses, and render's media-type rule) runs at most once per file; whether a `<video>` has sound is probed on each use. The check runs alongside the browser pass, up to four files at a time. A clip longer than 3 s is first sampled at three 1-second spots and decoded in full only if all three are silent.

Every finding carries a selector, the element's `data-*` identity, the composition source file, a bbox, and the sample time: jump straight from the JSON to the HTML you must edit and re-run.

**Severity is persistence-aware.** A dynamic issue observed at a single grid sample (an entrance/exit transient) demotes to info and never gates. Issues held across samples gate the exit code, a held `content_overlap` is an error, and a held, partially-visible `canvas_overflow` breaching ≥5% of the canvas promotes to warning. Coordinate-frame findings (`escaped_container`, `panel_out_of_canvas`, `connector_detached`) flag geometry computed in one frame but rendered in another — an element far outside its offset parent, a painted panel stuck across the canvas edge, a connector line detached from every node. Text drawn into a `<canvas>` has no DOM box, so `canvas_overflow` cannot see it; `canvas_content_at_edge` warns when a canvas's pixels show sharp content (drawn text, hard shapes) along the frame edge — mark intentional full-bleed art (particles, photos) with `data-layout-allow-overflow`. If a 3s+ composition shows no visible change across every sample, `check` fails with `sweep_static`: a frame that never changes while a GSAP timeline or tween, or a CSS or Web animation, holds the same time without ever finishing means the seek is not driving the page, so it refuses to pass. Any other frame that never changes (a still title card, an audio-only advance) is a warning that `--strict` fails; a composition meant to be still can take `data-no-timeline` on its root to skip it. The fingerprint includes per-element opacity, so opacity-only reveals (code typing, staggered fades) count as motion — but only while they're still in flight at the sampled times. The classic trap is a reveal that completes early and then holds a static frame for the rest of the duration: every sample lands on the settled state and check warns that nothing on screen moved (`--strict` fails it). Spread the reveal across the timeline or give the hold a real next action (the cursor heading to the next control, the camera's next move); don't bolt on a slow drift, a blinking caret or a loop just to appease the check.

**Escape hatches** (mark intent in the HTML, then re-run):

- `data-layout-allow-overflow` — overflow is intentional (entrance/exit travel).
- `data-layout-allow-overlap` — deliberate text layering (e.g. a demo cursor label over a heading). Applies only to the marked text block; it is not inherited. Mark the specific layering participant, never a scene/root wrapper, so unrelated descendant collisions remain auditable.
- `data-layout-allow-occlusion` — an element is meant to cover text.
- `data-layout-allow-caption-zone` — intentional lower-third / caption-band copy under `--caption-zone`. Applies to the marked element and every descendant (`closest`); silences only `caption_zone_collision` (not overflow/overlap/occlusion). Prefer the narrowest wrapper that owns the intentional band copy.
- `data-layout-ignore` — decorative element that should never be audited.
- `data-hold` — deliberate stillness: while this element is on screen, `dead_stretch` does not count the time.

**Opt-in pipeline gates** (used by orchestrators; off by default):

```bash
npx hyperframes check --caption-zone "x0=0;y0=.82;x1=1;y1=1;severity=error;seek=.25,1"
npx hyperframes check --frame-check     # media (img/svg/video/canvas) out-of-frame detection
```

`--caption-zone` takes fractional band geometry (`x0/y0/x1/y1` required, 0-1 fractions of the composition's own canvas, portrait included) with optional `severity` and comma-separated `seek` fractions; it flags a text element's DOM box (`getBoundingClientRect`) that overlaps the band. Waive intentional lower-third copy with `data-layout-allow-caption-zone` on the element or its nearest wrapper (see Escape hatches). `--frame-check` reports media elements breaching the canvas beyond `max(120px, 6% of the min canvas dimension)`.

**Fixing contrast errors** — thresholds are 4.5:1 for normal text, 3:1 for large text (24px+, or 19px+ bold). The finding's `suggestedColor` already picks the nearest compliant color in the right direction (brighten on dark backgrounds, darken on light); apply it or adjust within the palette family, then re-run `check`.

## Motion verification (`*.motion.json` sidecar)

`check` verifies **motion intent** against the same seeked timeline the renderer uses — the closest automated proxy for "render the MP4 and watch it". It catches render-vs-preview bugs layout sampling can't: an entrance reveal the seek lands past, a broken stagger order, an element drifting off-frame mid-tween, a frozen shot.

Drop a `*.motion.json` sidecar next to the composition (matching the html basename when several compositions share a dir). `check` discovers it automatically — no flag, no authoring-framework changes. With no sidecar, `check` behaves exactly as before.

```json
{
  "duration": 6,
  "assertions": [
    { "kind": "appearsBy", "selector": "#headline", "bySec": 0.5 },
    { "kind": "before", "a": "#headline", "b": "#cta" },
    { "kind": "staysInFrame", "selector": ".card" },
    { "kind": "keepsMoving", "withinSelector": ".scene" }
  ]
}
```

| Assertion                      | Fails (code) when                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `appearsBy(selector, bySec)`   | not visible (opacity ≥ 0.5) by `bySec` — `motion_appears_late`                                                              |
| `before(a, b)`                 | `a` does not first appear strictly before `b` — `motion_out_of_order`                                                       |
| `staysInFrame(selector)`       | once visible, its box leaves the canvas — `motion_off_frame`                                                                |
| `keepsMoving(withinSelector?)` | a fully-static window exceeds `maxStaticSec` (default 2s); the film's final 3 s (an end card) never count — `motion_frozen` |

`duration`, `withinSelector`, and `maxStaticSec` are optional. Findings are **errors by default** and appear in the same human and `--json` output as layout findings. A selector that matches nothing is reported as `motion_selector_missing` rather than silently passing — a typo'd selector fails loudly. Use this in the feedback loop instead of eyeballing the render: assert what the motion is supposed to do, and let `check` tell you when the seek diverges from intent.

## snapshot

```bash
npx hyperframes snapshot                       # 5 key frames as PNG
npx hyperframes snapshot ./my-project          # specific project
npx hyperframes snapshot --frames 10           # evenly-spaced N frames
npx hyperframes snapshot --range 3,5 --frames 8 # 8 frames within root-timeline seconds 3–5
npx hyperframes snapshot --composition intro --frames 8 # 8 frames within this data-composition-id
npx hyperframes snapshot --review              # beat sheet, seam strips, phone sheet
npx hyperframes snapshot --review --json       # same, with paths and times as JSON
```

Still PNGs. Each run writes `.hyperframes/artifacts/snapshots/<id>/` unless `--output` is set. `snapshot` is the standalone capture; `check --snapshots` is the gate.

One of `--at`, `--range START,END` (seconds), or `--composition <data-composition-id>` (not a CSS selector). `--frames` defaults to 5. Range and composition sample just before the end and add no extra end frame; `--at` adds one unless `--no-end`.

`--review` picks the frames that show a film over time. Scenes are the composition's top-level timed clips and sub-composition hosts, as `timeline` lists them (captions and audio excluded); `--composition` scopes to one. It writes `review-beats.jpg` (each scene at its start + 0.3 s and at its middle, and each timed `data-beat="name"` element at its start + 0.3 s, labelled with time and id), `review-seam-NN.jpg` (frames at −0.2, −0.1, 0, +0.1, +0.2 s around every cut) and `review-phone.jpg` (the beat frames 360 px wide, to judge legibility at phone size), beside the `beat-*.png` and `seam-*.png` stills. With fewer than two scenes the beats spread evenly. `--json` prints `{ok, outputDir, frames[{path,time,role,label}], contactSheets, review{window, scenes, beats, seams[{time,from,to,times,paths,sheet}], sheets, notes}}`.

### Keep verification clean and inspect the actual pixels

Inspect full-resolution frames in the opening 30 seconds, each mounted scene, and every reported problem interval. Contact sheets locate moments; use close-ups to judge thin edges, glass, particles, and WebGL geometry. Check the live preview and decoded render at matching times. Canvas shader defects can survive a successful DOM/layout audit. Record the browser/GPU and capture path when results differ across machines; isolate the failing material or pass before changing rendering defaults.

Managed snapshot storage keeps the newest 10 run folders, the newest evidence for the current revision and retained rendered revisions, and the latest snapshot. Live captures and folders younger than 24 hours are also preserved. Automatic cleanup removes whole eligible old UUID folders, including contact sheets and descriptions; arbitrary `--output` folders are untouched. Save intentional before/after evidence outside this managed storage.

For disposable checks, allocate a temporary output folder and remove that folder after inspecting it. Use `hyperframes clean --dry-run` to inspect broader cleanup. `clean --snapshots` explicitly discards snapshot evidence; use it only when that evidence is no longer needed. Never recommend removing all of `.hyperframes`, which also contains project history and other state.

### Zooming into a reported finding

`hyperframes check --snapshots` already writes a `finding-NN-<code>.png` crop for every error finding that carries a bbox, but the same zoom is available standalone once you know what to look at:

```bash
npx hyperframes check --snapshots               # reports a finding, e.g. content_overlap on "#cta"
npx hyperframes snapshot --zoom "#cta"           # crop the element to verify the defect, at 3x density
npx hyperframes snapshot --zoom "100,50,400,300" --zoom-scale 2   # or an exact pixel region
# fix the composition HTML, then re-check:
npx hyperframes check
```

`--zoom` takes a CSS selector or an exact `x,y,w,h` pixel region and always produces a real high-density crop (a raised `deviceScaleFactor`, never CSS zoom or a viewport resize), so the composition's layout — and its render determinism — is untouched. A selector matching nothing is a loud error, not a silent full-frame fallback, and a frame where the target has no visible box (collapsed or animated off-canvas) is skipped with a note instead of written as a sliver.

## Deprecated: validate, inspect, layout

All three keep working, print a deprecation notice on stderr, and mark `_meta.deprecated: true` in `--json`. Their functionality lives in `check`:

- `validate` (runtime errors + contrast) → `check` (contrast failures are now gating errors with fix payloads, not warnings).
- `inspect` / `layout` (layout sweep + motion sidecar) → `check` (same flags: `--samples`, `--at`, `--at-transitions`, `--tolerance`, `--strict`).

Migrate scripts by replacing the sequence with the single `check` invocation; scaffolded projects' `npm run check` already points there.
