# Cut the Curve — GSAP code templates

Canonical implementations for every variant. Parameters and rules live in `../SKILL.md`;
copy code from here. Worker-authored versions tween in-scene elements; registry
`gsap_template`s are injector-stamped onto the two clip wrappers (`__OLD__` / `__NEW__`
/ `__T__` / `__DUR__` tokens — see `seam-craft` for the token table).

## 1. Zoom-Through (forward)

### Worker version (within-scene wrapper swap)

```js
var EXIT_START = /* when readable text starts leaving */;
var CUT = EXIT_START + 0.2;

// Phase 1: Exit — scale/blur accelerate, opacity fades linearly (separate tween)
tl.to(".text-a-wrapper", {
  scale: 1.2,
  filter: "blur(10px)",   // text-scale: 10px
  duration: 0.2,
  ease: "power3.in",
  overwrite: "auto"
}, EXIT_START);
tl.to(".text-a-wrapper", { opacity: 0.15, duration: 0.2, ease: "none" }, EXIT_START);

// Phase 2: Hard cut — matched properties
tl.set(".text-a-wrapper", { opacity: 0 }, CUT);
tl.set(".text-b-wrapper", { opacity: 0.15, scale: 0.75, filter: "blur(10px)" }, CUT);

// Phase 3: Entry — fast initial velocity, long settle
tl.to(".text-b-wrapper", {
  scale: 1, filter: "blur(0px)", opacity: 1,
  duration: 0.5, ease: "expo.out"
}, CUT);
```

### Registry gsap_template

```js
tl.to(
  __OLD__,
  { scale: 2.5, opacity: 0, filter: "blur(8px)", duration: __DUR__, ease: "power3.in" },
  __T__,
);
tl.fromTo(
  __NEW__,
  { scale: 0.5, opacity: 0, filter: "blur(8px)" },
  { scale: 1, opacity: 1, filter: "blur(0px)", duration: __DUR__, ease: "power3.out" },
  __T__,
);
```

## 2. Inverse Zoom-Through

### Registry gsap_template

```js
tl.set(__NEW__, { opacity: 0 }, __T__);
tl.to(
  __OLD__,
  { scale: 0.8, filter: "blur(10px)", duration: __DUR__ * 0.3, ease: "power3.in" },
  __T__,
);
tl.to(__OLD__, { opacity: 0.15, duration: __DUR__ * 0.3, ease: "none" }, __T__);
tl.set(__OLD__, { opacity: 0 }, __T__ + __DUR__ * 0.3);
tl.fromTo(
  __NEW__,
  { opacity: 0.15, scale: 1.25, filter: "blur(10px)" },
  {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    duration: __DUR__ * 0.7,
    ease: "expo.out",
    immediateRender: false,
  },
  __T__ + __DUR__ * 0.3,
);
```

Worker version: same phases as zoom-through with the scale values flipped
(exit `1 → 0.8`, cut-in at `1.25`, entry `1.25 → 1`).

## 3. Cut the Curve

### Worker version (scene layers)

```js
var CUT_TIME = /* scene transition point */;

// Scene A: hero accelerates leftward (partial travel ~12% of frame)
tl.to(".scene-a-layer", { opacity: 0, duration: 0.33, ease: "power2.in" }, CUT_TIME - 0.33);
tl.to(".hero-a-wrapper", {
  x: -230, filter: "blur(8px)",
  duration: 0.33, ease: "power4.in",   // mirrored half of power4.inOut
  overwrite: "auto"
}, CUT_TIME - 0.33);

// Hard cut
tl.set(".scene-b-layer", { opacity: 1 }, CUT_TIME);
tl.set(".hero-b-wrapper", { x: 230, filter: "blur(8px)" }, CUT_TIME);

// Scene B: hero decelerates leftward
tl.to(".hero-b-wrapper", {
  x: 0, filter: "blur(0px)",
  duration: 0.33, ease: "power4.out"   // matched velocity at the cut
}, CUT_TIME);
```

### Registry gsap_template

`__DX__` = `-1920` (LEFT) / `1920` (RIGHT); `__DY__` = `-1080` (UP) / `1080` (DOWN).
The `* 0.12` / `* 0.21` factors yield the ~12% partial travel.

