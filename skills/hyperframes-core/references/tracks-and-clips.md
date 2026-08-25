# Tracks and Clips

Clips are timed elements inside a composition. Tracks are a Studio display concept: the render never reads them.

## What is a Clip

A clip is any DOM element with `data-start` and, where required, `data-duration`. `data-track-index` is optional. Common kinds:

- **Visual `<div>` clips** — scenes, cards, overlays. Always require `data-duration`.
- **Sub-composition hosts** — `<div>` with `data-composition-src`. Always require `data-duration`.
- **Video clips** — `<video>` with `muted` and `playsinline`. Duration can default to media length.
- **Audio clips** — `<audio>`. Duration can default to media length.
- **Image clips** — `<img>`. Always require `data-duration`.

Add `class="clip"` to authored visual clips. The runtime does not read it, but the scaffold's shared `.clip { position: absolute; inset: 0 }` rule is what gives a scene its full-frame box, Studio treats it as an edit hint, and `lint` warns without it.

## Tracks Are a Display Lane

`data-track-index` is the row a clip occupies in Studio's timeline. It is **not** read by the render, and it constrains nothing:

- **Two clips on the same track may overlap in time.** Nothing rejects it and the render is well defined: both are visible, painted in CSS order.
- **Visual layering (front/back)** is controlled by CSS `z-index`, not by track index.
- **Omitting it is fine.** The parser defaults it, and Studio then lays out one lane per clip.

A clip on track `5` is not "above" a clip on track `1`. Use CSS for layering, `data-start`/`data-duration` for sequencing.

The one place the value carries meaning: two `<audio>` elements that share a track index **and** overlap in time raise a `lint` warning (`duplicate_audio_track`), which is a useful nudge that you are about to double up a bed.

## Picking a Track Index

Purely a readability choice for whoever opens the file in Studio. Common patterns:

- **Track 0** — base video (e.g. an A-roll).
- **Track 1+** — visual scenes, overlays, captions.
- **Higher tracks (e.g. 10+)**: audio clips, separated from visual tracks.

When adding a clip to an existing composition, set its `data-start`/`data-duration` against the clips around it. You do not need to hunt for a free lane, and you never need to renumber tracks after a retime.

## Clip Time Inside the Composition

`data-start` is in seconds, measured from the start of the _composition_. For sub-compositions, the sub-composition's internal timeline (its own `data-duration` and child clips) runs from `data-start` to `data-start + data-duration` of the host.

`data-media-start` (on `<video>`/`<audio>`) is an offset _into the source media_. Use it to skip the first few seconds of a media file without trimming the file itself.

## Cut one source into multiple ranges

For a hard cut, trim, splice, or reorder, duplicate the same video source into
multiple clip elements. Each copy selects its source range with
`data-media-start` plus `data-duration`, and places that range on the authored
timeline with `data-start`. Change the source offsets and placement order; do
not try to keyframe source cutting.

Separately authored audio gives each audio copy the identical source range and
timing as its matching video clip (`data-media-start`, `data-duration`, and
`data-start`). Video stays muted; the separate audio elements carry sound.

## Relative Timing

`data-start` accepts a clip ID instead of a number, meaning "start when that clip ends". Add `+ N` / `- N` to offset; negative produces overlap (useful for crossfades).

```html
<video id="intro" data-start="0" data-duration="10" data-track-index="0" src="..."></video>
<video id="main" data-start="intro" data-duration="20" data-track-index="0" src="..."></video>
<video
  id="scene-a"
  data-start="intro + 2"
  data-duration="20"
  data-track-index="0"
  src="..."
></video>
<video
  id="scene-b"
  data-start="intro - 0.5"
  data-duration="20"
  data-track-index="1"
  src="..."
></video>
```

Rules, and three ways this fails **silently**. Nothing in `lint` checks any of them, so read them before you use a reference:

- **Spaces around the operator are required.** `data-start="intro - 0.5"` means "0.5s before `intro` ends". `data-start="intro-0.5"` (no spaces) is parsed as a reference to an element whose id is literally `intro-0.5`; that element does not exist, so the clip silently starts at 0.
- **An unresolved reference resolves to 0**, it does not error. A typo'd id, or a target that is not in the document, puts the clip at the start of the composition.
- **If the target has no resolvable duration, the reference lands on the target's START, not its end.** So `data-start="hero"` where `hero` has no `data-duration` and no known media length silently means "same time as `hero`" rather than "after `hero`".
- **A cycle resolves to 0** rather than erroring. `A → B → A` puts one of them at 0.
- Lookup is **document-wide** (`getElementById`, then `[data-composition-id]`). A reference can therefore reach a target in another composition on the assembled page. Keep referenced ids unique and keep the reference and its target in the same file, or the result depends on assembly order.
- A value that parses as a number is always absolute seconds. Otherwise the resolver expects `<id>`, `<id> + <number>`, or `<id> - <number>`.
- References can chain (`A → B → C`). Keep chains under 3-4 levels for readability.
- Negative offsets create overlap, which is allowed. Overlapping clips do **not** need different tracks.

Because every failure mode above is a silent 0, snapshot a reference-timed composition and check the clip actually starts where you meant.
