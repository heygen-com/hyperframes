---
name: slideshow
description: >
  Author a HyperFrames slideshow composition — a presentation, pitch deck, or
  interactive deck with discrete slides, fragment reveals, branching sequences,
  and hotspot navigation. Read when the request is to build or edit a slideshow,
  presentation, or pitch deck as a HyperFrames composition.
---

# Slideshow authoring contract

A HyperFrames slideshow is a normal HyperFrames composition — scenes, clips, GSAP timelines — with one extra ingredient: a **JSON island** that declares which scenes are slides and how they connect. The player's `SlideshowController` reads the island and turns the continuous GSAP timeline into a discrete, navigable deck.

**Read `/hyperframes-core` first** for the base composition contract (clips, tracks, `data-*` attributes, determinism rules). This skill covers only what is new: the island schema, slide writing rules, fragments, branching, validation, and the wrapping component.

---

## The two pieces

### 1. Scenes — declared the normal way

Every slide is backed by a scene. Declare scenes with `data-composition-id`, `data-start`, `data-duration`, and `data-label`:

```html
<div
  data-composition-id="problem"
  data-start="0"
  data-duration="8"
  data-label="The problem"
  data-width="1920"
  data-height="1080"
>
  <!-- clips go here -->
</div>
```

Branch slides (reachable only via a hotspot, excluded from the main line) are declared exactly the same way — they just appear only in a `slideSequences` entry in the island, not in the main `slides` array.

### 2. The JSON island — one script block per composition

Add exactly one `<script type="application/hyperframes-slideshow+json">` block to the composition HTML. It holds all slideshow metadata:

```html
<script type="application/hyperframes-slideshow+json">
  {
    "slides": [...],
    "slideSequences": [...]
  }
</script>
```

The island is the single source of truth for slide order, notes, fragment hold-points, hotspots, and branch sequences. Keep it near the top of the `<body>`, before the scene divs, so it is easy to find.

---

## Schema

### `SlideshowManifest` (the top-level island object)

```json
{
  "slides": [
    /* SlideRef[] — the main line, in order */
  ],
  "slideSequences": [
    /* SlideSequence[] — off-line branch sequences */
  ]
}
```

### `SlideRef`

```json
{
  "sceneId": "problem",
  "notes": "Lead with the pain, not the company.",
  "fragments": [3.5, 5.2, 7.0],
  "hotspots": [
    /* SlideHotspot[] */
  ],

  "ttsScript": null,
  "ttsAudioUrl": null,
  "ttsDurationMs": null
}
```

