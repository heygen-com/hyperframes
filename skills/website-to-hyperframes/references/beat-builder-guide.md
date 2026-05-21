# Beat Builder Guide

You are building ONE beat of a multi-beat video composition. This file tells you what to read, how to build, how to verify, and how to report back.

## Step 1: Read and understand

**Required (every beat):**

1. **Load the `hyperframes` skill** — composition rules, data attributes, timeline contract, deterministic rendering. Read the whole skill.
2. **[capabilities.md](capabilities.md)** — full inventory of HyperFrames capabilities (24 sections). Read the Table of Contents first, then deep-dive sections your beat needs.
3. **The beat spec** the main agent gave you — concept, choreography, assets, brand values, timing.

**Read based on what your beat needs (pick relevant ones):**

| Resource                                                                              | What it covers                                                                                                                | Read when                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [techniques.md](../../hyperframes/references/techniques.md)                           | 13 primitive animation techniques: SVG path drawing, Canvas 2D, CSS 3D, kinetic type, variable fonts, MotionPath, etc.        | Beat uses any of these techniques                 |
| [text-effects.md](../../hyperframes/references/text-effects.md)                       | 24 named text animations: soft-blur-in, typewriter, kinetic-center-build, line-reveal, stagger, crossfade, shared-axis        | Beat has text animation                           |
| [html-in-canvas-patterns.md](../../hyperframes/references/html-in-canvas-patterns.md) | HTML-in-Canvas: iPhone/MacBook mockups, liquid glass, magnetic, portal, shatter, text cursor                                  | Beat uses device mockups or WebGL effects on HTML |
| [transitions.md](../../hyperframes/references/transitions.md)                         | Shader transition API, HyperShader.init() pattern, all 14 WebGL shaders                                                       | Beat has shader transitions                       |
| [transitions/](../../hyperframes/references/transitions/)                             | 14 CSS transition category files: push, scale, dissolve, blur, 3D flip, light leak, distortion, grid, mechanical, destruction | Beat uses CSS transitions                         |
| [css-patterns.md](../../hyperframes/references/css-patterns.md)                       | Text markers: highlight sweeps, hand-drawn circles, burst lines, scribble, sketchout                                          | Beat uses text emphasis/markers                   |
| [audio-reactive.md](../../hyperframes/references/audio-reactive.md)                   | Bass→scale, mid→shape, treble→glow mappings                                                                                   | Beat reacts to music/audio                        |
| [captions.md](../../hyperframes/references/captions.md)                               | Per-word karaoke, tone-adaptive styling, positioning                                                                          | Beat includes captions                            |
| [typography.md](../../hyperframes/references/typography.md)                           | Font hierarchy, variable fonts, responsive type scaling                                                                       | Beat has complex typography                       |
| [motion-principles.md](../../hyperframes/references/motion-principles.md)             | Velocity matching, easing philosophy, motion continuity                                                                       | Beat needs polished motion design                 |
| [dynamic-techniques.md](../../hyperframes/references/dynamic-techniques.md)           | Counter animations, data-driven visuals, dynamic content                                                                      | Beat has counters or data visualization           |
| [video-composition.md](../../hyperframes/references/video-composition.md)             | Frame composition, color presence, scale, density rules                                                                       | General composition quality                       |

**Other skills you can load if needed:**

- `/gsap` or `/gsap-core`, `/gsap-timeline`, `/gsap-plugins` — deeper GSAP reference
- `/animate-text` — curated text animation catalog with exact JSON specs
- `/hyperframes-registry` — if you need to install and wire registry blocks
- `/hyperframes-contrast` — audit color contrast (WCAG)
- `/lottie`, `/three`, `/waapi`, `/animejs`, `/css-animations` — if beat uses these engines

**Always open the captured assets folder before designing the beat:**

- `capture/assets/svgs/` — brand logos, icons, decorative marks. SVGs are infinitely scalable and stroke-animatable (path drawing, dash offset). A logo SVG drawing itself onto frame can carry an entire beat.
- `capture/assets/` — hero illustrations, screenshots, product art, gradients, photography. These are first-class beat subjects, not background decoration. A breathing hero illustration with a single line of kinetic type is a complete shot.
- VIEW every image before placing text on it. Check safe zones, contrast, actual content, where the focal point sits.

**If your beat spec names a captured asset, USE it.** Don't substitute a CSS recreation. The user captured these from the real brand site precisely so the video carries the brand's actual visual identity.

## Step 2: Build the composition

Save to the path the main agent specified (usually `compositions/beat-N-name.html`).

