# Background Removal

Make a transparent overlay (typical: a talking head over an arbitrary scene). Uses `u2net_human_seg` (MIT).

```bash
npx hyperframes remove-background subject.mp4 -o transparent.webm          # default: VP9 + alpha
npx hyperframes remove-background subject.mp4 -o transparent.mov           # ProRes 4444 (editing)
npx hyperframes remove-background portrait.jpg -o cutout.png               # single-image cutout
npx hyperframes remove-background subject.mp4 -o subject.webm \
  --background-output plate.webm                                           # both layers, one pass
npx hyperframes remove-background subject.mp4 -o transparent.webm --device cpu
npx hyperframes remove-background --info                                   # detected providers
```

## Output Format

- **`.webm` (VP9 alpha)** — default. Plug straight into `<video>` for Chrome-native transparent playback (~1 MB / 4s @ 1080p).
- **`.mov` (ProRes 4444)** — round-trip in editors (Premiere / Resolve / DaVinci). ~50 MB / 4s.
- **`.png`** — single-image cutout.

## Quality (`--quality`)

Controls VP9 encoder CRF only — segmentation quality is fixed. Higher quality keeps the cutout's RGB closer to the source MP4 (important when overlaying the cutout on its own source).

| Preset     | CRF | When                                          |
| ---------- | --- | --------------------------------------------- |
| `fast`     | 30  | Iterating, smaller files, looser color match  |
| `balanced` | 18  | **Default**; visually identical for most uses |
| `best`     | 12  | Master / final delivery, tightest color match |

## Device (`--device`)

`auto` (default) picks CoreML on Apple Silicon, CUDA when available, otherwise CPU. Force with `--device cpu | coreml | cuda`. CUDA requires `HYPERFRAMES_CUDA=1` plus a GPU-enabled `onnxruntime-node` build. Use `--info` to inspect detected providers without rendering.

## Compositing patterns — pick the right one

The cutout WebM is a **re-encoded copy** of the source MP4's RGB. What sits behind it matters.

| Pattern                                                  | Behind the cutout                       | Result                                                                                                          |
| -------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Cutout over a different scene** (most common)          | Static image, gradient, unrelated video | Looks great. Single RGB source for the subject.                                                                 |
| **Cutout over its own source mp4** (text-behind-subject) | Same mp4 the cutout came from           | At `balanced` doubling is barely visible; at `fast` you'll see color shift / edge halo. Use `best` for masters. |
| **Cutout over a different take of the same person**      | Footage of the same subject             | **Two overlapping people. Don't do this.**                                                                      |

## Text-behind-subject pattern (two non-obvious rules)

Putting a headline behind a presenter cutout:

```html
<video
  src="presenter.mp4"
  id="bg"
  data-start="0"
  data-duration="6"
  data-track-index="0"
  muted
  playsinline
></video>

<h1 id="headline" style="z-index:2; ...">MAKE IT IN HYPERFRAMES</h1>

<div class="cutout-wrap" style="position:absolute; inset:0; z-index:3; opacity:0">
  <video
    src="presenter.webm"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    muted
    playsinline
  ></video>
</div>
```

```js
// Flip the wrapper's opacity at the cut, NOT the video's
tl.set(".cutout-wrap", { opacity: 1 }, 3.3);
```

Two rules that are easy to miss:

1. **Wrap the cutout `<video>` in a non-timed `<div>` and animate the wrapper's opacity, not the video element's.** The framework forces `opacity: 1` on active clips (any element with `data-start` / `data-duration`), so animating the video's opacity directly is silently overridden. The wrapper has no `data-*` attributes, so it's owned by your CSS / GSAP.
2. **Both videos use `data-start="0"` and `data-media-start="0"`** so the framework decodes them in sync from t=0. Late-mounting the cutout (`data-start=3.3`) introduces a seek + warm-up that lands a frame off the base mp4 — visible as one frame of misalignment at the cut.

## Layer separation (`--background-output`)

Emits a **second** transparent video alongside the cutout: same source RGB, alpha is `255 - mask` instead of `mask`. The cutout has the subject opaque; the plate has the surroundings opaque (with a transparent hole where the subject was). Use it when text / graphics need to live **between** the two layers.

| File                             | Alpha is…                                               | Use it for                                                       |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `-o subject.webm`                | mask — subject opaque, background transparent           | Foreground layer (top)                                           |
| `--background-output plate.webm` | inverse mask — surroundings opaque, subject transparent | Bottom layer; place text / graphics between this and the subject |

Both share the same `--quality` and run from a single inference pass — only encode cost roughly doubles. Only valid for video inputs with `.webm` / `.mov` outputs.

**Hole-cut, not inpainted.** The subject region in `plate.webm` is fully transparent — composite something opaque under it to fill the hole.

**Single test for whether `--background-output` is the right tool:** _will anything ever be visible through the subject's silhouette where the subject used to be?_ If no, you don't need the plate — `subject.webm` alone over a different background is enough.

### Use case → right tool

| Use case                                                                            | Right tool                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Text/graphics between the cutout and the plate (this command's reason for existing) | **Hole-cut** (`--background-output`)                                               |
| Subject onto an unrelated scene                                                     | Just `subject.webm`; ignore the plate                                              |
| Show the room _without_ the person, alone over no other content                     | **Clean plate** — needs an inpainter (LaMa, ProPainter, E2FGVI). Not this command. |
| Replace the subject with a different subject                                        | **Clean plate** — same as above                                                    |

### Canonical 3-layer template (plate + content + cutout)

Ship just the two transparent layers and let arbitrary content live between them — no original mp4 needed:

```html
<!-- z=1 plate: surroundings opaque, subject silhouette transparent -->
<video
  src="plate.webm"
  data-start="0"
  data-duration="6"
  data-track-index="0"
  muted
  playsinline
></video>

<!-- z=2 your content lives between the layers -->
<h1 id="headline" style="z-index:2; ...">MAKE IT IN HYPERFRAMES</h1>

<!-- z=3 cutout floats the subject back on top -->
<div class="cutout-wrap" style="position:absolute; inset:0; z-index:3">
  <video
    src="subject.webm"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    muted
    playsinline
  ></video>
</div>
```

Functionally equivalent to the text-behind-subject pattern above, but doesn't require shipping the original mp4 — the plate replaces it. Use this when delivering just the two transparent layers as a reusable asset.

## When `remove-background` is NOT the right tool

If a user asks for "the room **without** the person, displayed standalone" (no subject anywhere, no compositing on top), `--background-output` is wrong — its plate has a transparent hole, not a filled-in clean plate. They need an **inpainter**: LaMa, ProPainter, or E2FGVI. Tell them this command can't do it.
