# Creator Editing Recipes

Use these copyable contracts after `tracks-and-clips.md`. Global math: **consumed source = timeline duration × rate**; **natural timeline duration = remaining source / rate**.

Before any edit, run `npx hyperframes timeline` (add `--json` for a machine-readable list) to see the project's tracks and clips instead of reading the HTML.

These recipes keep sound on a separate `<audio>` element with the `<video>` muted, which is the pattern to reach for when picture and sound are cut independently. An unmuted `<video>` that declares `data-has-audio="true"` is also mixed, so a separate track is a choice, not a requirement.

**Every `<video>` and `<audio>` below carries an `id`, and that is not cosmetic**: `lint` errors with `media_missing_id` on timed media without one, and an id-less `<audio>` is never picked up by the mixer, so the render comes out silent. Keep the ids when you copy a recipe.

## Hard cut

```html
<video
  id="a"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="4"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="b"
  src="take.mp4"
  data-start="2"
  data-duration="3"
  data-media-start="10"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="a-audio"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="4"
  data-track-index="10"
></audio>
<audio
  id="b-audio"
  src="take.mp4"
  data-start="2"
  data-duration="3"
  data-media-start="10"
  data-track-index="10"
></audio>
```

Timeline math: B starts at A start + duration. Source math: each range starts at `data-media-start`; consumed source = timeline duration × rate. Audio follows: duplicate matching `<audio>` ranges/timing. Owner: `/hyperframes-core`. Limit: adjacent windows only; author the two windows edge to edge. Same-track overlap is valid; both clips paint in CSS order.

## Trim in/out

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="1"
  data-duration="3"
  data-media-start="6"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="1"
  data-duration="3"
  data-media-start="6"
  data-track-index="10"
></audio>
```

Timeline math: visible window is `[1,4]`. Source math: in=6, out=6+3 at 1x; never invent source-end syntax. Audio follows: matching separate audio track uses the same three attributes. Owner: `/hyperframes-core`. Limit: use another clip for another range.

## Split / splice

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="0"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="shot-2"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="8"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="0"
  data-track-index="10"
></audio>
<audio
  id="shot-2-audio"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="8"
  data-track-index="10"
></audio>
```

Timeline math: splice at t=2. Source math: independent source offsets select kept pieces. Audio follows: split matching audio identically. Owner: `/hyperframes-core`. Limit: source cuts are core, never keyframes.

## Duplicate / reuse same source

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="1"
  data-media-start="2"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="shot-2"
  src="take.mp4"
  data-start="4"
  data-duration="1"
  data-media-start="2"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="0"
  data-duration="1"
  data-media-start="2"
  data-track-index="10"
></audio>
<audio
  id="shot-2-audio"
  src="take.mp4"
  data-start="4"
  data-duration="1"
  data-media-start="2"
  data-track-index="10"
></audio>
```

Timeline math: copies may occupy different starts. Source math: identical offsets reuse identical source. Audio follows: duplicate the separate audio track too. Owner: `/hyperframes-core`. Limit: every element needs a unique id when ids are present.

## Reorder

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="10"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="shot-2"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="2"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="10"
  data-track-index="10"
></audio>
<audio
  id="shot-2-audio"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="2"
  data-track-index="10"
></audio>
```

Timeline math: `data-start` defines authored order. Source math: source offsets need not be chronological. Audio follows: reorder identical matching audio windows. Owner: `/hyperframes-core`. Limit: reordering changes placement only, not source ranges.

## Freeze / hold

```html
<img src="held-frame.png" data-start="2" data-duration="1" data-track-index="0" class="clip" />
```

Timeline math: the still owns its hold duration. Source math: final-source frame, subcomp final state, and visual pose holds are supported. Audio follows: continue, trim, or silence audio deliberately. Owner: `/hyperframes-core` + `/media-use`. Limit: arbitrary mid-source freeze requires preprocess of a still/segment.

## Constant speed / slow motion

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="4"
  data-playback-rate="0.5"
  data-track-index="0"
  muted
  playsinline