```js
// horizontal
tl.set(__NEW__, { opacity: 0 }, __T__);
tl.to(__OLD__, { x: __DX__ * 0.12, duration: __DUR__ * 0.5, ease: "power4.in" }, __T__);
tl.to(__OLD__, { opacity: 0, duration: __DUR__ * 0.47, ease: "power2.in" }, __T__ + __DUR__ * 0.03);
tl.fromTo(
  __NEW__,
  { x: __DXIN__ * 0.12, opacity: 0.35 },
  { x: 0, opacity: 1, duration: __DUR__ * 0.5, ease: "power4.out", immediateRender: false },
  __T__ + __DUR__ * 0.5,
);

// vertical
tl.set(__NEW__, { opacity: 0 }, __T__);
tl.to(__OLD__, { y: __DY__ * 0.21, duration: __DUR__ * 0.5, ease: "power4.in" }, __T__);
tl.to(__OLD__, { opacity: 0, duration: __DUR__ * 0.47, ease: "power2.in" }, __T__ + __DUR__ * 0.03);
tl.fromTo(
  __NEW__,
  { y: __DYIN__ * 0.21, opacity: 0.35 },
  { y: 0, opacity: 1, duration: __DUR__ * 0.5, ease: "power4.out", immediateRender: false },
  __T__ + __DUR__ * 0.5,
);
```

### Combined cut-the-curve + zoom

The scale component obeys the Z sign rule: both sides SHRINK (exit `1 → 0.92`, entry
`1.08 → 1`) — a consistent mild pull layered on the lateral cut. Never pair a shrinking
exit with a grow-from-small entry here.

```js
// Scene A: hero slides left + mild pull + blur
tl.to(
  ".hero-a-wrapper",
  {
    x: -230,
    scale: 0.92,
    filter: "blur(8px)",
    duration: 0.33,
    ease: "power4.in",
  },
  CUT_TIME - 0.33,
);

// Cut + Scene B: continues leftward, arrives slightly oversized and retracts
tl.set(".hero-b-wrapper", { x: 230, scale: 1.08, filter: "blur(8px)" }, CUT_TIME);
tl.to(
  ".hero-b-wrapper",
  {
    x: 0,
    scale: 1,
    filter: "blur(0px)",
    duration: 0.42,
    ease: "power4.out",
  },
  CUT_TIME,
);
```

## 4. Waterfall Cut

### DOM + CSS

```html
<div class="beat" id="b1"><div class="line">And until now</div></div>
<div class="beat" id="b2">
  <div class="line">
    <span class="w">that</span> <span class="w">changes</span> <span class="w">today.</span>
  </div>
</div>
```

```css
.beat {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  will-change: transform, opacity;
}
.w {
  display: inline-block;
  will-change: transform, opacity;
}
```

### Timeline

```js
// Pre-set at build time — immediateRender:false alone leaves un-started words visible.
gsap.set([...w1, ...w2], { x: 230, opacity: 0 });

function wordExit(words, C) {
  // C = cut time on the comp timeline
  let s = C - 0.32; // exits START before the cut
  words.forEach((el) => {
    tl.to(el, { x: -230, duration: 0.34, ease: "power4.in" }, s);
    tl.to(el, { opacity: 0, duration: 0.18, ease: "power1.in" }, s); // fade ends ~25-30% into travel
    s += 0.022; // reading-order stagger
  });
}

function wordEnter(words, C) {
  let off = 0,
    gap = 0.05;
  words.forEach((el) => {
    tl.fromTo(
      el,
      { x: 230, opacity: 0.35 }, // ignites MID-PATH, already moving
      { x: 0, opacity: 1, duration: 0.3, ease: "power4.out", immediateRender: false },
      C + off,
    );
    off += gap;
    gap *= 0.84; // shrinking gaps — the cascade accelerates
  });
}

const C = 2.3;
wordExit(w1, C);
tl.set(b1, { opacity: 0 }, C); // hard layer swap AT the cut
tl.set(b2, { opacity: 1 }, C);
wordEnter(w2, C);
```

Whole-line first beat: exit as one element — `x: -230, 0.34s, power4.in` with the
opacity fade running nearly the whole ramp (ends ~0.02s before the cut).

## 5. Rack-Focus Blur-Cut

For a Z dolly, drop the x-offset and use scale `0.92 →` / `→ 1.08`.

