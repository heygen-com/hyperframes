---
name: launch-video
description: Build a high-energy launch/promo video using the billboard-per-beat pattern — one focus element per frame, fast cuts, distinct visual worlds per beat. Use when the user wants a polished launch video, product demo, trailer, or promo clip.
---

# Launch Video — Billboard-Per-Beat Pattern

Every frame is a billboard. One thing, all the attention, gone before you can get bored. Speed creates energy. The cut IS the transition.

## Core Principles

1. **One focus per beat.** A frame is not a webpage. You cannot read 8 things at once in video. Each beat shows ONE visual or ONE statement. Nothing else.

2. **Each beat gets its own visual world.** Different background, different color, different energy. Warm cream → dark terminal → pink accent → full-bleed image. No two consecutive beats should look alike.

3. **Speed creates urgency.** Most beats last 0.7–1.8 seconds. Category/keyword beats fire at 0.7s. Statements get 1.2–1.8s. Hold the close for 2–4s.

4. **Full-bleed images, not thumbnails.** One product screenshot filling the entire 1920×1080 frame says "this is real, this is quality" more than a grid of small cards ever will.

5. **The cut IS the transition.** No zooms, no blurs, no spatial travel between beats. `tl.set(el, { opacity: 1 })` on the new beat, `tl.set(prev, { opacity: 0 })` on the old. The contrast between beats creates the energy.

6. **Scale pulse on entry.** Every beat snaps in at 1.012× scale and eases to 1.0 in 0.25s. Invisible consciously, felt subconsciously.

7. **Motion is mandatory.** Subtle reads as static at 30fps. Every beat should have at least one moving element — a word rising into place, a gradient shifting, a scale settling.

## Architecture

### Stacked Beats

All beats are full-frame divs stacked at position (0,0). GSAP controls visibility via opacity.

```html
<div
  data-composition-id="launch"
  data-width="1920"
  data-height="1080"
  data-start="0"
  data-duration="36"
  style="position:relative; width:1920px; height:1080px;"
>
  <div class="beat dark" id="b01">
    <div class="serif mega-text">The Product</div>
  </div>
  <div class="beat warm" id="b02">
    <div class="serif mega-text italic indigo">is here.</div>
  </div>
  <div class="beat" id="b03">
    <img src="product-screenshot.png" style="width:100%;height:100%;object-fit:cover" />
  </div>
  <!-- ... more beats ... -->
</div>
```

```css
.beat {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  overflow: hidden;
}
```

### Beat Sequencing

The composition ID in `data-composition-id` MUST match the key in `window.__timelines`.

```javascript
(function () {
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });

  var beats = [
    { id: "b01", at: 0, dur: 1.8 }, // Statement
    { id: "b02", at: 1.8, dur: 1.0 }, // Emphasis
    { id: "b03", at: 2.8, dur: 0.9 }, // Full-bleed image
    // ...
  ];

  beats.forEach(function (b) {
    var el = document.getElementById(b.id);
    tl.set(el, { opacity: 1 }, b.at);
    gsap.set(el, { scale: 1.012 });
    tl.to(el, { scale: 1, duration: 0.25, ease: "power2.out" }, b.at);
    tl.set(el, { opacity: 0 }, b.at + b.dur);
  });

  // CRITICAL: register with the EXACT data-composition-id
  window.__timelines["launch"] = tl;
})();
```

## Beat Types

### Statement Beat (1.2–1.8s)

One sentence or phrase, giant serif/sans text, centered.

```css
.mega-text {
  font-size: 140px;
  letter-spacing: -0.04em;
}
```

### Image Beat (0.8–1.2s)

Full-bleed product screenshot or rendered block. No text overlay. The visual speaks.

### Number Beat (1.5–2.0s)

Giant statistic. "52" at 280px with a small label beneath.

### Step Beat (1.0–1.2s)

Numbered step. Giant monospace number + one-line description. One step per beat — NOT all steps on one frame.

### Category Beat (0.6–0.8s)

Single word, giant weight, accent color, tinted background. Fire rapidly.

### Command Beat (1.5–2.0s)

Terminal command in monospace. Dark background.

```
$ npx hyperframes add liquid-glass
```

### CTA Beat (3–4s, hold to end)

Logo, URL, or call-to-action. Sits on screen for the viewer to absorb.

## Visual Palette

Each beat should feel like a different world:

- **Warm editorial**: `radial-gradient(ellipse at 50% 45%, #fcf6e7, #f0e8d0)` + Instrument Serif
- **Dark terminal**: `radial-gradient(ellipse at 50% 40%, #14131f, #0c0c14)` + JetBrains Mono
- **Accent tints**: `radial-gradient(ellipse at 50% 50%, rgba(color, 0.08), #fdf8ee 70%)` + Inter Black
- **Full-bleed images**: product screenshots, no background needed

### Typography

- **Instrument Serif** — editorial headlines, thesis statements
- **Inter** — UI text, bold statements, categories (use weight 700-900)
- **JetBrains Mono** — terminal commands, step numbers, code

### Special Effects

- **Gradient shimmer** on key words: `background-clip: text` with sweeping `background-position`
- **Staggered check reveals**: each line slides in 0.15s apart
- **Scale pulse**: 1.012 → 1.0 on every beat entry

## Workflow

