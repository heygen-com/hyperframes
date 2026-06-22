---
name: montage
description: >
  Author a beat-synced HyperFrames montage from a folder of photos/videos and a
  music track — cut each segment on the music's beats and duck the music under
  any clip that carries its own audio. Use when the user has (or wants) a music
  track and a set of image/video assets and asks for a "montage", "music video",
  "photo montage", "beat-synced" / "cut to the beat" / "rhythmic" edit, or a
  slideshow driven by the music. Closes the loop from the `hyperframes beats`
  CLI output to a finished composition. Docs-only recipe — no engine/runtime
  changes; it builds entirely on the shipped `beats` CLI and the core
  media/volume contract.
metadata:
  { "tags": "montage, beats, beat-synced, music-video, photo-montage, volume-ducking, crossfade" }
---

# montage — beat-synced montage authoring recipe

A **beat-synced montage** cuts one segment per asset on a steady beat cadence so the picture changes _feel_ the music, and ducks the background music under any clip that brings its own sound. This skill closes the loop that `hyperframes beats` (detection) and Studio beat-snapping (manual) leave open: given a folder of assets + `beats/<audio>.json`, place the cuts on beats and duck the music under each video clip.

**Read `/hyperframes-core` first** for the base composition contract (clips, tracks, `data-*` attributes, the seekable timeline). This recipe only covers what is specific to beat-driven montage: consuming the beats file, segment placement, crossfade exits, and music ducking. It introduces **no new commands** and touches **no engine/runtime code**.

## When to use this skill

Use it when the user has a music track and a set of assets and asks for any of:

- a "montage", "photo montage", "music video", or "highlight reel";
- a "beat-synced", "cut to the beat", or "rhythmic" edit;
- a slideshow/recap whose pacing should follow the music.

Do **not** use it for narrative voiceover pieces (the cadence is the speech, not the music) — that stays in `/general-video` / `/product-launch-video`. If there is no music track at all, there is nothing to sync to; ask first.

## Prerequisites

1. **One music track**, mounted as the music `<audio>`: `data-timeline-role="music"` (the `beats` CLI keys off this — or an id matching `music` / `bgm` / `soundtrack`). This is the track the montage cuts against.
2. **Assets on disk** — photos (`<img>`) and/or video clips. Video clips that carry audible sound get a sibling `<audio>` per the core media contract (see Step 4).

You need the music file present before detecting beats; the assets can be wired in either before or after.

## The loop

### Step 1 — Detect beats, read `beats/<audio>.json`

Run the shipped CLI from the project root (it spawns headless Chrome, so ensure `npx hyperframes browser ensure` first if no browser is on disk):

```bash
npx hyperframes beats            # analyzes the music track in ./index.html
npx hyperframes beats --json     # same, but prints { ok, file, count, bpm } as JSON
```

The command finds the music `<audio>` (first element with `data-timeline-role="music"`, else the first id matching `music|bgm|soundtrack`), detects beats, and writes:

```
beats/<audio>.json
```

The file is versioned and self-describing — **one `{ time, strength }` per beat**:

```jsonc
{
  "version": 1,
  "audio": "assets/bgm/track.mp3",
  "beats": [
    { "time": 0.523, "strength": 0.62 },
    { "time": 1.014, "strength": 0.81 },
    { "time": 1.505, "strength": 0.43 },
    // …
  ],
}
```

Read it at build time (the composition must stay deterministic — read the file **offline**, bake the chosen times into the HTML/timeline; never fetch it at render time):

```js
// build-time helper (runs once when authoring, NOT in the composition)
const { beats } = JSON.parse(fs.readFileSync("beats/assets/bgm/track.mp3.json", "utf8"));
// beats: Array<{ time: number, strength: number }>
```

> **0 beats is not an error to bake.** The CLI refuses to _write_ a 0-beat file (a silent/ambient track yields nothing), so a missing file means re-run detection or pick a different track.

### Step 2 — Place one segment per asset on a beat cadence

Pick a cadence — **one segment every Nth beat** — so segment boundaries land exactly on beats. `N` sets the pace:

| Cadence (every Nth beat) | Vibe                | Typical BPM × N         |
| ------------------------ | ------------------- | ----------------------- |
| every 1 beat             | frenetic / intro    | fast cuts, ≤ ~0.5s each |
| every 2 beats            | energetic default   | ~1s each at 120 BPM     |
| every 4 beats            | relaxed / cinematic | ~2s each at 120 BPM     |

Then for asset `i`, assign the segment `[beats[i * N].time, beats[(i + 1) * N].time]`. Use `strength` to bias _which_ beats you cut on (cut on the strongest beats), to drop a segment on a long musical rest, or to land a hero asset on the strongest beat in the track.