```html
<template>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    /* your styles */
  </style>

  <div
    id="beat-N-name"
    data-composition-id="beat-N-name"
    data-width="1920"
    data-height="1080"
    style="width:1920px; height:1080px; position:relative; overflow:hidden; background:#YOUR_BG;"
  >
    <!-- your elements -->
  </div>

  <script>
    (function () {
      var BEAT = 5.5; // MUST match data-duration on the host div in index.html
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });

      // your GSAP animations

      window.__timelines["beat-N-name"] = tl;
    })();
  </script>
</template>
```

**Critical:** `data-composition-id`, `data-width`, `data-height` on the root div MUST match the host div in index.html.

## Step 3: Lint

```bash
npx hyperframes lint .
```

Fix ALL errors. Zero errors required.

## Step 4: Snapshot and verify

```bash
npx hyperframes snapshot . --frames 3
```

**READ the contact sheet** (`snapshots/contact-sheet.jpg`). For each frame:

- Is content visible? (not black, blank, or loading)
- Is text readable, properly positioned, correct font/color?
- Are assets at the right size and position?
- Does the animation state match the beat spec at this timestamp?

**If anything is wrong:** fix, re-snapshot, re-check. You are done ONLY when every frame matches the spec.

## Step 5: Report back honestly

After lint passes, snapshots are taken, and you've fixed every issue you saw — report back to the main agent with concrete observations. Not "0 errors, looks good." That phrasing is what got prior videos shipped with mismatched brand colors, missing logos, and headlines too small to read.

**The main agent will OPEN your composition file and read it top-to-bottom** to cross-check against DESIGN.md and STORYBOARD.md — does the brand bg/accent hex actually appear in your CSS, are the captured assets the storyboard called for actually referenced, is the headline ≥80px, does the GSAP timeline cover the full beat duration. You cannot pass that check by claiming things you didn't do; the file is on disk, the truth is in the file.

So in your report, name the hex codes you used, the captured asset paths you placed, the headline `font-size`, and the GSAP timeline's last `tl.fromTo(...)` timestamp. Brief, concrete, true. If anything diverges from DESIGN.md or the storyboard, say so explicitly — the main agent can decide whether to accept the divergence or send you back to fix it. Surprises caught at this hand-off cost minutes; surprises caught at Step 6 cost iterations.

---

## Continuous motion — the most important rule

A beat is a SHOT in a film, not a webpage with entrance animations. Your GSAP timeline should have events spread across the ENTIRE beat duration — not just entrance tweens in the first 1-2 seconds followed by nothing. If an element is on screen, it should be doing something. After elements enter, add continuous hold motion: camera dolly, parallax layers moving at different speeds, secondary elements appearing mid-beat, real depth shifts.

## You are building a SHOT, not a webpage

The storyboard tells you the shot framing (close-up / medium / wide / etc.) and the camera move. Implement them. A beat is a moment, not a screenshot. The distinction is **what the camera is doing**, not whether the subject is a UI element or a logo — a tight push-in on a real product screenshot is a shot; a centered card on a parked camera is a webpage.

**Patterns that turn a shot back into a webpage:**

These are defaults to avoid, **not absolute prohibitions.** If the storyboard genuinely calls for "the kanban app interface" or "the browser chrome" as the subject of a specific beat (a product tour, a "this is how it works" demo, a stylized window mockup for the closer), then build it. The rule is: don't reach for these patterns by default when the storyboard didn't ask for them.

- ⚠ **macOS / browser window chrome reproduced in CSS** — traffic-light dots, URL bars, browser tabs. Fine when the storyboard makes the chrome the subject (e.g. "stylized macOS window framing the product UI" for a closer). NOT fine when it's a frame you added around a card "to make it look like an app."
- ⚠ **Full webpage layout** (sidebar + header + footer + main content area) — fine when the beat is genuinely a product tour shot. NOT fine when the beat was supposed to be about _the kanban moment_ and you defaulted to drawing the whole app around it.
- ❌ **Parked-camera composition** — centered card with 60–120px margins on all sides and no camera move. Almost always wrong. Either give it a real push-in / dolly / parallax, or reframe.
- ❌ **"Hold with breathing"** implemented as `y: ±1–2px` or `scale: 1.01` — invisible at 1920×1080+ scale. If continuous motion is required, use camera dolly (scale 1.0 → 1.05), parallax pan (x/y ±30–80px), or progressive reveals.
- ❌ **Hover-state simulations** — videos have no hover. If the brand uses hover effects, show the BEFORE and AFTER as discrete frames in the timeline.
- ❌ **Counter pulses + dot pulses + tiny scale wobbles** as the only motion during the hold — these are "I ran out of ideas" filler.

The test: if the storyboard says _"this beat is the product tour, viewer sees the app interface"_, building a CSS dashboard with chrome is correct. If the storyboard says _"this beat is the kanban moment, single card sliding home"_, drawing the full app around it is wrong. Read the beat spec carefully.