| Field                                       | Required | Notes                                                                                                                       |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sceneId`                                   | yes      | Must match a scene's `data-composition-id` exactly. The lint rule resolves both `data-composition-id` and `.clip[id]`.      |
| `notes`                                     | no       | Presenter-only text. Never shown to the audience.                                                                           |
| `fragments`                                 | no       | Array of times (seconds) within the slide's `[start, end]` range — see Fragments below.                                     |
| `hotspots`                                  | no       | Interactive overlays that trigger a branch — see Branching below.                                                           |
| `startTime`                                 | no       | Optional. Override the matched scene's time bounds; defaults to the scene's start/end.                                      |
| `endTime`                                   | no       | Optional. Override the matched scene's time bounds; defaults to the scene's start/end.                                      |
| `ttsScript`, `ttsAudioUrl`, `ttsDurationMs` | no       | **Reserved.** Schema fields exist but TTS playback is not yet wired. Omit unless you are pre-populating for a future build. |

### `SlideHotspot`

```json
{
  "id": "h1",
  "label": "How did we calculate this?",
  "target": "market-deep-dive",
  "region": { "x": 60, "y": 10, "w": 35, "h": 20 }
}
```

| Field    | Required | Notes                                                                                                                           |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | yes      | Unique within the slide.                                                                                                        |
| `label`  | yes      | Tooltip / button text shown to the audience.                                                                                    |
| `target` | yes      | Must match a `SlideSequence.id` in `slideSequences`.                                                                            |
| `region` | no       | Percentage-of-slide bounding box: `{x, y, w, h}` in `0–100`. Omit to render the hotspot as a full-slide labeled button instead. |

### `SlideSequence`

```json
{
  "id": "market-deep-dive",
  "label": "Market sizing methodology",
  "slides": [{ "sceneId": "mkt-1" }, { "sceneId": "mkt-2" }]
}
```

`slides` inside a sequence uses the same `SlideRef` shape as the main line. Fragments and nested hotspots are allowed.

---

## Slide writing rules

These are hard constraints, not suggestions. A slide that violates them will be outright replaced when a reviewer sees it.

- **Headline is a complete-sentence claim, not a label.** Write "SMBs spend 14 hours/week on manual scheduling" not "Scheduling problem". The sentence should stand alone if the visual is ignored.
- **One idea + one visual per slide.** If you are tempted to add a second bullet cluster or a second chart, split the slide.
- **Lead with the punchline.** The strongest point goes first — on the slide and in the deck order. Investors read left-to-right, top-to-bottom, and they stop.
- **Bottom-up market sizing only.** Never write "$50B TAM" without showing the math. Build from unit economics up: accounts × ACV, or transactions × take-rate.
- **Font minimum 30pt equivalent.** At 1920×1080, a headline is 72–96px; body copy is 48px. Never go below 40px for any text the audience must read.

---

## Fragments: reveal hold-points within a slide

A fragment is a time (in seconds) within a slide's `[start, end]` range where the controller pauses before the next reveal.

**How it works:**

1. Player enters the slide — seeks to `start`, then plays.
2. Controller pauses at `fragments[0]`. The first element's GSAP entrance has just landed.
3. User presses Next (or →) — plays to `fragments[1]`, pauses again.
4. After the last fragment, Next plays to `slide.end` and holds.
5. Next again advances to the next slide.

Fragment times must be strictly inside `[start, end]`. The lint rule rejects fragments outside that range.

Fragment times are **absolute composition-timeline positions** — the same coordinate space as `data-start` — not offsets relative to the scene's start.

Each fragment is a play-to-and-hold, not a seek jump — so every element that enters between the previous hold-point and this one plays its GSAP entrance animation. Design the clip entrance animations to work as sequential reveals.

---

## Branching: hotspots and slide sequences

Branch slides are real scenes in the same composition timeline. They are listed only under `slideSequences` and are excluded from main-line navigation — the player never visits them unless a hotspot fires.

**Navigation model:**

- Clicking a hotspot pushes `{sequenceId, slideIndex: 0}` onto the nav stack and enters the branch's first slide.
- **back()** pops the stack and returns to the exact parent slide (the one that held the hotspot).
- **backToMain()** clears the entire stack and returns to the root slide.
- Breadcrumb renders from the stack: `Main deck › Market sizing methodology › Slide 2`.
- The slide counter inside a branch is scoped to that sequence (`1 of 2`, not the main-deck total).

**What to avoid:**

- Do not add branch scene IDs to the main `slides` array. They must appear only inside a `slideSequences` entry. The lint rule flags overlap.
- Branch scenes are included in the continuous timeline, so a naive linear video export would include them. Export reads main-line slides only (deferred; flagged in the spec).

---

## Worked example: 3-slide deck with fragments and a branch

### Scene HTML (skeleton)

```html
<body style="margin: 0">
  <script type="application/hyperframes-slideshow+json">
    {
      "slides": [
        {
          "sceneId": "hook",
          "notes": "Open with the stat. Pause on the $40B number."
        },
        {
          "sceneId": "problem",
          "notes": "Walk through each pain point one at a time.",
          "fragments": [11.0, 15.0],
          "hotspots": [
            {
              "id": "h1",
              "label": "Where does the $40B figure come from?",
              "target": "market-detail",
              "region": { "x": 55, "y": 60, "w": 40, "h": 20 }
            }
          ]
        },
        {
          "sceneId": "solution",
          "notes": "One sentence: what we do and who it is for."
        }
      ],
      "slideSequences": [
        {
          "id": "market-detail",
          "label": "Market sizing methodology",
          "slides": [{ "sceneId": "mkt-math", "notes": "Bottom-up: 2.3M SMBs × $17k ACV." }]
        }
      ]
    }
  </script>

  <!-- Slide 1 — hook -->
  <div
    data-composition-id="hook"
    data-start="0"
    data-duration="6"
    data-label="The hook"
    data-width="1920"
    data-height="1080"
    style="position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0a"
  >
    <section
      class="clip"
      data-start="0"
      data-duration="6"
      data-track-index="1"
      style="position: absolute; inset: 0; display: grid; place-items: center"
    >
      <h1 id="hook-headline" style="font-size: 80px; color: #fff; font-family: sans-serif">
        SMBs lose $40B/year to manual scheduling
      </h1>
    </section>
  </div>

  <!-- Slide 2 — problem (3 fragments) -->
  <div
    data-composition-id="problem"
    data-start="6"
    data-duration="15"
    data-label="The problem"
    data-width="1920"
    data-height="1080"
    style="position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0a"
  >
    <section
      class="clip"
      data-start="6"
      data-duration="15"
      data-track-index="1"
      style="position: absolute; inset: 0; padding: 120px 160px; box-sizing: border-box"
    >
      <h2 id="pain-headline" style="font-size: 64px; color: #fff; font-family: sans-serif">
        Three gaps operators can not close
      </h2>
      <p id="pain-1" style="font-size: 48px; color: #ccc; opacity: 0; font-family: sans-serif">
        No-shows cost 23% of booked revenue
      </p>
      <p id="pain-2" style="font-size: 48px; color: #ccc; opacity: 0; font-family: sans-serif">
        Manual reminders take 4h/week per staff
      </p>
      <p id="pain-3" style="font-size: 48px; color: #ccc; opacity: 0; font-family: sans-serif">
        Rescheduling friction drives 40% churn
      </p>
    </section>
  </div>

  <!-- Slide 3 — solution -->
  <div
    data-composition-id="solution"
    data-start="21"
    data-duration="8"
    data-label="The solution"
    data-width="1920"
    data-height="1080"
    style="position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0a"
  >
    <section
      class="clip"
      data-start="21"
      data-duration="8"
      data-track-index="1"
      style="position: absolute; inset: 0; display: grid; place-items: center"
    >
      <h2 id="solution-headline" style="font-size: 72px; color: #fff; font-family: sans-serif">
        Acme automates scheduling for service SMBs — no-shows down 80% in 90 days
      </h2>
    </section>
  </div>

  <!-- Branch slide — excluded from main line -->
  <div
    data-composition-id="mkt-math"
    data-start="29"
    data-duration="7"
    data-label="Market math"
    data-width="1920"
    data-height="1080"
    style="position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #111"
  >
    <section
      class="clip"
      data-start="29"
      data-duration="7"
      data-track-index="1"
      style="position: absolute; inset: 0; display: grid; place-items: center"
    >
      <p id="mkt-formula" style="font-size: 56px; color: #fff; font-family: sans-serif">
        2.3M SMBs × $17k ACV = $39B serviceable market
      </p>
    </section>
  </div>

  <script>
    window.__timelines = window.__timelines || {};

    // Slide 2 fragment entrance animations
    gsap.registerPlugin(); // load any plugins before use

    const tl = gsap.timeline({ paused: true });
    window.__timelines["problem"] = tl;

    // Insert positions are absolute composition-timeline times (same as data-start / fragment values).
    tl.from("#pain-1", { opacity: 0, y: 20, duration: 0.4 }, 11.0);
    tl.from("#pain-2", { opacity: 0, y: 20, duration: 0.4 }, 15.0);
    // pain-3 lands at end of slide
    tl.from("#pain-3", { opacity: 0, y: 20, duration: 0.4 }, 13.0);
  </script>
