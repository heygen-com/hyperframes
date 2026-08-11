---
name: volume-squash-stretch
description: Volume-preserving squash & stretch that makes impacts read as mass — deformation ratio computed from impact velocity and implied material softness, stretch axis aligned with travel, scaleX×scaleY≈1 at every frame, recovery rung on the spring registers. Encodes the type constraint — glyphs never deform geometrically.
metadata:
  tags: squash, stretch, deformation, volume, weight, impact, mass, physics, spring, slam
---

# Volume Squash & Stretch

The classical principle, quantified: an object that **stretches along its travel** while
flying and **squashes against the surface** on impact reads as a thing with mass; one
that arrives rigid reads as a cursor. The house version has three laws the classical
one leaves implicit:

1. **Volume preservation is literal:** `scaleAlong × scalePerp ≈ 1` at every frame.
   Uniform scale presses (all current house presses) do NOT preserve volume — they read
   as zoom, not contact.
2. **Deformation is computed, not hand-picked:** ratio = f(impact velocity, implied
   mass/softness). The same object arriving faster deforms more, automatically —
   the same house pattern as the staged `follow-through` rule's `withFollowThrough` measuring arrival speed.
3. **Type never deforms geometrically** (squashed type is a known amateur tell —
   the designer drew every glyph at one set of proportions). Type participates via
   the variable-font `wdth` axis or via its **container**.

## How It Works

**Measure impact velocity from the entrance ease** — numerically, like
the staged `follow-through` rule's `withFollowThrough` measures exit slope:

```js
// v at contact, in px/s: end-slope of the travel ease × travel / duration
const eps = 1e-4;
const vImpact = ((ease(1) - ease(1 - eps)) / eps) * (TRAVEL_PX / DUR); // px/s
```

**Convert to a squash amount via a softness tier** (the "implied mass" — softer/lighter
things deform more; hard/heavy things deform less but recover slower):

```js
const S = Math.min(SOFTNESS * (vImpact / V_REF), S_MAX); // V_REF = 2000 px/s
// contact frame:  scaleAlong = 1 - S     (flattened ALONG travel, against the surface)
//                 scalePerp  = 1 / (1 - S)   (bulge — volume preserved exactly)
// (forge-lab, 2026-08-11: for a vertical drop the travel axis is Y, so contact is
//  scaleY = 1−S, scaleX = 1/(1−S) — same convention in flight and at contact.)
```

