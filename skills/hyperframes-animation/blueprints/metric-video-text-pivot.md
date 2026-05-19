---
id: metric-video-text-pivot
role: metric
duration_seconds: [5, 8]
phases: 4
visual_arc: video-center → video-slides-aside → text-typing → stat-reveal
uses_rules: [3d-text-depth-layers, sine-wave-loop]
element_roles:
  video: Product demo video that starts centered, then slides to make room for text
  typing_text: Character-by-character typed text, often with accent-colored keywords
  stat: Giant metric label with 3D depth layers (e.g., "MP4")
  pill: Gradient background pill that scales in behind a key phrase
when_to_use:
  - Scene transitions from showing a feature to stating its impact
  - Metric needs dramatic typographic treatment, not just a number overlay
  - Video provides context, text provides the "so what" payoff
  - Pivot from visual demonstration to textual impact statement
when_not_to_use:
  - Video should remain the focal point throughout
  - Stats are secondary information (use overlay)
  - Scene is purely typographic with no video
triggers:
  [
    accuracy rate,
    engagement increase,
    show feature then stat,
    video moves aside,
    big number reveal,
    metric emphasis,
  ]
---

# Metric · Video Text Pivot (HyperFrames)

Product video centered → video slides left → giant stat appears on the right → both exit left → kinetic text types in the center → gradient pill scales behind a closing phrase.

This blueprint is the HyperFrames port of the Remotion `video-kinetic-text-pivot` choreography. Same four-phase "show → tell with impact" arc; one paused GSAP timeline; constituent patterns map to [3d-text-depth-layers](../rules/3d-text-depth-layers.md) and [sine-wave-loop](../rules/sine-wave-loop.md) (for video idle float). Accent words use static CSS color (no per-frame glow envelope).

## When to Use

- Scene has two narrative beats: "see the feature" then "see the impact"
- A product video should establish context before giving way to text
- The stat/metric needs dramatic, frame-filling typographic treatment
- The video doesn't disappear permanently — it slides aside to maintain context, then exits when the stat takes over

## Phase Pipeline

All boundaries are in **seconds** (ASR-driven in the original).

| Phase | Time window (s)             | What Happens                                                                                                   | Skill Reference                                            |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | `0 – slideAt`               | Video enters centered with 3D tilt, floats gently                                                              | inline tilt + [sine-wave-loop](../rules/sine-wave-loop.md) |
| 2     | `slideAt – typingStart`     | Video slides left to ~29% of viewport width; stat appears on right with 3D depth layers + breathing            | [3d-text-depth-layers](../rules/3d-text-depth-layers.md)   |
| 3     | `typingStart – pillTrigger` | Both video and stat exit left; kinetic text types center-screen with accent-colored keywords + blinking cursor | inline typing with static CSS accent classes               |
| 4     | `pillTrigger – end`         | Gradient pill scales in behind a closing phrase (e.g. "frame by frame.") with glow halo                        | inline pill scale                                          |

The Remotion source ties `slideAt`, `typingStart`, etc. to ASR word timestamps. In HyperFrames, convert those frame numbers to seconds (frames / fps) and bake as `const`.

## Layout

Four zones share an `AbsoluteFill`-style stage:

```html
<div class="stage" style="position: absolute; inset: 0;">
  <div class="bg"></div>
  <div class="ambient-glow"></div>
  <!-- soft radial behind everything -->
  <div class="badge"></div>
  <!-- "HyperFrames" top label -->

  <!-- Phase 1+2: Video card. Three nested wrappers separate concerns. -->
  <div class="video-pos">
    <!-- GSAP: x (entry/slide/exit), scale, opacity -->
    <div class="video-float">
      <!-- onUpdate: y (float) -->
      <div class="video-tilt">
        <!-- CSS: rotateY(15deg) rotateX(5deg) -->
        <div class="video-content">...</div>
      </div>
    </div>
  </div>

  <!-- Phase 2: MP4 stat. Three nested wrappers, same pattern. -->
  <div class="stat-pos">
    <!-- GSAP: x (entry/exit), y (entry), scale, opacity -->
    <div class="stat-breath">
      <!-- onUpdate: scale (breathing) -->
      <div class="stat-tilt">
        <!-- CSS: rotateY(-15deg) rotateX(5deg) -->
        <div class="depth-stack" data-text="MP4"></div>
      </div>
    </div>
  </div>

  <!-- Phase 3+4: Typing + pill. -->
  <div class="typing-stage">
    <!-- GSAP: opacity, scale entry -->
    <div class="typing-tilt">
      <!-- CSS: rotateY(-15deg) rotateX(5deg) -->
      <div class="line1">
        <span class="seg main"></span>
        <span class="seg accent"></span>
        <span class="seg suffix"></span>
        <span class="seg accent2"></span>
        <span class="cursor cursor1"></span>
      </div>
      <div class="line2-wrap">
        <div class="pill-bg"></div>
        <!-- GSAP: scaleX, scaleY, opacity -->
        <div class="pill-glow"></div>
        <!-- GSAP: opacity -->
        <div class="line2-content">
          <span class="seg line2"></span>
          <span class="cursor cursor2"></span>
        </div>
      </div>
    </div>
  </div>

  <div class="vignette"></div>
</div>
```