**Patterns that ARE shots (do these freely):**

- ✅ **Captured SVG logo drawing itself stroke-by-stroke** (DrawSVG / path dashoffset) — a complete opener or stinger.
- ✅ **Captured hero illustration with camera dolly** — push-in from 1.0 → 1.08 over 4s, focal element holds frame.
- ✅ **Captured product screenshot with parallax layers** — separate the foreground UI from background panels and move them at different speeds, or use HTML-in-Canvas for an iPhone/MacBook mockup.
- ✅ **Captured asset as the bed, kinetic type as the punchline** — the brand's hero image holds the frame while a one-line message arrives, splits, reflows.
- ✅ **Composed-from-divs UI moment** when the beat is specifically about that UI's interaction (a card sliding into a column, a search result resolving) — this is the legit case for CSS-only composition.

**Required motion magnitudes** (anything smaller is invisible at video scale):

| Motion type     | Minimum magnitude                           |
| --------------- | ------------------------------------------- |
| Translate (y/x) | 30px (entrance) / 8px (drift during hold)   |
| Scale           | 0.05 change (1.0 → 1.05 or larger)          |
| Opacity         | full 0 → 1 or vice versa for reveals        |
| Rotate          | 4° minimum to read (Dutch angles, ticks)    |
| Camera dolly    | scale 1.0 → 1.06 minimum over beat duration |

**Required cinematography per beat** (the storyboard should give you these; if it doesn't, escalate):

- A **shot type** (close-up / medium / wide / over-the-shoulder / Dutch)
- A **camera move** (dolly in/out, push, parallax pan, orbit, rack focus)
- A **depth strategy** (what's foreground / midground / background)
- A **purpose** (what specific feeling or noticing the shot delivers)

If any are missing from the beat spec, the beat is under-defined. Don't fill the gap with "centered layout + breathing" — re-read the spec, and if it's genuinely missing, ask the main agent.

## Rules

- SCRIPT PLACEMENT: scripts inside `<template>`, never after `</template>`. Scripts outside see no DOM.
- GSAP FROM TRAP: never `gsap.from(el, {opacity:0})` with CSS `opacity:0`. It animates 0→0. Use `tl.fromTo()`.
- STYLE: avoid CSS `opacity:0` on GSAP-animated elements. Use GSAP fromTo for initial states.
- ASSET PATHS: project-root-relative. `capture/assets/file.png` ✅ `../capture/assets/file.png` ❌
- SVG VIA IMG: `<img src="logo.svg">` can't inherit CSS color. Inline SVG or `filter: brightness(0) invert(1)`.
- CSS CENTERING: no `transform: translate(-50%, -50%)` with GSAP transforms. Use flexbox or `xPercent/yPercent`.
- QUERYSELECTOR: `document.getElementById("id")` with null guards. No method calls without null check.
- CHARACTER SPANS: `display:inline-block` on spaces collapses them. Use `&nbsp;` or per-word spans.
- COUNTERS: no `onUpdate` callbacks. Discrete `tl.set(el, {textContent: "42"}, 2.5)` at timestamps.
- TIMELINE: `window.__timelines["beat-N-name"] = tl` synchronously. Key = `data-composition-id`.
- DETERMINISTIC: no `Math.random()`, `Date.now()`, `requestAnimationFrame`, `repeat:-1`.
- Always `tl.fromTo()` not `tl.from()` for entrances.
- Never stack two transform tweens on same element at same time.
- FONTS: copy the `@font-face` block VERBATIM from DESIGN.md's Fonts section. Do NOT guess which `.woff2` file belongs to which family — capture filenames are content-hashed (`14d7ce3e41dcbb66-s.p.woff2`) and there is no visible mapping. If DESIGN.md doesn't include exact `src:` paths per family, STOP and ask the main agent to add them; never pair an arbitrary `.woff2` file with a family name from memory.

## Easing — pick per intent

Do NOT default to `power2.out` on everything.

| Intent          | GSAP Ease             | Use for                              |
| --------------- | --------------------- | ------------------------------------ |
| Snap (iOS feel) | `power4.out`          | Hero text, UI elements               |
| Whip overshoot  | `back.out(1.7)`       | Numbers, badges, impact              |
| Soft land       | `expo.out`            | Per-word reveals, gentle entrances   |
| Mechanical      | `power1.out`          | Terminal text, code typing           |
| Bounce settle   | `elastic.out(1, 0.5)` | Counters, CTA buttons                |
| Dramatic        | `expo.inOut`          | Full-screen statements, hero reveals |
| Drift           | `"none"`              | Parallax, Ken Burns, camera drift    |

Staggered items: `power4.out` with `stagger: 0.08` to `0.15`.