```js
// build-time: turn beats + assets into concrete clip times
const N = 2; // every 2nd beat
const slots = assets
  .map((asset, i) => {
    const startBeat = beats[i * N];
    const endBeat = beats[(i + 1) * N];
    if (!startBeat || !endBeat) return null; // ran out of beats → stop
    return {
      asset,
      start: Number(startBeat.time.toFixed(3)),
      duration: Number((endBeat.time - startBeat.time).toFixed(3)),
    };
  })
  .filter(Boolean);

const totalDuration = Number(slots[slots.length - 1].start + slots[slots.length - 1].duration);
```

Each slot becomes a `.clip` with those exact `data-start` / `data-duration`, all inside one composition whose `data-duration` is `totalDuration`. Consecutive `data-start` values are the **clip boundaries** the crossfade rule in Step 3 keys off.

### Step 3 — Crossfade segments (with the required hard kill)

Between segments, crossfade the outgoing segment's content to `opacity: 0` ending _at_ the next segment's start boundary, then **immediately hard-kill** it with a `tl.set(..., { opacity: 0 }, boundary)` at that same time.

This pair is **required**, not stylistic. The `gsap_exit_missing_hard_kill` lint rule fires whenever a GSAP exit tween (a `.to`/`.fromTo` ending in a hidden state — `opacity: 0`, `autoAlpha: 0`, `visibility: "hidden"`, or `display: "none"`) lands on a clip start boundary without a matching `tl.set`. Non-linear seeking can otherwise stop _after_ the fade and leave stale, half-visible state from the previous segment bleeding through the cut.

```js
// segment A ends at boundary B (the next segment's data-start)
tl.to("#seg-a", { opacity: 0, duration: 0.4, ease: "power2.out" }, B - 0.4);
tl.set("#seg-a", { opacity: 0 }, B); // ← the required hard kill
```

Rules of thumb:

- Animate **`opacity`** (or `autoAlpha`) for crossfades — never `visibility`/`display` on a `.clip` element (that trips `gsap_animates_clip_element`; the framework owns clip visibility).
- The hard kill must use the **same hidden state** the exit tween lands in and sit at the **same time** as the boundary (within 0.05s).
- The **final** segment has no successor boundary, so its closing fade needs no hard kill.

### Step 4 — Duck `#bgm` under each video clip, lift the clip's own `<audio>`

When a segment is a **video clip with its own sound**, duck the music under it so the clip's audio is audible, then lift the music back when the clip ends. Per the core media/volume contract, automate `volume` **on the timeline** (the runtime probes the timeline's volume keyframes and applies them identically in preview and render); `data-volume` is only the static baseline for elements no tween touches.

```js
// clip spans [clipStart, clipEnd]; music baseline is data-volume="0.9"
tl.to("#bgm", { volume: 0.15, duration: 0.3, ease: "power1.inOut" }, clipStart); // duck
tl.to("#bgm", { volume: 0.9, duration: 0.3, ease: "power1.inOut" }, clipEnd - 0.3); // lift
```

Wire the clip's sound the standard way: a muted `<video>` for the picture plus a sibling `<audio>` (same `src`, same timing) carrying the sound at `data-volume="1"`. Photo segments and silent B-roll duck nothing — leave the music at its baseline.

```html
<!-- video clip WITH sound: muted <video> for picture + sibling <audio> for sound -->
<video
  class="clip"
  id="seg-2-video"
  src="assets/clip-2.mp4"
  muted
  playsinline
  data-start="3"
  data-duration="3"
  data-track-index="2"
></video>
<audio
  id="seg-2-audio"
  src="assets/clip-2.mp4"
  data-start="3"
  data-duration="3"
  data-track-index="3"
  data-volume="1"
></audio>
```

## Worked example