**Three nested wrappers per moving element** is the recurring pattern:

- Outermost (`-pos`) handles GSAP entry/slide/exit
- Middle (`-float` or `-breath`) handles onUpdate-driven continuous motion
- Innermost (`-tilt`) holds static 3D rotation via CSS

This isolation prevents the float onUpdate from overwriting the slide tween's `x`, and prevents the slide tween from overwriting the float's `y`. Each wrapper owns one concern.

## Phase 1: Video Entry + Float

```js
const VIDEO_ENTRY_AT = 0.17;
const VIDEO_ENTRY_DUR = 0.7;

gsap.set(".video-pos", { x: W / 2, y: H / 2, scale: 0.6, opacity: 0 }); // initial center, small

tl.to(
  ".video-pos",
  {
    x: W / 2, // stays centered during entry
    scale: 1,
    opacity: 1,
    duration: VIDEO_ENTRY_DUR,
    ease: "power3.out", // spring(stiffness:80, damping:15)
  },
  VIDEO_ENTRY_AT,
);
```

The 3D tilt (`rotateY(15deg) rotateX(5deg)`) is set once in CSS on `.video-tilt`. The float (`y` ±6 px, slow sine) runs continuously from t=0 in the shared scene-ticker onUpdate.

## Phase 2: Video Slide + Stat Reveal

