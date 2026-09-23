# Composition Patterns

## Contents

- Picture-in-picture
- Text behind subject
- Title card with fade
- Slide show with section headers
- Top-level composition example

## Picture-in-Picture (Video in a Frame)

Animate a wrapper div for position/size. The video fills the wrapper. The wrapper has NO data attributes.

```html
<div
  id="pip-frame"
  style="position:absolute;top:0;left:0;width:1920px;height:1080px;z-index:50;overflow:hidden;"
>
  <video
    id="el-video"
    data-start="0"
    data-duration="60"
    data-track-index="0"
    src="talking-head.mp4"
    muted
    playsinline
  ></video>
</div>
```

```js
tl.to(
  "#pip-frame",
  { top: 700, left: 1360, width: 500, height: 280, borderRadius: 16, duration: 1 },
  10,
);
tl.to("#pip-frame", { left: 40, duration: 0.6 }, 30);
```

## Text Behind Subject (transparent webm overlay)

Put a headline _behind_ a presenter so their silhouette occludes the text. Requires a transparent cutout produced by `npx hyperframes remove-background presenter.mp4 -o presenter.webm`.

Three layers, plus one critical rule:

```html
<!-- z=1 base — full opaque mp4 (lobby + presenter), always visible -->
<video
  id="cf-base"
  data-start="0"
  data-duration="6"
  data-media-start="0"
  data-track-index="0"
  src="presenter.mp4"
  muted
  playsinline
></video>

<!-- z=2 headline — visible the whole time -->
<h1
  id="cf-headline"
  style="position:absolute;top:50%;left:50%;
     transform:translate(-50%,-50%); z-index:2; font-size:220px; font-weight:900;
     color:#fff; text-shadow:0 6px 32px rgba(0,0,0,.55); clip-path:inset(0 0 100% 0);"
>
  MAKE IT IN HYPERFRAMES
</h1>

<!-- z=3 cutout — same source, alpha around presenter, hidden until the cut -->
<!-- WRAPPER has the opacity, NOT the video itself (see rule below). -->
<div class="cutout-wrap" style="position:absolute;inset:0;z-index:3;opacity:0">
  <video
    id="cf-cutout"
    data-start="0"
    data-duration="6"
    data-media-start="0"
    data-track-index="1"
    src="presenter.webm"
    muted
    playsinline
  ></video>
</div>
```

```js
const tl = gsap.timeline({ paused: true });
const CUT = 3.3;

// Reveal headline early
tl.to("#cf-headline", { clipPath: "inset(0 0 0% 0)", duration: 0.6, ease: "expo.out" }, 0.25);

// At the cut, flip the cutout wrapper visible — the presenter's silhouette
// punches through the headline.
tl.set(".cutout-wrap", { opacity: 1 }, CUT);

// Sentinel: extend timeline to the composition's full duration so the
// renderer doesn't bail past the last meaningful tween.
tl.set({}, {}, 6);

window.__timelines["cover-flip"] = tl;
```

**Why a wrapper div, not opacity on the video itself?**

The framework forces `opacity: 1` on any element with `data-start`/`data-duration` while it's "active" — that's how it manages clip lifecycles. A CSS `opacity: 0` on the video element is silently overwritten. Wrap the video in a div with no `data-*` attributes; the wrapper is owned by your CSS/GSAP.

**Why both videos at `data-start="0"`?**

So both decode in sync from t=0. Late-mounting the cutout (`data-start=3.3`) makes Chrome do a seek + decoder warm-up at mount, which can land a frame off the base mp4 — visible as a one-frame jitter at the cut.

**Color match:** `remove-background` defaults to `--quality balanced` (crf 18) which keeps the cutout's RGB nearly identical to the source mp4 — minimal edge halo or color shift when overlaid. Use `--quality best` (crf 12) for hero shots; only drop to `--quality fast` (crf 30) when the cutout sits over a _different_ background and the size matters.

## Title Card with Fade

```html
<div
  id="title-card"
  data-start="0"
  data-duration="5"
  data-track-index="5"
  style="display:flex;align-items:center;justify-content:center;background:#111;z-index:60;"
>
  <h1 style="font-size:64px;color:#fff;opacity:0;">My Video Title</h1>
</div>
```

```js
tl.to("#title-card h1", { opacity: 1, duration: 0.6 }, 0.3);
tl.to("#title-card", { opacity: 0, duration: 0.5 }, 4);
```

## Slide Show with Section Headers

Each slide is its own sub-composition file, hosted on the same track with its own time range. Slides auto-mount/unmount based on `data-start`/`data-duration`.

```html
<div
  data-composition-id="slide-1"
  data-composition-src="compositions/slide-1.html"
  data-start="0"
  data-duration="30"
  data-track-index="3"
></div>
<div
  data-composition-id="slide-2"
  data-composition-src="compositions/slide-2.html"
  data-start="30"
  data-duration="25"
  data-track-index="3"
></div>
<div
  data-composition-id="slide-3"
  data-composition-src="compositions/slide-3.html"
  data-start="55"
  data-duration="20"
  data-track-index="3"
></div>
```

## Top-Level Composition Example

```html
<div
  id="comp-1"
  data-composition-id="my-video"
  data-start="0"
  data-duration="60"
  data-width="1920"
  data-height="1080"
>
  <!-- Primitive clips -->
  <video
    id="el-1"
    data-start="0"
    data-duration="10"
    data-track-index="0"
    src="..."
    muted
    playsinline
  ></video>
  <video
    id="el-2"
    data-start="el-1"
    data-duration="8"
    data-track-index="0"
    src="..."
    muted
    playsinline
  ></video>
  <img id="el-3" data-start="5" data-duration="4" data-track-index="1" src="..." />
  <audio id="el-4" data-start="0" data-duration="30" data-track-index="2" src="..." />

  <!-- Sub-compositions loaded from files -->
  <div
    id="el-5"
    data-composition-id="intro-anim"
    data-composition-src="compositions/intro-anim.html"
    data-start="0"
    data-duration="5"
    data-track-index="3"
  ></div>

  <div
    id="el-6"
    data-composition-id="captions"
    data-composition-src="compositions/caption-overlay.html"
    data-start="0"
    data-duration="60"
    data-track-index="4"
  ></div>

  <script>
    // Just register the timeline — framework auto-nests sub-compositions
    const tl = gsap.timeline({ paused: true });
    window.__timelines["my-video"] = tl;
  </script>
</div>
```
