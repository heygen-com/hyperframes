# Cut the Curve — the default scene boundary

X/Y velocity-matched cut — the default for ALL scene-to-scene boundaries, in the film's
current, not an accent. The outgoing hero accelerates in one direction, the cut lands
mid-motion, the incoming hero continues the SAME direction and decelerates. Total ≈ 0.6s;
directions LEFT / RIGHT / UP / DOWN (default LEFT — the current).

**Partial travel:** ~12% of frame (≈230px at 1920) — never full off-screen moves.

| Direction | Exit          | Entry start → end |
| --------- | ------------- | ----------------- |
| Leftward  | `x: 0 → −230` | `x: +230 → 0`     |
| Rightward | `x: 0 → +230` | `x: −230 → 0`     |
| Upward    | `y: 0 → −230` | `y: +230 → 0`     |
| Downward  | `y: 0 → +230` | `y: −230 → 0`     |

Mechanics:

- **Mirrored eases:** exit `power4.in` + entry `power4.out`, same distance and duration —
  the two halves of one `power4.inOut`, so velocity matches exactly at the cut.
- **The fade trick:** exit opacity completes at ~25–30% of its travel (fade ≈ 0.18–0.3s
  vs motion 0.3–0.34s); entry ignites at ~0.35 opacity mid-path. Time the last fading
  element to die right at the cut — a gap where nothing moves reads as dead air.
- Exit 0.2–0.4s; entry ≥ exit. Optional blur 8–10px.
- **Stage ground:** `#root` must be opaque — see the seam law excerpt / `seam-craft`.

`push-slide` exists but violates partial-travel and mid-motion phase; prefer cut-the-curve.

## Worker version (scene layers)

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

## Registry gsap_template

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

## Combined cut-the-curve + zoom

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

## Tuning ranges

| Parameter      | Default            | Range     |
| -------------- | ------------------ | --------- |
| Travel         | 230px (~12% frame) | 150–300px |
| Blur at cut    | 8px                | 6–10px    |
| Exit duration  | 0.33s              | 0.2–0.4s  |
| Entry duration | 0.33–0.42s         | ≥ exit    |

## Anti-patterns

| Don't                                         | Instead                                          |
| --------------------------------------------- | ------------------------------------------------ |
| Full off-screen exits/entries                 | Partial travel (~12%) + early fade               |
| `.inOut` eases on either side of a cut        | Mirrored `power4.in` / `power4.out`              |
| Lone element fading long before its cut       | Fade ends ~0.02s before the cut, or word-cascade |
| Scene cuts without cut-the-curve              | It is the default boundary                       |
| Consecutive boundaries in opposing directions | One current; reserved vectors spent on meaning   |
| Unpainted `#root` behind a mid-window cut     | Opaque stage ground                              |
