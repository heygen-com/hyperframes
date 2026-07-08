---
name: slideshow
description: >
  Author a HyperFrames slideshow — a presentation, pitch deck, or interactive
  deck with discrete slides, fragment reveals, branching, hotspot navigation,
  and built-in presenter mode with speaker notes; also converts an existing
  page into a deck. Output is a navigable deck, not a rendered MP4. If the
  user didn't explicitly ask for a slideshow, confirm before authoring.
  Unclear → /hyperframes.
---

> **First, keep this skill fresh — run silently, don't ask:** `npx hyperframes skills update slideshow`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

# Slideshow authoring contract

A HyperFrames slideshow is a normal HyperFrames composition — scenes, clips, GSAP timelines — with one extra ingredient: a **JSON island** that declares which scenes are slides and how they connect. The player's `SlideshowController` reads the island and turns the continuous GSAP timeline into a discrete, navigable deck.

**Read `/hyperframes-core` first** for the base composition contract (clips, tracks, `data-*` attributes, determinism rules). This skill covers only what is new: the island schema, slide writing rules, fragments, branching, validation, and the wrapping component.

## Output — a navigable deck, not a linear MP4

A slideshow's output is the **running deck**: serve it with `hyperframes present <project-dir>` (or Studio present mode) — the player's `SlideshowController` reads the island and drives navigation, fragments, branching, and presenter mode. See **Presenting and handoff** below.

**Do not `hyperframes render` a slideshow into a single MP4.** A deck is authored as several top-level scene compositions (one `data-composition-id` per slide) with **no master-root composition** wrapping them, so `render` resolves only the **first** composition and emits a **silently truncated** MP4 (e.g. 6s of a 40-second deck). A linear main-line export (main slides only, branch sequences excluded) is **deferred** — until it ships, the supported outputs are the live `present` deck and per-slide `snapshot` stills. If a user needs a linear MP4 today, surface this limitation rather than pointing `render` at the deck.

## Intent confirmation

If the user explicitly asks for a slideshow, slide show, or HyperFrames slideshow, proceed with this skill.

If the skill triggered from an adjacent request such as "presentation", "pitch deck", "deck", "interactive deck", or "convert this page", pause before authoring and frame the choice before asking for confirmation. Briefly explain that a HyperFrames slideshow means a runnable deck with discrete slides, built-in navigation and presenter mode, editable speaker notes, shared media handling, and validation before handoff. For source-page conversions, also mention that the goal is to preserve the original page's visual design, interactions, motion, and media behavior while translating page movement into slide-to-slide transitions.

Then ask a short confirmation question:

> Do you want this as a HyperFrames slideshow?

Use a yes/no choice UI when the environment provides one; otherwise ask the question in plain text.

Do not implement the slideshow until the user says yes. If they say no, stop using this skill and switch to the appropriate non-slideshow workflow.

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

Do not hide the slideshow manifest behind an alternate `<script type="application/json">` block plus runtime code that creates the island. The `present` command reads the composition HTML statically and expects the real `application/hyperframes-slideshow+json` island to already be present.

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

