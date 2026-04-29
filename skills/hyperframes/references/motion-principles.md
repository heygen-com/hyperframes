# Motion Principles

## Guardrails

You know these rules but you violate them. Stop.

- **Don't use the same ease on every tween.** You default to `power2.out` on everything. Vary eases like you vary font weights — no more than 2 independent tweens with the same ease in a scene.
- **Don't use the same speed on everything.** You default to 0.4-0.5s for everything. The slowest scene should be 3× slower than the fastest. Vary duration deliberately.
- **Don't enter everything from the same direction.** You default to `y: 30, opacity: 0` on every element. Vary: from left, from right, from scale, opacity-only, letter-spacing.
- **Don't use the same stagger on every scene.** Each scene needs its own rhythm.
- **Don't use ambient zoom on every scene.** Pick different ambient motion per scene: slow pan, subtle rotation, scale push, color shift, or nothing. Stillness after motion is powerful.
- **Don't start at t=0.** Offset the first animation 0.1-0.3s. Zero-delay feels like a jump cut.

## What You Don't Do Without Being Told

### Easing is emotion, not technique

The transition is the verb. The easing is the adverb. A slide-in with `expo.out` = confident. With `sine.inOut` = dreamy. With `elastic.out` = playful. Same motion, different meaning. Choose the adverb deliberately.

**Direction rules — these are not optional:**

- `.out` for elements entering. Starts fast, decelerates. Feels responsive. This is your default.
- `.in` for elements leaving. Starts slow, accelerates away. Throws them off.
- `.inOut` for elements moving between positions.

You get this backwards constantly. Ease-in for entrances feels sluggish. Ease-out for exits feels reluctant.

### Speed communicates weight

- Fast (0.15-0.3s) — energy, urgency, confidence
- Medium (0.3-0.5s) — professional, most content
- Slow (0.5-0.8s) — gravity, luxury, contemplation
- Very slow (0.8-2.0s) — cinematic, emotional, atmospheric

### Scene structure: build / breathe / resolve

Every scene has three phases. You dump everything in the build and leave nothing for breathe or resolve.

- **Build (0-30%)** — elements enter, staggered. Don't dump everything at once.
- **Breathe (30-70%)** — content visible, alive with ONE ambient motion.
- **Resolve (70-100%)** — exit or decisive end. Exits are faster than entrances.

### Transitions are meaning

- **Crossfade** = "this continues"
- **Hard cut** = "wake up" / disruption
- **Slow dissolve** = "drift with me"

You crossfade everything. Use hard cuts for disruption and register shifts.

### Choreography is hierarchy

The element that moves first is perceived as most important. Stagger in order of importance, not DOM order. Don't wait for completion — overlap entries. Total stagger sequence under 500ms regardless of item count.

### Asymmetry

Entrances need longer than exits. A card takes 0.4s to appear but 0.25s to disappear.

## Visual Composition

You build for the web. Video frames are not pages.

- **Two focal points minimum per scene.** The eye needs somewhere to travel. Never a single text block floating in empty space.
- **Fill the frame.** Hero text: 60-80% of width. You will try to use web-sized elements. Don't.
- **Three layers minimum per scene.** Background treatment (glow, oversized faded type, color panel). Foreground content. Accent elements (dividers, labels, data bars).
- **Background is not empty.** Radial glows, oversized faded type bleeding off-frame, subtle border panels, hairline rules. Pure solid #000 reads as "nothing loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom. Centered-and-floating is a web pattern.
- **Split frames.** Data panel on the left, content on the right. Top bar with metadata, full-width below. Zone-based layouts, not centered stacks.
- **Use structural elements.** Rules, dividers, border panels. They create paths for the eye and animate well (scaleX from 0).

## Image Motion Treatment

Never embed a raw flat image. Every image must have motion treatment:

- **Perspective tilt**: use `gsap.set(el, { transformPerspective: 1200, rotationY: -8 })` + `box-shadow` — creates depth. Do NOT use CSS `transform: perspective(...)` as GSAP will overwrite it.
- **Slow zoom (Ken Burns)**: GSAP `scale: 1` → `1.04` over beat duration — makes photos cinematic
- **Device frame**: Wrap in a laptop/phone shape using CSS `border-radius` and `box-shadow`
- **Floating UI**: Extract a key element and animate it at a different z-depth for parallax
- **Scroll reveal**: Clip the image to a viewport window and animate `y` position

