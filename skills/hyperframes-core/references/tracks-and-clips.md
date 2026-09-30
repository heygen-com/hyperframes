# Tracks and Clips

Clips are timed elements inside a composition. Tracks are a Studio display concept: the render never reads them.

## What is a Clip

A clip is any DOM element with `data-start` and, where required, `data-duration`. `data-track-index` is optional. Common kinds:

- **Visual `<div>` clips** — scenes, cards, overlays. Always require `data-duration`.
- **Sub-composition hosts** — `<div>` with `data-composition-src`. Always require `data-duration`.
- **Video clips** — `<video playsinline>`. With sound: `data-has-audio="true"` (the sound stays on the clip). Silent: `muted`. Duration can default to media length.
- **Audio clips** — `<audio>`. Duration can default to media length.
- **Image clips** — `<img>`. `data-duration` is optional and defaults to 3 seconds; write it only for another length.

Add `class="clip"` to authored visual clips. The runtime does not read it, but the scaffold's shared `.clip { position: absolute; inset: 0 }` rule is what gives a scene its full-frame box, Studio treats it as an edit hint, and `lint` warns without it.

## Tracks Are a Display Lane

`data-track-index` is the row a clip occupies in Studio's timeline. It is **not** read by the render, and it constrains nothing:

- **Two clips on the same track may overlap in time.** Nothing rejects it and the render is well defined: both are visible, painted in CSS order.
- **Visual layering (front/back)** is controlled by CSS `z-index`, not by track index.
- **Omitting it is fine.** The parser defaults it, and Studio then lays out one lane per clip.

A clip on track `5` is not "above" a clip on track `1`. Use CSS for layering, `data-start`/`data-duration` for sequencing.

The one place the value carries meaning: two `<audio>` elements that share a track index **and** overlap in time raise a `lint` warning (`duplicate_audio_track`), which is a useful nudge that you are about to double up a bed.

## Picking a Track Index

Purely a readability choice for whoever opens the file in Studio. Common patterns, owned by `/hyperframes-studio` (one caption track, one element kind per track).

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

Each video segment keeps its sound: the sound stays on the clip (`data-has-audio="true"`), so cutting the video cuts its sound. A separate `<audio>` is for other sound (music, voiceover, replacement audio, J/L cuts).

## Linked clips

`data-link="<id>"` marks clips that are edited as one: in Studio, moving, trimming, splitting or deleting one member does the same to the others. Detach audio in Studio produces a pair, a muted `<video>` and an `<audio>` over the same file:

```html
<video
  id="talk"
  src="talk.mp4"
  muted
  data-link="lk-1"
  data-sync-origin="lk-1"
  data-start="2"
  data-duration="6"
  data-media-start="1"
  data-track-index="0"
></video>
<audio
  id="talk-audio"
  src="talk.mp4"
  data-link="lk-1"
  data-sync-origin="lk-1"
  data-start="2"
  data-duration="6"
  data-media-start="1"
  data-track-index="2"
></audio>
```

- **Keep members in sync.** Every member needs the same `data-start`, `data-duration`, `data-media-start` (absent = 0) and `data-playback-rate` (absent = 1). Track index, volume, fades and FX may differ. When you retime one member by hand, retime all of them, or `lint` warns `linked_clips_out_of_sync`.
- **Unlink** by removing `data-link` from every member. Removing it from one leaves the other alone with the id, which `lint` flags as `linked_clip_orphan`.
- The render ignores `data-link`: an out-of-sync pair still plays exactly what its timings say.
- Prefer a single `<video data-has-audio="true">` for footage with sound. Link only when the sound needs its own clip (its own track, volume or FX); to undo a detach, move the audio attributes back onto the video and delete the `<audio>`.
- **Sync origin.** `data-sync-origin="<id>"` marks a video and an audio from one source file; Detach and Link write it, and Unlink keeps it. When the pair drifts (their source-zero points, `data-start − data-media-start / data-playback-rate`, differ), Studio shows a red offset in frames on both halves with Move into Sync / Slip into Sync, `hyperframes timeline` prints `out-of-sync=±Nf`, and the SDK offers `syncOffset`, `moveIntoSync` and `slipIntoSync`. Leave it alone when retiming by hand; remove it only when the clips are no longer one source.
- `@hyperframes/sdk` `setTiming` applies to link partners by default; pass `{ linked: false }` to edit one member, which unlinks it.

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