### 1. Plan the Beats

Write a beat sheet before touching HTML. One line per beat:

```
B01  1.8s  dark     "The HyperFrames Registry"
B02  1.0s  warm     "is open." (italic, indigo)
B03  0.9s  image    liquid-glass full-bleed
B04  0.9s  image    x-post full-bleed
...
```

### 2. Build the HTML

One `<div class="beat">` per beat. Keep each beat dead simple — one element.

### 3. Sequence with GSAP

Use the beats array pattern. Set opacity in/out, add scale pulse.

### 4. Generate Contact Sheet

Render, then extract frames at 3fps and montage into a review grid:

```bash
ffmpeg -i output.mp4 -vf "fps=3,scale=480:270" frame_%04d.png
montage frame_*.png -tile 10x -geometry 480x270+4+4 -background '#0a0a0a' contact-sheet.png
```

### 5. Review and Iterate

Check the contact sheet for:

- Any beat with more than one focus element (split it)
- Consecutive beats with similar backgrounds (change one)
- Beats that feel too long (shorten) or too short to read (lengthen)
- Dead frames (blank during transitions)

## Easing — The Motion Designer's Toolkit

Generic `power2.out` on everything is the hallmark of AI-generated video. Pro motion designers choose easing per intent.

### When to Cut vs When to Ease

- **Hard cuts** for impact moments: image reveals, category rapid-fire, scene changes. No easing — `tl.set()`.
- **Tuned easing** for build-up sequences: numbered steps accumulating, checkmarks appearing, words assembling a sentence. The motion tells the story.

### Easing Vocabulary

| Intent            | GSAP Ease                | Feel                                                             |
| ----------------- | ------------------------ | ---------------------------------------------------------------- |
| Snap (iOS-like)   | `power4.out`             | Fast start, crisp stop. Hero text landing.                       |
| Whip overshoot    | `back.out(1.7)`          | Overshoots target, settles. Numbers, badges.                     |
| Soft land         | `expo.out`               | Very fast start, long gentle tail. Per-word text reveals.        |
| Mechanical        | `power1.out` or `"none"` | Linear feel. Terminal text, code typing.                         |
| Bounce settle     | `elastic.out(1, 0.5)`    | Spring bounce. Stats, counters, CTA pills.                       |
| Dramatic entrance | `expo.inOut`             | Slow start, explosive middle, soft land. Full-screen statements. |
| Subtle drift      | `"none"`                 | Constant speed. Background parallax, camera drift.               |

### Applying Per Beat Type

```javascript
// Statement beats — dramatic entrance
tl.from(text, { y: 60, opacity: 0, duration: 0.5, ease: "expo.out" }, t);

// Number beats — whip overshoot for impact
tl.from(num, { scale: 0.5, opacity: 0, duration: 0.4, ease: "back.out(1.7)" }, t);

// Step beats — snap in from left, stagger builds tension
tl.from(step, { x: -40, opacity: 0, duration: 0.3, ease: "power4.out" }, t + i * 0.12);

// Check beats — mechanical typewriter feel
tl.from(check, { x: -15, opacity: 0, duration: 0.15, ease: "power1.out" }, t + i * 0.2);

// Category rapid-fire — no easing, hard set for speed
tl.set(cat, { opacity: 1, scale: 1.012 }, t);

// CTA pill — bounce settle, last thing viewer sees
tl.from(pill, { scale: 0.8, opacity: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" }, t);
```

### Scale Pulse Variations

Not every beat gets the same pulse. Match the scale to the energy:

```javascript
// Impact beats: larger pulse (1.03)
gsap.set(el, { scale: 1.03 });
tl.to(el, { scale: 1, duration: 0.2, ease: "power4.out" }, t);

// Statement beats: standard pulse (1.012)
gsap.set(el, { scale: 1.012 });
tl.to(el, { scale: 1, duration: 0.25, ease: "power2.out" }, t);

// Quiet beats: no pulse, gentle fade
tl.from(el, { opacity: 0, duration: 0.3, ease: "power1.out" }, t);
```

## Anti-Patterns

| Mistake                             | Fix                                                         |
| ----------------------------------- | ----------------------------------------------------------- |
| Grid of cards                       | One card per beat, full-bleed                               |
| Multi-step layout                   | One step per beat                                           |
| Slow camera pan between scenes      | Instant cut with scale pulse                                |
| Blur/zoom transitions eating frames | Every frame is content                                      |
| Same font/color across beats        | Each beat gets its own world                                |
| Dense info layout                   | If you can't read it in 1s, split it                        |
| Unrelated placeholder images        | Image beats must show YOUR product, not generic screenshots |

## Checklist

- [ ] Beat sheet written before HTML
- [ ] One focus element per beat — no exceptions
- [ ] No two consecutive beats share the same background
- [ ] Full-bleed images for product shots (not thumbnails)
- [ ] Scale pulse (1.012→1.0) on every beat entry
- [ ] Contact sheet generated and reviewed
- [ ] No dead/blank frames between beats
- [ ] First beat has `style="opacity:1"` inline (GSAP `set` at t=0 can miss frame 0)
- [ ] CTA beat holds for 3+ seconds at the end
- [ ] Deterministic — no Math.random(), no Date.now()
- [ ] Paused timeline registered to `window.__timelines`