Both happen at the same timeline position (`SLIDE_AT`, anchored to the stat's ASR word in the original):

```js
const SLIDE_AT = 2.2; // "MP4" speak time
const SLIDE_LEFT_X = W * 0.29; // video's new center

/* Video slides left and shrinks slightly to make room for the stat. */
tl.to(
  ".video-pos",
  {
    x: SLIDE_LEFT_X,
    scale: 0.85,
    duration: 0.8,
    ease: "power3.out", // spring(stiffness:100, damping:18)
  },
  SLIDE_AT,
);

/* Stat appears on the right with bouncy entry. */
const STAT_ENTRY_X = W * 0.6;
gsap.set(".stat-pos", { x: STAT_ENTRY_X, y: 60, scale: 0.3, opacity: 0 });

tl.to(
  ".stat-pos",
  {
    y: 0,
    scale: 1,
    opacity: 1,
    duration: 0.6,
    ease: "back.out(1.6)", // spring(stiffness:150, damping:12)
  },
  SLIDE_AT,
);
```

The 3D depth stack inside `.stat-tilt` is built once at composition setup time — see [3d-text-depth-layers](../rules/3d-text-depth-layers.md). 5 layers, offset `(1 px, 2 px)`, alpha `0.1 × (LAYER_COUNT − i)`.

Breath multiplies onto the stat's final scale (1.0) via the shared scene-ticker (Form 2 of [sine-wave-loop](../rules/sine-wave-loop.md)):

```js
onUpdate: function () {
  const t = tl.time();
  if (t > STAT_BREATH_START) {
    const breath = 1 + Math.sin((t - STAT_BREATH_START) * 1.2) * 0.02;
    gsap.set(".stat-breath", { scale: breath });
  }
  // ... other continuous motions
}
```

## Phase 3: Pivot — Both Exit Left + Typing Begins

The Remotion source ties `typingStart` to the ASR word that opens line 1. At that moment, both video and stat slide off the left edge while the typing text fades and scales in from center.

```js
const TYPING_START = 3.86; // line 1 opening word speak time
const VIDEO_EXIT_X = -W * 0.5; // off-screen left
const STAT_EXIT_X = -W * 0.7;

tl.to(
  ".video-pos",
  {
    x: VIDEO_EXIT_X,
    scale: 0.8,
    opacity: 0,
    duration: 0.6,
    ease: "power3.out",
  },
  TYPING_START,
);

tl.to(
  ".stat-pos",
  {
    x: STAT_EXIT_X,
    scale: 0.8,
    opacity: 0,
    duration: 0.6,
    ease: "power3.out",
  },
  TYPING_START,
);

/* Typing stage fades + scales in. */
gsap.set(".typing-stage", { scale: 0.9, opacity: 0 });
tl.to(
  ".typing-stage",
  {
    scale: 1,
    opacity: 1,
    duration: 0.5,
    ease: "power3.out", // spring(stiffness:100, damping:15)
  },
  TYPING_START,
);
```

## Phase 3 (continued): Character-by-Character Typing

A single proxy tween drives the character index 0 → totalChars. Inside `onUpdate`, slice the full text into the correct sub-spans based on segment boundaries and current index.

```js
const TYPE_RATE = 30; // chars/sec (= 1 frame/char at 30 fps)
const SEG = {
  main: "HTML ", // 5 chars
  accent: "pages", // 5 chars (brand green)
  suffix: " become ", // 8 chars
  accent2: "video", // 5 chars (brand green)
  line2: "frame by frame.", // 15 chars
};

const segMain = document.querySelector(".seg.main");
const segAccent = document.querySelector(".seg.accent");
const segSuffix = document.querySelector(".seg.suffix");
const segAccent2 = document.querySelector(".seg.accent2");
const segLine2 = document.querySelector(".seg.line2");

const BOUNDS = {
  // line1 segment boundaries (chars)
  mainEnd: 5, // "HTML "
  accentEnd: 10, // "HTML pages"
  suffixEnd: 18, // "HTML pages become "
  accent2End: 23, // "HTML pages become video"
  line2End: 23 + 15, // " ... frame by frame."
};

const typeProxy = { idx: 0 };
const TYPE_DUR = BOUNDS.line2End / TYPE_RATE;

tl.to(
  typeProxy,
  {
    idx: BOUNDS.line2End,
    duration: TYPE_DUR,
    ease: "none",
    onUpdate: () => {
      const i = Math.floor(typeProxy.idx);
      segMain.textContent = SEG.main.slice(0, Math.min(i, BOUNDS.mainEnd));
      segAccent.textContent = SEG.accent.slice(
        0,
        Math.max(0, Math.min(i - BOUNDS.mainEnd, SEG.accent.length)),
      );
      segSuffix.textContent = SEG.suffix.slice(
        0,
        Math.max(0, Math.min(i - BOUNDS.accentEnd, SEG.suffix.length)),
      );
      segAccent2.textContent = SEG.accent2.slice(
        0,
        Math.max(0, Math.min(i - BOUNDS.suffixEnd, SEG.accent2.length)),
      );
      segLine2.textContent = SEG.line2.slice(
        0,
        Math.max(0, Math.min(i - BOUNDS.accent2End, SEG.line2.length)),
      );
    },
  },
  TYPING_START + 0.5,
); // typing starts after the stage settles
```

The accent-colored spans (`.seg.accent`, `.seg.accent2`) get their brand-green color from a static CSS rule (`.seg.accent, .seg.accent2 { color: var(--brand-green); }`) — no per-frame color tween or glow envelope. The cursor blinks via a separate onUpdate (next section), and switches between white and green based on which segment is currently typing.

## Phase 4: Gradient Pill Reveal Behind Line 2

Once typing crosses into `line2` (the closing phrase), a gradient pill scales in behind the text — narrow at first (scaleY 0.5) then full height (scaleY 1.0), giving the phrase a "stamp of impact."

```js
const PILL_AT = TYPING_START + 0.5 + BOUNDS.accent2End / TYPE_RATE; // when line2 typing begins (≈ 4.83 s)

gsap.set(".pill-bg", { scaleX: 0, scaleY: 0.5, opacity: 0 });
gsap.set(".pill-glow", { opacity: 0 });

/* Pill scaleX 0 → 1 + scaleY 0.5 → 1 + opacity → 0.9 in one ease. */
tl.to(
  ".pill-bg",
  {
    scaleX: 1,
    scaleY: 1,
    opacity: 0.9,
    duration: 0.6,
    ease: "power3.out", // spring(stiffness:80, damping:15)
  },
  PILL_AT,
);

/* Soft glow halo behind the pill — fades in slightly slower. */
tl.to(
  ".pill-glow",
  {
    opacity: 0.5,
    duration: 0.8,
    ease: "power2.out",
  },
  PILL_AT,
);
```

The pill background is `linear-gradient(90deg, purple, green)`; the glow is a blurred `radial-gradient` further behind. Both use `transform-origin: center center` so they scale outward from the phrase center.

## Blinking Cursor

The Remotion source used `frame % 30 < 15 ? 1 : 0`. In HyperFrames, derive deterministically from `tl.time()`:

```js
onUpdate: function () {
  const t = tl.time();
  const cursorVisible = (Math.floor(t * 2) % 2 === 0) ? 1 : 0;
  // Show cursor1 only while typing line1 (charIdx < line2 start)
  cursor1.style.opacity = (i < BOUNDS.accent2End) ? cursorVisible : 0;
  // Show cursor2 only while typing line2
  cursor2.style.opacity = (i >= BOUNDS.accent2End && i < BOUNDS.line2End) ? cursorVisible : 0;
}
```

`Math.floor(t * 2) % 2` = 1 blink per second. `frame % 30 < 15` at 30 fps = exactly the same rhythm.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Video entry completes by 0.87 s. SLIDE_AT (2.2 s) is ~1.3 s later — plenty
  of room for the floating to be visible and read as "alive."

Phase 2 → Phase 3:
  Stat entry completes by 2.8 s. Stat breathing starts at ~3.0 s (entry + buffer).
  TYPING_START (3.86 s) cuts breathing short — the exit tween overrides.

Phase 3 typing:
  Typing starts at TYPING_START + 0.5 s, after the typing-stage entry settles.
  Total typing duration: (23 + 15) / 30 ≈ 1.27 s. Finishes at ~5.63 s.

Phase 3 → Phase 4:
  PILL_AT = TYPING_START + 0.5 + (23 / 30) = 4.83 s — exactly when line2 starts
  typing. Pill scale completes by ~5.43 s, before line2 text completes.

Continuous (Phase 1+):
  Shared scene-ticker onUpdate runs from t=0 across the whole composition.
  Drives video float (Phase 1+2), stat breath (Phase 2), cursor blink (Phase 3+4).
  Each motion gates itself by time conditions so it doesn't fire outside its window.
```

## Critical Constraints

- **Video stays visible during Phase 2**: It slides aside but doesn't exit until Phase 3. Maintains context.
- **Typing starts during stage entry**: Don't wait for the typing stage to fully fade in before starting characters — overlap for smooth flow.
- **ASR-driven timing**: `SLIDE_AT`, `TYPING_START`, and segment boundaries align with voiceover word timestamps. Bake them as constants converted from `frames / fps`.
- **Stat font size fills available space**: The stat is 15–25% of viewport width — it's the visual climax.
- **Three nested wrappers per moving element**: `.pos` / `.float` / `.tilt`. Each owns one concern; the float onUpdate never overwrites the slide tween's `x`.
- **Pill scales from center**: `transform-origin: center center` on the pill background.
- **3D depth layers need 4–6 layers**: Fewer looks flat; more is wasteful CPU.
- **Blinking cursor rhythm**: `Math.floor(t * 2) % 2` = 1 blink/sec. Slower (`t * 1.5`) feels lazy; faster (`t * 4`) feels manic.
- **Conditional rendering replaced by opacity + gating**: Don't conditionally mount/unmount elements; render permanently, GSAP tweens opacity to 0 to hide. Gates inside the onUpdate prevent breath / float from firing outside their visibility windows.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `rotationY`, `rotationX`. Never `width` / `height` / `left` / `top`.
- **No `Math.random` / `Date.now`**: All motion is a pure function of `tl.time()`.
- **No infinite repeats**: All continuous motions in the scene-ticker run over a finite `duration: TOTAL_DUR`. No `repeat: -1`.
- **Single paused timeline**: All four phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                   | This blueprint uses                       |
| --------------------------------------------------------------- | ----------------------------------------- |
| `spring({ stiffness: 80, damping: 15 })` — video entry          | `power3.out` over 0.7 s                   |
| `spring({ stiffness: 100, damping: 18 })` — video slide         | `power3.out` over 0.8 s                   |
| `spring({ stiffness: 120, damping: 20 })` — video/stat exit     | `power3.out` over 0.6 s                   |
| `spring({ stiffness: 150, damping: 12 })` — stat entry (bouncy) | `back.out(1.6)` over 0.6 s                |
| `spring({ stiffness: 80, damping: 15 })` — pill scale           | `power3.out` over 0.6 s                   |
| `spring({ stiffness: 100, damping: 15 })` — typing stage entry  | `power3.out` over 0.5 s                   |
| `sin(frame * 0.04) * 0.02` — stat breath                        | `Math.sin(t * 1.2) * 0.02` in onUpdate    |
| `sin(frame * 0.03) * 6` — video float                           | `Math.sin(t * 0.9) * 6` in onUpdate       |
| `frame % 30 < 15` — cursor blink                                | `Math.floor(t * 2) % 2 === 0` in onUpdate |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [metric-video-text-pivot.html](../examples/metric-video-text-pivot.html) — "HyperFrames" badge top, showcase video card center (3D-tilted +15° rotateY) → at 2.2 s video slides to 29% W, "MP4" appears on right with 5-layer green depth stack + breathing → at 3.86 s both exit left, typing "HTML **pages** become **video**" / "frame by frame." begins center-screen → gradient pill (purple→green) scales in behind "frame by frame." with radial glow halo. Single paused GSAP timeline drives all four phases over 6.5 seconds.