></video>
```

Timeline math: duration is authored timeline time. Source math: consumed source = timeline duration × rate; natural timeline duration = remaining source / rate. Audio follows: matching separate audio track uses the same constant rate. Owner: `/hyperframes-core`. Limit: normalized 0.1..10. For a speed ramp put a `rate` lane in `data-automation`, e.g. `{"version":1,"lanes":[{"target":"rate","points":[{"t":0,"v":1},{"t":2,"v":4}]}]}`; it wins over the constant.

## Zoom / punch

```js
tl.to("#clip .inner", { scale: 1.35, xPercent: -8, duration: 0.18 }, 1);
```

Timeline math: tween positions are composition seconds. Source math: unchanged; the core clip still selects source time. Audio follows: unchanged unless separately edited. Owner: `/hyperframes-keyframes`. Limit: target the inner wrapper, not the timed clip element.

## Pan / Ken Burns

```js
tl.fromTo(
  "#clip .inner",
  { scale: 1.05, xPercent: 0 },
  { scale: 1.2, xPercent: -12, duration: 4, ease: "none" },
  0,
);
```

Timeline math: move spans four authored seconds. Source math: unchanged. Audio follows: matching clip timing remains separate. Owner: `/hyperframes-keyframes`. Limit: authored geometry, not automatic face tracking.

## Crop / reframe

```js
tl.to("#clip .inner", { clipPath: "inset(8% 12% 6% 10%)", xPercent: -4, duration: 1 }, 2);
```

Timeline math: crop interpolates over `[2,3]`. Source math: unchanged. Audio follows: no automatic change. Owner: `/hyperframes-keyframes`. Limit: inner wrapper only, not temporal trim.

## Clip-path wipe / reveal / mask / split-screen

```js
tl.fromTo(
  "#next .inner",
  { clipPath: "polygon(0 0,0 0,0 100%,0 100%)" },
  { clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)", duration: 0.5 },
  2,
);
```

Timeline math: overlap placed clips for the 0.5s handoff. Source math: each clip keeps its own range. Audio follows: place matching audio on its own tracks. Owner: `/hyperframes-keyframes` + `/hyperframes-animation`. Limit: visual mask/polygon/split-screen only; source cuts stay `/hyperframes-core`.

## Crossfade

```html
<div id="a-visual" class="inner">
  <video
    id="a"
    data-start="0"
    data-duration="3"
    data-track-index="0"
    src="a.mp4"
    muted
    playsinline
  ></video>
</div>
<div id="b-visual" class="inner">
  <video
    id="b"
    data-start="2.5"
    data-duration="3"
    data-track-index="1"
    src="b.mp4"
    muted
    playsinline
  ></video>
</div>
<audio
  id="a-audio"
  src="a.mp4"
  data-start="0"
  data-duration="3"
  data-track-index="10"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":2.5,"v":1},{"t":3,"v":0}]}]}'
></audio>
<audio
  id="b-audio"
  src="b.mp4"
  data-start="2.5"
  data-duration="3"
  data-track-index="11"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":0.5,"v":1},{"t":3,"v":1}]}]}'
></audio>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.set("#b-visual", { opacity: 0 }, 0)
    .to("#a-visual", { opacity: 0, duration: 0.5 }, 2.5)
    .to("#b-visual", { opacity: 1, duration: 0.5 }, 2.5);
  window.__timelines["main"] = tl;
</script>
```

Timeline math: distinct tracks overlap by 0.5s with opposing opacity envelopes. Source math: each source range remains independent. Audio follows: opposing volume envelopes on distinct audio tracks. Owner: `/hyperframes-core` + `/hyperframes-keyframes` + `/hyperframes-audio`. Limit: the crossfade is the opacity/volume envelopes, not a source-level dissolve.

## Volume fades / ducking

```html
<audio
  id="music-bed"
  src="music.wav"
  data-start="0"
  data-duration="5"
  data-track-index="10"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":1,"v":1},{"t":2,"v":1},{"t":2.2,"v":0.3},{"t":3,"v":0.3},{"t":3.2,"v":1},{"t":4,"v":1},{"t":5,"v":0}]}]}'