**Stretch in flight, along travel:** while moving, `scaleAlong = 1 + E × min(|v(t)|/V_REF, 1)`
(with `scalePerp = 1/scaleAlong`) — the velocity term is CLAMPED at 1, or a fast
power-in arrival (the build's chip tier hits v=4508 px/s > V_REF) more than doubles
the intended stretch (forge-lab, 2026-08-11). `|v(t)|` is the ease's slope at t ×
travel/duration — px/s, as in the snippets (forge-lab forge-lib.js, 2026-08-11); the
raw slope alone is dimensionless and vanishes against V_REF. Peak stretch happens at
peak speed, and the object un-stretches as the ease decelerates.
For vertical drops "along" is Y; for any other travel vector, rotate a wrapper to the
travel direction, scale in the wrapper's local axes, counter-rotate the content.

**Recover on the spring registers.** After the 1–2-frame contact hold, scaleX/scaleY
spring back to 1 using the register matching the tier — never a plain power ease
(rigid: `snappy` · UI card: `bouncy` · soft: `wobbly` · massive: `heavy-settle` —
named registers from the staged spring-ease rule; until it lands, pass the validated
pair to `springEase` in `../adapters/gsap-easing-and-stagger.md` directly: snappy
{dampingFraction 0.90, response 0.22} · bouncy {0.5, 0.4} · wobbly {0.28, 0.5} ·
heavy-settle {1.0, 0.8}).

## Recipe

```js
// One proxy drives both axes so volume stays locked — never two independent tweens.
// ONE shared apply serves flight AND contact, so the label counter-scale holds glyphs
// at net identity in both phases (forge-lab forge-lib.js makeDrop, 2026-08-11).
const d = { s: 0 }; // s: 0 → S at contact, then spring back to 0
const setBoth = (along) => {
  // vertical drop: along = Y (the travel axis), both phases
  gsap.set("#card", { scaleY: along, scaleX: 1 / along, transformOrigin: "50% 100%" });
  if (LABEL) gsap.set(LABEL, { scaleX: along, scaleY: 1 / along }); // net identity — glyphs never deform
};
const applySquash = () => setBoth(1 - d.s); // contact flattens ALONG travel: scaleY = 1−s
// travel + in-flight stretch (slope-driven, pure function of LINEAR progress)
tl.fromTo(
  "#card",
  { y: -DROP },
  {
    y: 0,
    duration: DUR,
    ease: dropEase,
    onUpdate() {
      const p = this.progress(); // NOT this.ratio — ratio is already eased; sampling the
      // ease at the eased value computes ease(ease(t)) and kills mid-flight stretch
      const v = ((dropEase(Math.min(p + 1e-4, 1)) - dropEase(p)) / 1e-4) * (DROP / DUR);
      setBoth(1 + E_STRETCH * Math.min(v / V_REF, 1));
    },
  },
  AT,
);
// contact: squash in ≤2 frames, hold 1 frame, spring home
tl.to(d, { s: S, duration: 2 / FPS, ease: "power3.out", onUpdate: applySquash }, AT + DUR);
const rec = springEase(TIER_SPRING); // the tier's {dampingFraction, response} pair (see Values)
tl.to(
  d,
  { s: 0, duration: rec.duration, ease: rec.ease, onUpdate: applySquash },
  AT + DUR + 3 / FPS,
);
```

`transformOrigin: "50% 100%"` (contact edge) for landings — squash grows from the
contact surface, not the center. The origin must NOT change between flight and contact
on the same object — switching adds a positional jump at the contact frame on top of
the designed stretch→squash snap; the validated build holds `50% 100%` through both
phases on every drop (forge-lab, 2026-08-11).

### Type inside a deforming container

The container (card/badge/chrome) squashes; the label does not. The counter-scale
lives INSIDE the shared apply (`setBoth` above), so the label is held at net identity
during BOTH the in-flight stretch and the contact squash — wiring it to the contact
phase only deforms glyphs on every airborne frame, the exact amateur tell this rule
bans (forge-lab, 2026-08-11: A7 verified by grep — no scaleX/scaleY tween targets a
text element non-uniformly):

```js
// inside setBoth(along) — container gets {scaleY: along, scaleX: 1/along}, label inverts it
gsap.set("#card-label", { scaleX: along, scaleY: 1 / along }); // net identity, every frame
```

Or let the type itself land WITHOUT geometry — tween the variable axis:

```js
// wdth slam: land at 100, slam WIDER 100 → ~118 in 2 frames (power3.out — the
// perpendicular bulge expressed on the designed axis), 1-frame hold, then spring
// 118 → 100 on the register (forge-lab index.html:205-206; burned spec
// "wdth 100 → 118 → 100", G9-verified, 2026-08-11)
tl.to("#word", { "--wdth": 118, duration: 2 / FPS, ease: "power3.out" }, LAND);
tl.to("#word", { "--wdth": 100, duration: rec.duration, ease: rec.ease }, LAND + 3 / FPS);
/* CSS: #word { font-variation-settings: "wdth" var(--wdth); } */
```

All values must stay inside the font's real axis range (Archivo: wdth 62–125) — a leg
outside it clamps to a dead flat segment. Precondition: the element must use a loaded
VARIABLE font with the `wdth` range declared in `@font-face` (`font-stretch: min% max%`,
e.g. Archivo `62% 125%`) — on a static/pre-instanced artifact the tween silently
no-ops (forge-lab, 2026-08-11: opentype.js reads only the default instance; keep the
variable TTF for the CSS wdth lane — two artifacts, two lanes).

The designer drew every intermediate width — stems and counters stay optically correct
(same CSS-var mechanics as `../techniques.md` § Variable Font Axis Animation). Uniform
scale on type remains fine everywhere.

## Values

| token             | range                                                                                  | notes                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SOFTNESS          | 0.03–0.06 rigid/chrome · 0.08–0.14 card/UI · 0.15–0.25 soft/rubber                     | the implied-mass dial                                                                              |
| S_MAX             | 0.25                                                                                   | beyond this even "soft" reads as liquid                                                            |
| V_REF             | ~2000 px/s (1080p)                                                                     | normalizing constant; scale with frame height                                                      |
| E_STRETCH         | 0.4–0.7 × SOFTNESS                                                                     | in-flight stretch is subtler than contact squash                                                   |
| contact hold      | 1–2 frames @30fps                                                                      | ≥3 frames reads as rubber cement                                                                   |
| recovery register | snappy {0.90, 0.22} · bouncy {0.5, 0.4} · wobbly {0.28, 0.5} · heavy-settle {1.0, 0.8} | {dampingFraction, response} for `springEase`; pick by tier, consume the returned duration verbatim |

## Critical Constraints

- **`scaleAlong × scalePerp ≈ 1` at every animated frame** — one proxy value drives
  both axes; two independent tweens WILL drift and break volume.
- **NEVER non-uniform scale on glyphs.** Not scaleX, not scaleY, not via a squashing
  ancestor without counter-scale. Variable-font `wdth` or container deformation only.
  (Uniform scale is allowed.)
- **Stretch axis = travel axis** — a horizontal snap that squashes vertically reads
  broken; use a travel-aligned wrapper for angled paths.
- **Deformation is derived, not decorative** — compute S from the actual entrance ease
  and tier; hand-picked squash on a slow drift is the cartoon-physics tell.
- **Recovery rides a spring register** with its factory duration consumed verbatim
  (zero `*.duration *` multiplications — take both the ease and the duration from the
  helper, per `../adapters/gsap-easing-and-stagger.md`).
- **3D meshes:** same law on `scale` axes (`scale.y = 1−S`, `scale.x = scale.z =
1/√(1−S)` — volume in 3D splits across two perpendicular axes).

## See also

`press-release-spring` / `spring-pop-entrance` / `kinetic-beat-slam` /
`vertical-spring-ticker` (use sites) · staged `spring-ease` rule (the registers) ·
`reactive-displacement` (reactive displacement of neighbors on the same impact).
