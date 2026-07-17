# Waterfall Cut — word-by-word cut-the-curve

Cut-the-curve at WORD granularity — the strongest leftward cut for text-to-text seams.
Outgoing words ramp out on their own curves; incoming words cascade in mid-flight — a
wave the eye rides across the seam.

**Scope:** worker-authored inside one multi-beat comp (stacked full-frame `.beat` layers),
NOT a registry/injector type — it tweens word spans, not clip wrappers. The boundary into
and out of the text-beat block still gets a normal registry transition. Does not count
against the 2–3 transition budget.

| Parameter           | Value                 | Why                                         |
| ------------------- | --------------------- | ------------------------------------------- |
| Travel              | ±230px (~12% frame)   | partial travel + velocity > full-frame push |
| Exit                | 0.34s `power4.in`     | the acceleration IS the cut                 |
| Exit fade           | 0.18s, starts with x  | word gone by ~25–30% of travel — no smear   |
| Exit stagger        | +0.022s reading order | the line peels, not a block slide           |
| Entry               | 0.3s `power4.out`     | back half of the composite — velocity match |
| Entry start opacity | 0.35                  | mid-path ignition; binary 0→1 pops          |
| Entry gaps          | 0.05s × 0.84 decay    | accelerating cascade, resolves composed     |

Rules:

- One direction per chain, riding the current. Inverse zoom is the chain's ARRIVAL beat only.
- Pre-set all words to `x: +230, opacity: 0` at build time — `immediateRender: false`
  alone leaves un-started words visible at rest.
- A short first beat may exit whole-line: its fade ends ~0.02s before the cut so it is
  still streaking when the next words ignite — no dead gap.
- Transform/opacity only (seek-safe); opaque stage ground applies.
- The in-scene ARRIVAL sibling (no seam) is `hyperframes-animation/rules/waterfall-entry.md`
  — arrivals use binary 0→1 opacity, never this seam's mid-path fade.

## DOM + CSS

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

## Timeline

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

## Anti-patterns

| Don't                                 | Instead                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| Equal gaps across a waterfall cascade | Shrink gaps ×0.84 per word                               |
| Binary 0→1 opacity on the seam entry  | Ignite at 0.35 mid-path — the fade IS the velocity trick |
| Mixed directions in one chain         | One direction, riding the current                        |