></audio>
```

Timeline math: lane `t` is clip-local authored time: fade-in 0–1, duck down 2–2.2, hold 2.2–3, duck up 3–3.2, fade-out 4–5. Source math: source selection still uses core attributes. Audio follows: the explicit down-hold-up envelope affects this separate audio track. Owner: `/hyperframes-audio`. Limit: automation is not source retiming.

**One rule for volume over time: use the lane.** `lint` accepts a timeline tween on `volume` too, but when a track has both, the lane wins and the tween is ignored (`audio_volume_double_automation`). Never add a lane to a track that already has a `volume` tween, and never add a tween to a track that has a lane; edit the one that exists. To ramp 0.1 to 0.5 over ten seconds, write `{"t":0,"v":0.1},{"t":10,"v":0.5}`. `t` is seconds from the clip's own start, so a ramp past `data-duration` never finishes: check the clip's length before choosing the times. `data-volume` stays as the static level of the clip and combines with nothing else you author here.

## Audio alignment

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="3"
  data-duration="2"
  data-media-start="8"
  data-playback-rate="2"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="3"
  data-duration="2"
  data-media-start="8"
  data-playback-rate="2"
  data-track-index="10"
></audio>
```

Timeline math: picture and sound share start/duration. Source math: both consume four source seconds. Audio follows: identical timing, range, and rate on the separate audio track. Owner: `/hyperframes-core` + `/hyperframes-audio`. Limit: no waveform auto-sync or drift correction.

## Align a sound to an on-screen event

```html
<audio
  id="sfx-click-3"
  src="click.mp3"
  data-start="7.48"
  data-duration="0.07"
  data-track-index="103"
  data-volume="0.85"
></audio>
```

Timeline math: an audio element in the root composition has `data-start` in absolute root time; audio inside a scene file uses scene-local time and the host's `data-start` is added for you. An event inside a sub-composition happens at the host's `data-start` plus the event's local time in that sub-composition's own timeline, so `data-start = host start + local time`. Move only the audio's `data-start`; leave the picture alone. Source math: if the sound's transient is not at the file's first sample, subtract that lead-in from `data-start` (or trim it with `data-media-start`). Audio follows: nothing links audio to picture, so re-derive after every retime of the host. Owner: `/hyperframes-core`. Limit: no waveform auto-sync; for a beat grid use `hyperframes beats` and place each start on a beat time.

## Copy a group of clips to another time

```html
<audio
  id="sfx-click-0"
  src="click.mp3"
  data-start="1.6"
  data-duration="0.07"
  data-track-index="100"
></audio>
<audio
  id="sfx-type-0"
  src="typenew.mp3"
  data-start="7.8"
  data-duration="0.57"
  data-track-index="109"
></audio>
<audio
  id="sfx-click-0-copy"
  src="click.mp3"
  data-start="41.6"
  data-duration="0.07"
  data-track-index="186"
></audio>
<audio
  id="sfx-type-0-copy"
  src="typenew.mp3"
  data-start="47.8"
  data-duration="0.57"
  data-track-index="187"
></audio>
```

Timeline math: pick the clips first and say which ones you picked (by id) if the request does not match the file exactly; then add one `delta` to every member's `data-start`, so relative spacing is preserved (here `delta = 40`). Give each copy a new unique `id` and the next unused `data-track-index`; keep `src`, `data-duration`, `data-media-start`, `data-volume` and any `data-automation` as they are. Leave the originals untouched. Check the copies still end inside the composition's duration. Owner: `/hyperframes-core`. Limit: copies of a `<video>` or a sub-composition host follow the same rule, and a copied sub-composition needs its own host `id`.

## Add media (image, video, audio)

