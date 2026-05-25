# Motion Principles

## Common defaults that produce monoculture

These are the patterns LLMs reach for without thinking. None of them are wrong in isolation — they're wrong as defaults. If every scene of every video lands on the same easing, the same speed, and the same entrance direction, the compositions blur into one another no matter what the brand is.

- **Same ease on every tween.** `power2.out` is the most common default. Aim for variety: no more than two independent tweens sharing an ease within a scene. Eases are like font weights — vary them deliberately.
- **Same speed on every tween.** 0.4–0.5s is a common default that flattens rhythm. The slowest motion in a scene should be roughly 3× slower than the fastest. Vary duration so the eye can tell what's important.
- **Same entrance direction.** `y: 30, opacity: 0` is the universal LLM entrance. The same scene can use entrances from left, from right, from scale, from blur, opacity-only, letter-spacing — each one says something different about the element.
- **Same stagger across scenes.** Each scene should have its own rhythm. A 0.08s stagger in beat 1 and a 0.15s stagger in beat 2 makes the two beats feel like different moments.
- **Ambient zoom on every scene.** Slow-scale-up is the default ambient motion and it telegraphs "LLM-generated video." Vary the ambient motion per scene: slow pan, subtle rotation, color temperature shift, gentle drift — and sometimes nothing. Stillness after motion has real weight.
- **First animation at t=0.** Zero-delay feels like a jump cut. Offset the opening 0.1–0.3s so the scene reads as composed rather than thrown together.

## Easing is emotion, not technique

The motion is the verb. The easing is the adverb. A slide-in with `expo.out` feels confident. With `sine.inOut`, dreamy. With `elastic.out`, playful. Same motion, three different meanings. Choose the adverb deliberately.

**Direction rules:**

- `.out` for elements entering. Starts fast, decelerates. Feels responsive. This is the default for entrances.
- `.in` for elements leaving. Starts slow, accelerates away. Sends them off with momentum.
- `.inOut` for elements moving between positions, neither entering nor leaving the scene.

Ease-in on an entrance feels sluggish. Ease-out on an exit feels reluctant. These are the most common reversals and they're worth checking your work against.

## Speed expresses weight

Duration is one of the most direct ways a composition communicates what it values. Faster motion reads as confident, urgent, kinetic — it gives the viewer less time to study what's happening, which means the work has to land in fewer frames. Slower motion reads as deliberate, considered, weighty — the viewer has time to take in the element, which means each element has to earn that attention.

Useful calibration ranges (not prescriptions — what a duration _expresses_ depends on what surrounds it):

- **0.15–0.3s** — quick, percussive, kinetic. The motion reads as something happening _to_ the frame.
- **0.3–0.5s** — comfortable, professional. The motion reads as composed and reliable.
- **0.5–0.8s** — deliberate. The motion has visible weight and asks for attention.
- **0.8s+** — atmospheric. The motion becomes part of what the scene _is_, not something happening within it.

A composition that uses only one of these ranges feels one-note. Mix them — a scene where the headline takes 0.7s to settle and the supporting details land in 0.25s creates contrast that reinforces hierarchy without needing different colors or sizes.

## Scene structure: build, breathe, resolve

Every scene has three phases. The most common failure is dumping everything into the build and leaving nothing for the other two.

- **Build (0–30%)** — elements enter, staggered. Not all at once.
- **Breathe (30–70%)** — content visible, alive with one ambient motion. The viewer reads, registers, settles.
- **Resolve (70–100%)** — exit or decisive end. Exits are faster than entrances (see Asymmetry below).

A scene that's all build feels like a slideshow. A scene with no breathe phase doesn't let the content land.

## Transitions carry meaning

The transition type tells the viewer how two scenes relate:

- **Crossfade** — "this continues." Connective tissue between related ideas.
- **Hard cut** — "wake up" or a register shift. Disruption, surprise, percussive emphasis.
- **Slow dissolve** — "drift with me." Atmospheric, meditative, between-thoughts.

Crossfade is the default and it's defensible most of the time. The thing to watch for is using it for everything — when every transition is a crossfade, the viewer stops registering scene changes as meaningful. Hard cuts and slow dissolves are tools for the moments where the change in scene _is_ the message.

## Choreography is hierarchy

The element that moves first is perceived as most important. Stagger in order of importance, not DOM order. Don't wait for one entrance to complete before starting the next — overlap entries. Total stagger sequence under 500ms regardless of item count keeps the scene from feeling like a slow drip.

## Asymmetry between entrances and exits

Entrances need longer than exits. A card might take 0.4s to appear but 0.25s to disappear — entrances build presence, exits remove it, and remove takes less time than build.

## Visual composition

Video frames are not web pages. Web layout patterns that work on a scrollable page often look broken in a fixed-frame composition.

- **Two focal points minimum per scene.** The eye needs somewhere to travel. A single text block floating in empty space reads as unfinished.
- **Fill the frame.** Hero text typically wants 60–80% of frame width. Web type sizes — 16px body, 32px headlines — disappear at video distance.
- **Three layers minimum.** Background treatment (glow, oversized faded type, color panel), foreground content, accent elements (dividers, labels, data bars). A scene with only one layer reads flat.
- **Background is not empty.** Radial glows, oversized faded type bleeding off-frame, subtle border panels, hairline rules. Pure solid `#000` reads as "nothing loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom. Centered-and-floating is a web pattern that looks lost on a 16:9 canvas.
- **Split frames.** Data panel on the left, content on the right. Top bar with metadata, full-width below. Zone-based layouts beat centered stacks.
- **Use structural elements.** Rules, dividers, border panels. They create paths for the eye and animate well (`scaleX` from 0).

## Image motion treatment

Embedded images shouldn't sit flat — every image earns some motion treatment:

- **Perspective tilt** — `gsap.set(el, { transformPerspective: 1200, rotationY: -8 })` plus a `box-shadow` creates depth. Do NOT use CSS `transform: perspective(...)`; GSAP will overwrite it.
- **Slow zoom (Ken Burns)** — GSAP `scale: 1` → `1.04` over beat duration. Makes photos feel cinematic rather than pasted in.
- **Device frame** — wrap in a laptop or phone shape using `border-radius` and `box-shadow`.
- **Floating UI** — extract a key element and animate it at a different z-depth for parallax.
- **Scroll reveal** — clip the image to a viewport window and animate `y` position.

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

- **Hard-kill every scene boundary, not just captions.** The same hard-kill pattern from `captions.md` generalizes to all elements with exit animations: any element whose visibility changes at a beat boundary needs a deterministic `tl.set()` kill after its fade, because later tweens on the same element (or `immediateRender` from a sibling tween) can resurrect it. Apply to every element with an exit animation:

  ```js
  tl.to(el, { opacity: 0, duration: 0.3 }, beatEnd);
  tl.set(el, { opacity: 0, visibility: "hidden" }, beatEnd + 0.3); // deterministic kill
  ```

These are the exact rules with the exact code examples — don't summarize or shorten them. They exist because compositions that lint clean still ship broken without them.
