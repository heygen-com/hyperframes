# Sequencing translation: Sequence, Series, Composition root

How Remotion's nested `Sequence` tree maps to HF's flat `data-start` /
`data-duration` markup with a single paused GSAP timeline.

## The core idea

Remotion's `<Sequence from={F} durationInFrames={D}>` is a coordinate
transform: it shifts `useCurrentFrame()` by `F` and clips the child
component to the window `[F, F+D]`. HF doesn't have a per-element
"current frame" — there's a single composition seek time and the
runtime hides/shows elements based on their `data-start` / `data-duration`.

Result: the nested tree flattens into a list of siblings on the same
parent, each with their own time window.

## `<Composition>` → root `#stage`

```tsx
<Composition
  id="MyVideo"
  component={MyVideo}
  durationInFrames={300}
  fps={30}
  width={1280}
  height={720}
/>
```

```html
<div
  id="stage"
  data-composition-id="MyVideo"
  data-start="0"
  data-duration="10"      <!-- 300/30 -->
  data-fps="30"
  data-width="1280"
  data-height="720"
>
  <!-- composition content -->
</div>
```

`data-start="0"` is required on `#stage` (the runtime needs it to anchor
playback; missing it triggers a lint warning).

## `<AbsoluteFill>` → positioned div

```tsx
<AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>...children...</AbsoluteFill>
```

```html
<div style="position:absolute;inset:0;background-color:#0a0a0a;">...children...</div>
```

`AbsoluteFill` is just a styled div in Remotion. Translate to a div with
`position:absolute; inset:0` and copy through any other style props.

## `<Sequence>` → time-windowed div

```tsx
<Sequence from={0} durationInFrames={90}>
  <TitleCard />
</Sequence>
```

```html
<div data-start="0" data-duration="3" data-track-index="0">
  <!-- TitleCard children inlined -->
</div>
```

Convert frames to seconds: `from/fps`, `durationInFrames/fps`. Pick a
`data-track-index` per parallel rendering layer (background = 0,
overlays = 1, audio = 2, etc.). Sequential scenes can share an index.

## Nested `<Sequence>` flattens

Remotion adds offsets when sequences nest:

```tsx
<Sequence from={60} durationInFrames={120}>
  <Sequence from={30} durationInFrames={60}>
    <ImageScene />
  </Sequence>
</Sequence>
```

The inner sequence's effective window is `[60+30, 60+30+60] = [90, 150]`.

Translate by computing the sum and emitting one HF div with the resolved
window:

```html
<div data-start="3" data-duration="2" data-track-index="0">
  <!-- ImageScene children -->
</div>
```

## `<Series>` → siblings with sequential offsets

```tsx
<Series>
  <Series.Sequence durationInFrames={60}>
    <A />
  </Series.Sequence>
  <Series.Sequence durationInFrames={120}>
    <B />
  </Series.Sequence>
  <Series.Sequence durationInFrames={90}>
    <C />
  </Series.Sequence>
</Series>
```

Each `Sequence.Sequence` lives in the next time slot. Emit siblings
with `data-start` accumulating:

```html
<div data-start="0" data-duration="2" data-track-index="0">A</div>
<div data-start="2" data-duration="4" data-track-index="0">B</div>
<div data-start="6" data-duration="3" data-track-index="0">C</div>
```

## Crossfading scene boundaries

Remotion `<Sequence>` shows/hides at hard boundaries by default. HF does
the same — but if your composition needs a smooth fade between scenes,
you have to drive opacity explicitly with GSAP at the boundary:

```js
const tl = gsap.timeline({ paused: true });
tl.set(scene1, { opacity: 1 }, 0);
tl.set(scene1, { opacity: 0 }, 2); // hard cut at 2s
tl.set(scene2, { opacity: 1 }, 2);
```

For a 0.5 s crossfade:

```js
tl.to(scene1, { opacity: 0, duration: 0.5 }, 1.5);
tl.to(scene2, { opacity: 1, duration: 0.5 }, 1.5);
```

For Remotion `<TransitionSeries>` translations see [transitions.md](transitions.md).

## `<Loop>`

```tsx
<Loop durationInFrames={30}>
  <Spinner />
</Loop>
```

HF doesn't have a `<Loop>` primitive. Translate it to a bounded GSAP timeline using
the time available at its insertion point:

```js
const cycleDuration = 1;
const availableDuration = compositionDuration - 3;
const repeat = Math.max(0, Math.floor(availableDuration / cycleDuration) - 1);
const spinTl = gsap.timeline({ paused: true, repeat, repeatRefresh: false });
spinTl.to(spinner, { rotate: 360, duration: 1.0, ease: "none" });
// Embed in the main composition timeline at the right offset:
mainTl.add(spinTl, 3);
```

This is fragile — Remotion's `<Loop>` resets internal state every iteration,
which GSAP repeat does too, but if the looped child has its own animation,
you need to be careful that GSAP's `repeatRefresh` is on or off as needed.
The finite count is required because HyperFrames seeks a bounded composition frame-by-frame.

## `<Freeze>`

```tsx
<Freeze frame={30}>
  <Animated />
</Freeze>
```

Drop the wrapper. `<Freeze>` pins `useCurrentFrame()` at a constant for
the children — but in HF, the children's animation is already driven by
explicit GSAP tweens, so freeze translates to "don't tween this element".

## Multiple parallel tracks

When you have a background video + overlay text + audio playing
simultaneously, use distinct `data-track-index` values:

```html
<div data-track-index="0">background video</div>
<div data-track-index="1">overlay text</div>
<audio data-track-index="2" ...></audio>
```

The runtime picks track ordering from the index. See [media.md](media.md)
for media-specific track conventions.