</body>
```

### Key points in the example

- The island `sceneId` values (`"hook"`, `"problem"`, `"solution"`, `"mkt-math"`) exactly match `data-composition-id` values on scene divs.
- `mkt-math` appears only in `slideSequences` — it is never in the top-level `slides` array.
- Fragment times (`11.0`, `15.0`) are within the `problem` scene's `[6, 21]` range (times are absolute composition-timeline positions).
- The hotspot `region` (`x: 55, y: 60, w: 40, h: 20`) positions the clickable area in the lower-right quadrant of the problem slide.
- GSAP timelines are registered on `window.__timelines` and are paused — the HyperFrames engine drives playback; do not call `.play()` at construction time.

---

## Wrapping component

Wrap the composition in `<hyperframes-slideshow>` around `<hyperframes-player>` in any embedding context:

```html
<hyperframes-slideshow>
  <hyperframes-player src="deck.html"></hyperframes-player>
</hyperframes-slideshow>
```

`<hyperframes-slideshow>` provides the navigation chrome (Prev / Next buttons, progress dots, breadcrumb, counter), keyboard handling (← / → and Space / Backspace), touch swipe, and hotspot overlays.

**Presenter mode:** the Present button calls `window.open('?mode=audience')` for a fullscreen audience window; the originating tab becomes the presenter view (current slide reduced, next-slide preview, notes, elapsed timer). Both windows sync via `BroadcastChannel('hf-slideshow')`.

---

## Running a slideshow standalone (interim)

The **durable answer** is engine-hosted: `hyperframes preview --slideshow` / studio present mode will host the composition over the real HyperFrames engine, which drives seek-timelines, owns the gesture frame, and reads the island from the composition. That path is coming; prefer it once it ships.

Until then, standalone demos (a composition opened via the bare player bundle in a browser, without the engine) require workarounds for four gaps: the player does not drive GSAP seek-timelines, the island must be duplicated into the wrapper, audio must live in the parent frame, and animations must be self-driving. These patterns are documented in:

```
skills/slideshow/references/standalone-harness.md
```

Do not treat the patterns there as the blessed model — they exist only to bridge the gap until the engine-hosted path lands.

---

## Validation

After authoring or editing a slideshow composition, run:

```bash
npx hyperframes lint
```

The slideshow lint rule checks:

- Every `slide.sceneId` resolves to an existing scene (by `data-composition-id`).
- Every `hotspot.target` references a defined `slideSequence` id.
- Fragment times fall within each slide's `[start, end]` range.
- No two main-line slides overlap in time.

Fix all violations before previewing. A composition that fails lint will not parse correctly in the player.