## Load-Bearing GSAP Rules

Rules below came out of two independent website-to-hyperframes builds (2026-04-20) where compositions lint-clean and still ship broken — elements that never appear, ambient motion that doesn't scrub, entrance tweens that silently kill their target. The linter cannot catch these; the rules must be followed by the author.

- **No iframes for captured content.** Iframes do not seek deterministically with the timeline — the capture engine cannot scrub inside them, so they appear frozen (or blank) in the rendered output. If the source you're stylizing is a live web app, use the screenshots from `capture/` as stacked panels or layered images, not live embeds.

- **Never stack two transform tweens on the same element.** A common failure: a `y` entrance plus a `scale` Ken Burns on the same `<img>`. The second tween's `immediateRender: true` writes the element's initial state at construction time, overwriting whatever the first tween set — leaving the element invisible or offscreen with no lint warning. A secondary mechanism: `tl.from()` resets to its declared "from" state when the playhead is seeked past the timeline's end, so an element that looked correct in linear playback vanishes in the capture engine's non-linear seek. Fix one of two ways:

  ```html
  <!-- BAD: two transforms on one element -->
  <img class="hero" src="..." />
  <script>
    tl.from(".hero", { y: 50, opacity: 0, duration: 0.6 }, 0);
    tl.to(".hero", { scale: 1.04, duration: beat }, 0); // kills the entrance
  </script>

  <!-- GOOD option A: combine into one tween -->
  <script>
    tl.fromTo(
      ".hero",
      { y: 50, opacity: 0, scale: 1.0 },
      { y: 0, opacity: 1, scale: 1.04, duration: beat, ease: "none" },
      0,
    );
  </script>

  <!-- GOOD option B: split across parent + child -->
  <div class="hero-wrap"><img class="hero" src="..." /></div>
  <script>
    tl.from(".hero-wrap", { y: 50, opacity: 0, duration: 0.6 }, 0); // entrance on parent
    tl.to(".hero", { scale: 1.04, duration: beat }, 0); // Ken Burns on child
  </script>
  ```

- **Prefer `tl.fromTo()` over `tl.from()` inside `.clip` scenes.** `gsap.from()` sets `immediateRender: true` by default, which writes the "from" state at timeline construction — before the `.clip` scene's `data-start` is active. Elements can flash visible, start from the wrong position, or skip their entrance entirely when the scene is seeked non-linearly (which the capture engine does). Explicit `fromTo` makes the state at every timeline position deterministic:

  ```js
  // BRITTLE: immediateRender interacts badly with scene boundaries
  tl.from(el, { opacity: 0, y: 50, duration: 0.6 }, t);

  // DETERMINISTIC: state is defined at both ends, no immediateRender surprise
  tl.fromTo(el, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.6 }, t);
  ```

- **Ambient pulses must attach to the seekable `tl`, never bare `gsap.to()`.** Auras, shimmers, gentle float loops, logo breathing — all of these must be added to the scene's timeline, not fired standalone. Standalone tweens run on wallclock time and do not scrub with the capture engine, so the effect is absent in the rendered video even though it looks correct in the studio preview:

  ```js
  // BAD: lives outside the timeline, never renders in capture
  gsap.to(".aura", { scale: 1.08, yoyo: true, repeat: 5, duration: 1.2 });

  // GOOD: seekable, deterministic, renders
  tl.to(".aura", { scale: 1.08, yoyo: true, repeat: 5, duration: 1.2 }, 0);
  ```

- **Hard-kill every scene boundary, not just captions.** The caption hard-kill rule above generalizes: any element whose visibility changes at a beat boundary needs a deterministic `tl.set()` kill after its fade, because later tweens on the same element (or `immediateRender` from a sibling tween) can resurrect it. Apply to every element with an exit animation:

  ```js
  tl.to(el, { opacity: 0, duration: 0.3 }, beatEnd);
  tl.set(el, { opacity: 0, visibility: "hidden" }, beatEnd + 0.3); // deterministic kill
  ```

These are the exact rules with the exact code examples — don't summarize or shorten them. They exist because compositions that lint clean still ship broken without them.
