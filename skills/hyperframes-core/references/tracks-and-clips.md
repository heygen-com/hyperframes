# Tracks and Clips

Clips are timed children of the composition root. Tracks are a temporal-overlap concept, not a visual-stacking concept.

## What is a Clip

A clip is any DOM element with `data-start`, `data-duration` (where required), and `data-track-index`. Common kinds:

- **Visual `<div>` clips** — scenes, cards, overlays. Always require `data-duration`.
- **Sub-composition hosts** — `<div>` with `data-composition-src`. Always require `data-duration`.
- **Video clips** — `<video>` with `muted` and `playsinline`. Duration can default to media length.
- **Audio clips** — `<audio>`. Duration can default to media length.
- **Image clips** — `<img>`. Always require `data-duration`.

Add `class="clip"` to authored visual clips so tooling and examples can find them.

## Tracks Are Temporal, Not Visual

`data-track-index` controls **temporal overlap**, not paint order:

- **Two clips on the same `data-track-index`** must NOT overlap in time. `hyperframes lint` flags this.
- **Visual layering (front/back)** is controlled by CSS `z-index`, not by track index.

A clip on track `5` is not "above" a clip on track `1` — it's just on a different audio/visual lane in time. Use CSS for layering, tracks for sequencing.

## Picking a Track Index

There's no fixed convention, but common patterns:

- **Track 0** — base video (e.g. an A-roll).
- **Track 1+** — visual scenes, overlays, captions.
- **Higher tracks (e.g. 10+)** — audio clips, separated from visual tracks to keep linting clear.

When adding a new clip to an existing composition:

1. Find an existing track that has no overlap with your new clip's `[data-start, data-start + data-duration)` range.
2. Or pick a fresh track index.
3. Never overlap two clips on the same track — the linter will fail and the render is undefined.

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

Rules:

- References resolve **inside the same composition only** — cannot reach into a parent or sibling sub-composition.
- The referenced clip must have a **known duration** (explicit `data-duration` or inferred from media). Otherwise the reference cannot resolve.
- **No circular references** — `A → B → A` is rejected. Cycles are detected and error out.
- A value that parses as a number is always treated as absolute seconds. Otherwise the resolver expects `<id>`, `<id> + <number>`, or `<id> - <number>` (whitespace optional).
- References can chain (`A → B → C`). Keep chains under 3-4 levels for readability.
- Negative offsets create overlap; overlapping clips must be on **different tracks**, same-track overlap is rejected.