Write what Studio writes when a person drops a file on the timeline, so an agent-added clip behaves the same as a dropped one; the one difference is that video and audio need no `data-duration`. Studio's source of truth is `DEFAULT_TIMELINE_ASSET_DURATION` in `packages/studio/src/utils/studioHelpers.ts` and `buildTimelineAssetInsertHtml` in `packages/studio/src/utils/timelineAssetDrop.ts`; a test keeps this section equal to them.

- **Image: `data-duration` is optional and defaults to 3 seconds**, the same as a dropped image, because a still has no length of its own. Write it only for another length. A test keeps the 3 equal to the default in code.
- **Video and audio: `data-start` is enough.** The length comes from the media itself. An authored `data-duration` shorter than the file is a trim, never a requirement; leave it out unless the request asks for a shorter clip.
- **Start: the playhead or the requested time, never a silent `0`.** Studio's asset-panel Add uses the playhead time on track `0`; a drop uses the drop point.
- Give every clip `id`, `class="clip"`, `data-start` and `data-track-index`. Video is `muted playsinline`; audio carries `data-volume="1"`.
- Then make sure the root composition's `data-duration` is at least the clip's end (`data-start` plus its length: 3 for an image unless you set another, the media's length for video and audio): Studio raises a declared root duration to cover the new clip, so an agent must too, or the clip lies past the end and never plays.
- **Images and video fill the whole frame**: absolutely positioned at `left: 0; top: 0`, `width` and `height` equal to the composition's `data-width` and `data-height`, `object-fit: contain`. Studio does not know a dropped file's natural size, so it does not centre a smaller one.
- `z-index` is the number of top-level clips already in that file plus one (at least `1`); later clips stack above earlier ones.
- Several files dropped together share the drop's track and run end to end.

```html
<img
  id="photo"
  class="clip"
  src="assets/photo.png"
  data-start="4"
  data-track-index="1"
  style="position: absolute; left: 0px; top: 0px; width: 1920px; height: 1080px; object-fit: contain; z-index: 2"
/>
```

```html
<video
  id="broll"
  class="clip"
  src="assets/broll.mp4"
  data-start="4"
  data-track-index="2"
  muted
  playsinline
  style="position: absolute; left: 0px; top: 0px; width: 1920px; height: 1080px; object-fit: contain; z-index: 3"
></video>
```

```html
<audio
  id="whoosh"
  class="clip"
  src="assets/whoosh.mp3"
  data-start="4"
  data-track-index="3"
  data-volume="1"
></audio>
```

Inside a sub-composition file, `data-start` is scene-local (see `## Align a sound to an on-screen event`). Owner: `/hyperframes-core`.

## Swap a media file

```html
<video
  id="hero"
  src="assets/product-v2.mp4"
  data-start="2"
  data-duration="4"
  data-media-start="0"
  data-track-index="0"
  muted
  playsinline
></video>
```

Timeline math: change only `src`. Source math: reset `data-media-start` to the offset you want in the NEW file, and set `data-duration` no longer than the new file's remaining length (probe it with `ffprobe`). Audio follows: a separate `<audio>` that pointed at the old file needs the same `src` swap. Keep `id`, `data-start`, `data-track-index` and any `data-automation` so nothing else moves. Run `lint`: `audio_src_not_found` and `media_src_kind_mismatch` catch a wrong path or kind. Owner: `/hyperframes-core`. Limit: a still swapped for a video (or the reverse) is a tag change, not a swap.

## Split a section and change its speed

Timeline math: a section that is a sub-composition or a group of clips has no `data-playback-rate` of its own to set; split it by giving each half its own host or clips and shift everything after the cut by the length change. New length of a part = old length / rate. Every later `data-start` (clips, audio, root-timeline tweens) moves by the same delta. Source math: `<video>` and `<audio>` parts use `data-playback-rate` (0.1 to 10, constant) per the constant-speed recipe above, with matching audio. A speed ramp (a rate that changes within one clip) is a `rate` lane in `data-automation` on the `<video>`/`<audio>`; see `docs/reference/speed-ramps`. Say which you did.