A 9-second, 3-segment montage over a music bed. Beats land every ~1.5s, so every-2nd-beat gives 3s segments at boundaries **3.0s** and **6.0s**. Segment 2 is a video clip with its own audio, so the music ducks under it. This file passes `npx hyperframes lint` with 0 errors once the referenced asset files exist (the `assets/*` paths are placeholders — drop your own media in; lint treats missing local media as errors, not warnings).

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Beat-synced montage</title>
  </head>
  <body style="margin: 0">
    <div
      data-composition-id="montage"
      data-start="0"
      data-duration="9"
      data-width="1920"
      data-height="1080"
      style="position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0a"
    >
      <!-- Music bed: a direct child of the root composition (the media contract —
           media is never nested in a sub-comp/wrapper). data-timeline-role="music"
           is what `hyperframes beats` targets; data-volume="0.9" is the static
           baseline the timeline automates. -->
      <audio
        id="bgm"
        src="assets/bgm/track.mp3"
        data-start="0"
        data-duration="9"
        data-track-index="0"
        data-volume="0.9"
        data-timeline-role="music"
      ></audio>

      <!-- Segment 1 — photo, beats[0] → beats[2] (0.0s → 3.0s) -->
      <section
        class="clip"
        id="seg-1"
        data-start="0"
        data-duration="3"
        data-track-index="1"
        style="position: absolute; inset: 0"
      >
        <img
          id="seg-1-img"
          src="assets/clip-1.jpg"
          alt=""
          style="width: 100%; height: 100%; object-fit: cover"
        />
        <h2
          id="seg-1-cap"
          style="position: absolute; left: 80px; bottom: 80px; margin: 0; font-family: sans-serif; font-size: 64px; color: #fff"
        >
          Sunrise
        </h2>
      </section>

      <!-- Segment 2 — video clip WITH its own audio, beats[2] → beats[4] (3.0s → 6.0s) -->
      <video
        class="clip"
        id="seg-2-video"
        src="assets/clip-2.mp4"
        muted
        playsinline
        data-start="3"
        data-duration="3"
        data-track-index="2"
        style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover"
      ></video>
      <audio
        id="seg-2-audio"
        src="assets/clip-2.mp4"
        data-start="3"
        data-duration="3"
        data-track-index="3"
        data-volume="1"
      ></audio>

      <!-- Segment 3 — photo, beats[4] → beats[6] (6.0s → 9.0s) -->
      <section
        class="clip"
        id="seg-3"
        data-start="6"
        data-duration="3"
        data-track-index="4"
        style="position: absolute; inset: 0"
      >
        <img
          id="seg-3-img"
          src="assets/clip-3.jpg"
          alt=""
          style="width: 100%; height: 100%; object-fit: cover"
        />
        <h2
          id="seg-3-cap"
          style="position: absolute; left: 80px; bottom: 80px; margin: 0; font-family: sans-serif; font-size: 64px; color: #fff"
        >
          Nightfall
        </h2>
      </section>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["montage"] = tl;

      // Segment starts land on every 2nd beat: 0.0, 3.0, 6.0. Each outgoing
      // segment crossfades to opacity:0 at the next boundary (3.0, 6.0), so each
      // fade-out gets a matching tl.set "hard kill" at that boundary — the
      // gsap_exit_missing_hard_kill rule. The final segment's closing fade has no
      // successor boundary, so it needs no hard kill.

      // Segment 1 out → boundary 3.0
      tl.to("#seg-1", { opacity: 0, duration: 0.4, ease: "power2.out" }, 2.6);
      tl.set("#seg-1", { opacity: 0 }, 3.0);

      // Segment 2 out → boundary 6.0
      tl.to("#seg-2-video", { opacity: 0, duration: 0.4, ease: "power2.out" }, 5.6);
      tl.set("#seg-2-video", { opacity: 0 }, 6.0);

      // Final segment fades out at the end (no boundary → no hard kill).
      tl.to("#seg-3", { opacity: 0, duration: 0.4, ease: "power2.out" }, 8.6);

      // Duck #bgm under segment 2's video clip (it carries its own audio), then
      // lift back to the data-volume="0.9" baseline. The runtime probes these
      // volume keyframes and applies them identically in preview and render.
      tl.to("#bgm", { volume: 0.15, duration: 0.3, ease: "power1.inOut" }, 3.0);
      tl.to("#bgm", { volume: 0.9, duration: 0.3, ease: "power1.inOut" }, 5.7);
    </script>
  </body>
</html>
```

### What the example demonstrates

- **`data-timeline-role="music"`** on `#bgm` is the hook the `beats` CLI detects against — and `#bgm` is the duck target.
- **Segment boundaries (3.0, 6.0)** are the next clips' `data-start` values; the crossfade fade-outs end on them and each is followed by a `tl.set(..., { opacity: 0 }, boundary)` hard kill.
- **`opacity`** is animated for crossfades — never `visibility`/`display` on a `.clip` (the framework owns clip visibility).
- **`volume` is automated on the timeline**, not by swapping `data-volume`; `data-volume="0.9"` stays the static baseline the lift returns to.
- **The video clip's sound** rides a sibling `<audio>` (muted `<video>` for picture, `<audio>` for sound) — the core media contract.

## Validation

After authoring or editing a montage composition, run:

```bash
npx hyperframes lint       # must report 0 error(s) — block on the hard-kill + clip-visibility rules
npx hyperframes validate   # headless runtime check — catches missing assets / JS errors
```

Treat both as blockers. The two rules most likely to fire while iterating this recipe:

- `gsap_exit_missing_hard_kill` — a crossfade ends on a clip boundary without the matching `tl.set`. Add the hard kill (Step 3).
- `gsap_animates_clip_element` — you animated `visibility`/`display` on a `.clip`. Move that content into a child `<div>` and target that, or use `opacity`.

When the cut feels off, the fix is almost always the cadence (`N`) or which beats you cut on (favor `strength`) — not the animation. Re-read the beats file and rebake the segment times.