| Field                                       | Required | Notes                                                                                                                                                   |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sceneId`                                   | yes      | Must match a scene's `data-composition-id` exactly (or provide explicit `startTime`/`endTime`). The lint rule resolves scenes by `data-composition-id`. |
| `notes`                                     | no       | Presenter-only text. Never shown to the audience.                                                                                                       |
| `fragments`                                 | no       | Array of times (seconds) within the slide's `[start, end]` range — see Fragments below.                                                                 |
| `hotspots`                                  | no       | Interactive overlays that trigger a branch — see Branching below.                                                                                       |
| `startTime`                                 | no       | Optional. Override the matched scene's time bounds; defaults to the scene's start/end.                                                                  |
| `endTime`                                   | no       | Optional. Override the matched scene's time bounds; defaults to the scene's start/end.                                                                  |
| `ttsScript`, `ttsAudioUrl`, `ttsDurationMs` | no       | **Reserved.** Schema fields exist but TTS playback is not yet wired. Omit unless you are pre-populating for a future build.                             |

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

## Porting source pages

When converting an existing page into a slideshow, source fidelity is part of the contract. Do not replace source-specific widgets with simplified approximations unless the user explicitly asks for a redesign.

- Preserve the original page's visual design, motion language, interactive behavior, media behavior, and presentation affordances as closely as practical. When the slideshow system supports presenter mode, include speaker notes using the shared editable-notes behavior rather than a deck-specific implementation.
- Port mechanical visuals from the source DOM/CSS/JS as exactly as practical: custom players, canvas visualizers, timelines, playheads, stems, expanding circles, hover states, and other interactive details should survive the conversion.
- Treat native `<video>` / `<audio>` elements as the source of truth for any custom media chrome, canvas visualizer, waveform, beat grid, or playhead. Wire the source's media events (`play`, `pause`, `timeupdate`, `seeking`, `seeked`, `ended`, `ratechange`, `volumechange`) and derive visual state from `media.currentTime`; do not run a separate timer that can drift away from actual playback.
- Every copied `<video>` or `<audio>` with `src` must have HyperFrames timing attributes before lint: `data-start` and `data-duration`, plus `data-has-audio="true"` when audible native audio should be preserved. Use the scene's time range for slide-specific media; for user-controlled evidence videos that may be played from multiple focused slides, use a deck-wide range. Do not leave `preload="none"` on media; use `metadata` or `auto`.
- Resolve source font tokens before validation. If preserving custom source fonts, add `@font-face` rules for local/captured font files. If using system fallbacks, replace tokenized declarations such as `font-family: var(--f-body)` with concrete render-safe stacks such as `system-ui, sans-serif` or `ui-monospace, monospace`; do not leave `var(...)` as the font family value.
- Audit the source for atypical page movement, especially behavior driven by scroll, wheel, touch, hash state, resize, or a requestAnimationFrame loop. Treat fixed viewports with translated/scaled "world" layers, parallax, pinned panels, horizontal scrollers, scroll-scrubbed timelines, section snapping, and zoom-to-element cameras as source behavior. Scroll is often the source's transition trigger, so preserve the transition by extracting its progress stops, easing, and camera/focus states, then re-host that motion on slideshow navigation through timeline positions, fragments, or a reusable player/harness hook. Standalone wrappers that jump to slide hold-points still need an explicit navigation-camera transition hook; computing per-slide camera transforms is not enough. Do not simulate a literal page-scroll-down transition inside the slide; the viewer should feel camera travel/zoom from one focal point to another, not see a webpage being scrolled. Keep each slide-to-slide camera move continuous: avoid intermediate route stops that reverse x/y direction or zoom unless the source visibly does that at the same boundary. A transition that darts around before landing is worse than a simpler direct focal move.
- Preserve the source's media crop semantics. Treat screenshots, tweets/social posts, product UI captures, charts, docs, code, leaderboards, and any image with readable text as content evidence, not decorative media: use the source aspect ratio (`height: auto`) or `object-fit: contain` inside a stable frame. Use `object-fit: cover` only when the source did, or for intentionally decorative/background/cinematic thumbnails. After fitting these captures into a slide, inspect all four edges for truncated text, logos, controls, or captions; a visible crop on meaningful content is a bug unless the source itself cropped it.
- If a behavior is generic to slideshows, put it in the player/controller or in a reusable skill snippet. Do not solve it with one-off deck scripts.
- Stacked scene frames must never block interaction on the active slide. Hidden frames need both visual hiding and event gating:

```css
.scene-frame {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.scene-frame.is-active {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
```

If visibility is driven imperatively, set all three properties (`opacity`, `visibility`, and `pointerEvents`) in the visibility controller. `opacity: 0` alone still leaves an invisible layer that can swallow clicks.

---

## Fragments: reveal hold-points within a slide

A fragment is an absolute composition-timeline time (seconds) within a slide's `[start, end]` range where the controller should hold a reveal state.

**How it works:**

1. Player enters a fragmented slide — seeks directly to `fragments[0]` and holds there.
2. User presses Next (or →) — controller seeks to `fragments[1]` and holds.
3. After the last fragment, Next advances to the next slide.
4. A slide without fragments enters at a rest frame inside the slide, usually its midpoint, not exactly at `slide.end`.

Fragment times must fall within `[start, end]` (inclusive of both bounds). The lint rule rejects only fragments outside that range (`time < start` or `time > end`).

Fragment times are **absolute composition-timeline positions** — the same coordinate space as `data-start` — not offsets relative to the scene's start.

Navigation is seek-driven, not play-driven. The controller never starts playback just to move between fragments; each navigation command is a deterministic seek to the target hold time. Design fragment states so they are correct at the target timeline time.

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

`<hyperframes-slideshow>` provides the navigation chrome (Present, Prev / Next, counter, global mute when `sound` is present, fullscreen), keyboard handling (← / →, Space / Backspace, and P for Present), touch swipe, and hotspot overlays.

The slideshow automatically sets the `interactive` attribute on every inner `<hyperframes-player>` at mount time, so clickable controls, links, native media controls, and custom players inside the composition iframe receive pointer events as expected. (Outside a slideshow wrapper, you must add `interactive` manually on `<hyperframes-player>` — the player defaults to `pointer-events: none` on the iframe so clicks on the player host don't get hijacked into toggling timeline playback.)

**Presenter mode:** use the built-in Present icon button in the slideshow nav capsule, or press P. It calls `window.open('?mode=audience')` for a fullscreen audience tab; the originating tab becomes the presenter view (current slide reduced, next-slide preview, notes, elapsed timer). The two tabs sync via `BroadcastChannel('hf-slideshow:' + location.pathname)`. Do not add a custom wrapper-level Present button; the shared component owns its placement, icon, styling, and audience-mode hiding.

**Presenting over Google Meet / Zoom (screen share):** share the _audience_ surface, keep the presenter view on your own screen.

- **Google Meet (or any in-Chrome share):** Present → in Meet choose **Share screen → A tab** → pick the audience tab → switch back to the presenter tab. Chrome keeps a captured tab rendering while backgrounded, so animations and slide nav stay live. Do **not** share "A window" or "Entire screen" — a fully covered window stops rendering (frozen slides for viewers), and entire-screen exposes your notes.
- **Zoom (desktop app):** drag the audience tab out into its own window and share that window. Zoom captures via the OS, so if the audience window becomes _fully_ covered it freezes — use a second monitor, or keep a sliver of the audience window visible behind the presenter view.

Presenter-driven media playback has an autoplay-policy constraint: `BroadcastChannel` can sync intent, time, and state, but it cannot transfer the presenter's user activation to the audience tab. The shared slideshow player mirrors native media events and starts remote audience playback muted first; only fall back to the standalone harness's audience unlock behavior if muted `media.play()` is rejected or if the deck specifically requires audible audience playback. Do not keep applying remote `timeupdate` messages after a rejected play, or the audience will silently seek through the video without playback.

Presenter notes are editable in the presenter view. Edits are stored in `localStorage` per deck and slide, layered over the manifest notes without rewriting the composition file. Do not add one-off note-editing scripts to decks; rely on the shared slideshow player behavior. If a standalone/custom wrapper truly needs to implement this outside the shared player, use the deterministic storage snippet in `skills/slideshow/references/standalone-harness.md`.

### Media cleanup on slide exit

The slideshow controller owns slide-exit media cleanup. When navigation changes slide or sequence, it calls `hyperframes-player.stopMedia()` before entering the next slide. That command:

- posts `stop-media` to the iframe runtime, which stops WebAudio and pauses native `<video>` / `<audio>` elements;
- pauses same-origin iframe media directly as a fallback; and
- pauses parent-frame proxies adopted from iframe media.

Same-slide fragment navigation does **not** stop media. Global/deck-level parent audio, such as a background track wired through `audio-src`, is not treated as slide media.

Do not add per-slide cleanup scripts for normal media players. Keep slide video/audio as normal media in the composition; use `data-has-audio="true"` only when the player should preserve audible native video audio instead of treating it as silent visual media.

If the source page has custom controls or visualizations attached to media, those controls must listen to the same native element the slideshow player stops and mutes. A pause caused by slide exit, presenter sync, native controls, custom controls, or the global mute button should all update the visible custom UI through media events, not through parallel state.

When implementing direct iframe fallback cleanup, treat iframe media as cross-realm DOM. Do not test iframe nodes with the parent page's `el instanceof HTMLMediaElement`; that returns false in real browsers. Use `el.ownerDocument.defaultView.HTMLMediaElement` (or an equivalent tag/duck-type guard) before setting `muted` or calling `pause()`.

### Global nav mute

When `<hyperframes-slideshow sound>` renders the nav mute button, that button is the global mute control for the page. It must mute:

- child `<hyperframes-player>` instances, including same-origin iframe media;
- top-level page `<audio>` / `<video>` elements; and
- wrapper-owned SFX/global `Audio` objects via the `hf-sound` event.

Do not add a second mute button inside the composition. If a wrapper script creates `new Audio(...)` objects that are not attached to the DOM, it must listen for `hf-sound` and set `clip.muted = detail.muted` on each object, not merely skip future plays.

The same cross-realm rule applies here: global mute must reach iframe `<video>` / `<audio>` elements through the child frame's DOM realm. A passing unit test in a single DOM realm is not enough; verify in a browser that the actual iframe media elements report `muted: true` after clicking the nav mute button.

`hyperframes present` serves built bundles from `packages/player/dist`. After changing player or slideshow chrome behavior, run `bun run build` in `packages/player` and restart the present server before testing in a browser.

Presenter notes are editable in the presenter view. Edits are stored in `localStorage` per deck and slide, layered over the manifest notes without rewriting the composition file. Do not add one-off note-editing scripts to decks; rely on the shared slideshow player behavior. If a standalone/custom wrapper truly needs to implement this outside the shared player, use the deterministic storage snippet in `skills/slideshow/references/standalone-harness.md`.

### Media cleanup on slide exit

The slideshow controller owns slide-exit media cleanup. When navigation changes slide or sequence, it calls `hyperframes-player.stopMedia()` before entering the next slide. That command:

- posts `stop-media` to the iframe runtime, which stops WebAudio and pauses native `<video>` / `<audio>` elements;
- pauses same-origin iframe media directly as a fallback; and
- pauses parent-frame proxies adopted from iframe media.

Same-slide fragment navigation does **not** stop media. Global/deck-level parent audio, such as a background track wired through `audio-src`, is not treated as slide media.

Do not add per-slide cleanup scripts for normal media players. Keep slide video/audio as normal media in the composition; use `data-has-audio="true"` only when the player should preserve audible native video audio instead of treating it as silent visual media.

When implementing direct iframe fallback cleanup, treat iframe media as cross-realm DOM. Do not test iframe nodes with the parent page's `el instanceof HTMLMediaElement`; that returns false in real browsers. Use `el.ownerDocument.defaultView.HTMLMediaElement` (or an equivalent tag/duck-type guard) before setting `muted` or calling `pause()`.

### Global nav mute

When `<hyperframes-slideshow sound>` renders the nav mute button, that button is the global mute control for the page. It must mute:

- child `<hyperframes-player>` instances, including same-origin iframe media;
- top-level page `<audio>` / `<video>` elements; and
- wrapper-owned SFX/global `Audio` objects via the `hf-sound` event.

Do not add a second mute button inside the composition. If a wrapper script creates `new Audio(...)` objects that are not attached to the DOM, it must listen for `hf-sound` and set `clip.muted = detail.muted` on each object, not merely skip future plays.

The same cross-realm rule applies here: global mute must reach iframe `<video>` / `<audio>` elements through the child frame's DOM realm. A passing unit test in a single DOM realm is not enough; verify in a browser that the actual iframe media elements report `muted: true` after clicking the nav mute button.

`hyperframes present` serves built bundles from `packages/player/dist`. After changing player or slideshow chrome behavior, run `bun run build` in `packages/player` and restart the present server before testing in a browser.

---

## Running a slideshow standalone (interim)

The **durable answer** is engine-hosted: `hyperframes preview --slideshow` / studio present mode will host the composition over the real HyperFrames engine, which drives seek-timelines, owns the gesture frame, and reads the island from the composition. That path is coming; prefer it once it ships.

Until then, standalone demos (a composition opened via the bare player bundle in a browser, without the engine) require workarounds for three gaps: the composition must expose a seekable root timeline, the island must be duplicated into the wrapper, and wrapper-owned SFX/global audio should live in the parent frame. These patterns are documented in:

```
skills/slideshow/references/standalone-harness.md
```

Do not treat the patterns there as the blessed model — they exist only to bridge the gap until the engine-hosted path lands.

## Handoff

For a public or user-facing slideshow project, the root `index.html` should be a runnable slideshow entrypoint. Opening it in a browser should show slideshow navigation and respond to Next/Prev; it should not expose only the raw composition and require the user to know about Studio or an internal wrapper file. If the raw HyperFrames composition must remain separate for CLI compatibility, put it in a subdirectory such as `composition/index.html` and point scripts/commands at that directory.

The direct-open wrapper must rely on the built-in Present icon button rendered by `<hyperframes-slideshow>`. Do not add a bespoke `#present-btn`, fixed-position button, or wrapper-specific Present styling. The shared component owns the control bar, hides Present in `?mode=audience`, and supports P as a keyboard shortcut.

Validate the direct-open path before handoff. If `file://` browser restrictions break iframe media, local scripts, or same-origin player access, use a self-contained wrapper or make the handoff command start a local server and open the working URL; do not leave `index.html` in a broken or ambiguous state.

For a completed slideshow deck, the primary user-facing next step is presenter mode, not Studio. Run or provide:

```bash
npx hyperframes present <project-dir>
```

Studio/`preview` is useful for editing a composition, but it is not a clear final destination for a slideshow user. If you create a `package.json` for a slideshow project where the raw composition lives in `composition/`, make the default runnable script start presenter mode:

```json
{
  "scripts": {
    "dev": "npx hyperframes present ./composition",
    "studio": "npx hyperframes preview ./composition"
  }
}
```

At handoff, include the local presenter URL printed by the command and the minimal instruction: "Click Present, or press P, to open the audience tab." If the user will present over Google Meet or Zoom, also pass on the screen-share guidance from the Presenting section above (share the audience tab in Meet; a dragged-out audience window in Zoom). Keep the server running if the user asked you to start it.

---

## Validation

After authoring or editing a slideshow composition, run:

```bash
npx hyperframes lint
```

Then run runtime validation:

```bash
npx hyperframes validate
```

Treat lint errors and validation `StaticGuard` contract messages as blockers even if a command exits successfully. Fix the file and rerun until lint reports `0 error(s)` and validation reports no runtime errors.

The slideshow lint rule checks:

- Every `slide.sceneId` resolves to an existing scene (by `data-composition-id`).
- Every `hotspot.target` references a defined `slideSequence` id.
- Fragment times fall within each slide's `[start, end]` range.
- No two main-line slides overlap in time.

Fix all violations before previewing. A composition that fails lint will not parse correctly in the player.