```js
var T = /* transition start */;
// Phase 1: outgoing pans + blurs, held fully opaque
tl.to("#scene-out", { x: -80, scale: 1.06, filter: "blur(12px)", duration: 0.3, ease: "power2.in" }, T);
// Phase 2: hard cut at peak blur
tl.set("#scene-out", { opacity: 0 }, T + 0.3);
tl.fromTo("#scene-in",
  { opacity: 1, x: 80, scale: 1.06, filter: "blur(12px)" },
  { x: 0, scale: 1, filter: "blur(0px)", duration: 0.35, ease: "power2.out" },
  T + 0.3);
```

## Tuning ranges

### Zoom-Through / Inverse Zoom

| Parameter      | Default                        | Range     |
| -------------- | ------------------------------ | --------- |
| Exit scale     | 1.2 (fwd) / 0.8 (inv)          | ±0.1      |
| Entry scale    | 0.75 (fwd) / 1.25 (inv)        | ±0.1      |
| Blur at cut    | 10px text / 18–20px full-frame | —         |
| Opacity at cut | 0.15                           | 0.1–0.2   |
| Exit duration  | 0.2s                           | 0.15–0.3s |
| Entry duration | 0.5s                           | 0.4–0.6s  |

### Cut the Curve

| Parameter      | Default            | Range     |
| -------------- | ------------------ | --------- |
| Travel         | 230px (~12% frame) | 150–300px |
| Blur at cut    | 8px                | 6–10px    |
| Exit duration  | 0.33s              | 0.2–0.4s  |
| Entry duration | 0.33–0.42s         | ≥ exit    |

## 6. Waterfall Entry

Each element: `tl.set` (instant reveal + offset) then `tl.to` (whip to rest).
`nextStart = prevStart + prevDuration − (overlapFrames × F)`; +overlap = cascade,
−overlap = deliberate gap. CSS: elements start `opacity: 0; display: inline-block`.

```js
var F = 1 / 60;
var t0 = 0.1;
// anchor (heaviest): biggest travel, longest settle
tl.set("#el-1", { opacity: 1, y: 80 }, t0);
tl.to("#el-1", { y: 0, duration: 0.18, ease: "power4.out" }, t0);
// normal word: 2 frames after the anchor finishes
var t1 = t0 + 0.18 + 2 * F;
tl.set("#el-2", { opacity: 1, y: 45 }, t1);
tl.to("#el-2", { y: 0, duration: 0.15, ease: "power4.out" }, t1);
// light word: 1 frame BEFORE the previous finishes (overlap)
var t2 = t1 + 0.15 - F;
tl.set("#el-3", { opacity: 1, y: 40 }, t2);
tl.to("#el-3", { y: 0, duration: 0.14, ease: "power4.out" }, t2);
// split final-word fragments: tightest overlap, extra travel (lighter)
var t3 = t2 + 0.14 - F;
tl.set("#frag-a", { opacity: 1, y: 70 }, t3);
tl.to("#frag-a", { y: 0, duration: 0.16, ease: "power4.out" }, t3);
var t4 = t3 + 0.14 - F;
tl.set("#frag-b", { opacity: 1, y: 70 }, t4);
tl.to("#frag-b", { y: 0, duration: 0.15, ease: "power4.out" }, t4);
// punctuation: lightest, fastest
var t5 = t4 + 0.13 - 2 * F;
tl.set("#dot", { opacity: 1, y: 48 }, t5);
tl.to("#dot", { y: 0, duration: 0.12, ease: "power4.out" }, t5);
```

## 7. Nudge Curve

Reference values for a 270px leftward slide (0.57s total). Scale distances
proportionally for other travels; preserve the TIME ratios; tail ≥3× ramp-in.

```js
var t = /* start after content settles */;
tl.to(".text-row", { x: -30,  duration: 0.12, ease: "power3.in"  }, t);          // ramp-in: 11% dist / 21% time
tl.to(".text-row", { x: -210, duration: 0.10, ease: "none"       }, t + 0.12);   // burst:   67% dist / 18% time
tl.to(".text-row", { x: -270, duration: 0.35, ease: "power4.out" }, t + 0.22);   // tail:    22% dist / 61% time
// vertical: same ratios on y. 150px variant: -15 / -115 / -150 at the same times.
```
