---
name: platform-motion-idioms
description: Platform motion dialects — Android/M3 vs iOS transition idioms, easing/duration tokens, and back/modal semantics — applied when a mocked surface resolves to a platform device frame.
metadata:
  tags: platform, android, ios, material, m3, hig, easing, duration, navigation, dialect, device-frame, predictive-back, spring
---

# Platform Motion Idioms

**Routing: this rule fires when a surface resolves to a platform device frame** — a Pixel/Android
phone frame gets the Android/M3 dialect, an iPhone/iPad frame gets the iOS dialect. A neutral
browser window, desktop app chrome, or abstract surface stays in the house register (no dialect).
The point: platform-flavored motion should be chosen, not produced unknowingly — an Android frame
animated with parallax pushes and z-scale pops reads wrong to anyone who owns the device being
mocked, and the house `springEase` registers already carry iOS labels in
`../adapters/gsap-easing-and-stagger.md` (see the iOS register section for which register
is the system default).

The relation → move selection happens upstream of this file (locally: `ui-nav-grammar`); this file
supplies the per-platform flavor of the chosen move.

## Dialect table

| Move                  | Android / M3                                                                                                                                                                                                                                                                                                                                                                         | iOS                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forward (push)        | Fade + slide, partial travel: "Android uses a fade as screens slide. This reduces the amount of motion, since the screens don't have to slide the full width of the device." [A1]                                                                                                                                                                                                    | Parallax push: "iOS uses a parallax effect, meaning the background slides slower than the foreground." [A1] (Apple does not publish the parallax ratio or scrim values — see caveat below)                                                                                                                   |
| Back (pop)            | GESTURE back (edge swipe depicted on-screen): predictive-back preview — exit scales 100%→90% and fades out at the 35% commit threshold, enter scales 110%→100% and fades in from it, progress on STANDARD_DECELERATE `PathInterpolator(0f,0f,0f,1f)` [A2]. BUTTON/programmatic back: the forward fade+slide, reversed ("platform defaults for forward and backward navigation" [A1]) | Leading-edge interactive pop; a push is never cancelled — "It doesn't cancel a push — instead, it converts it to a pop." [B1] Back retraces hierarchy; Close (not Back) dismisses modality [B2]                                                                                                              |
| Modal / sheet         | Edge-anchored surfaces enter expanding away from their edge: "A menu at the top of the screen expands downwards, and a snackbar at the bottom of the screen expands upwards"; bottom sheets and the keyboard enter from the bottom; a CENTERED dialog has no edge — it expands/collapses along an axis in place, no z-scale [A3]                                                     | coverVertical: "the view slides up from the bottom of the screen. On dismissal, the view slides back down." [B3] Swipe-down dismissal expected; full-screen covers are deliberate, explicit-exit experiences [B4]                                                                                            |
| Expand / enter-exit   | "Android components expand and collapse along the x or y axis as they enter and exit. Scale and z-axis motion is avoided since they imply elevation change, which doesn't match M3's reduced elevation model." [A3]                                                                                                                                                                  | Components uniformly scale in and fade out [A3]; hero navigation grows the destination from its source thumbnail (zoom transition) "to increase the sense of continuity" [B5]                                                                                                                                |
| Elevation / z         | Reduced-elevation model — z-scale reads as an elevation claim, avoid it [A3]                                                                                                                                                                                                                                                                                                         | Depth is native: parallax layers, zoom push, a sheet stacked over its dimmed parent                                                                                                                                                                                                                          |
| Shared element / hero | Container transform — "Persistent elements are used to seamlessly connect the start and end state"; strongest relationship; reserve for hero moments, "Don't use container transform in apps with deep hierarchies" [A4][A5]                                                                                                                                                         | iOS 18 zoom transition — continuously interactive, can be stopped, slowed, or reversed mid-flight; needs a stable source identity [B1][B5]                                                                                                                                                                   |
| Easing character      | Tokened cubic-beziers: "M3 easing is more expressive. Transitions have snappy take offs and very soft landings"; durations "slightly longer compared to M2" [A6]                                                                                                                                                                                                                     | Springs: since iOS 17 the default animation is a critically damped spring (response 0.55, dampingFraction 1.0 — no bounce) [B6] — `springEase({response: 0.55, dampingFraction: 1.0})` IS the iOS system default register; 0.80–0.85 ≈ SwiftUI's `snappy` preset, an optional livelier register [B7] (below) |

## M3 tokens (verbatim values)

Easing — the Emphasized set is "the most common because it captures the expressive style of M3";
Standard is "for simple, small, or utility-focused transitions" and "a fallback for platforms that
don't support Emphasized easing, like iOS and Web" [A7]:

| token                          | value                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `easing.emphasized`            | two-segment path `M 0,0 C 0.05,0, 0.133333,0.06, 0.166666,0.4 C 0.208333,0.82, 0.25,1, 1,1` — no single-bezier CSS equivalent ("Use Standard as a fallback"); in GSAP, bake it as a pure-function ease (piecewise cubic-bezier evaluation, springEase-style — Recipe below) or fall back to `easing.standard` |
| `easing.emphasized.decelerate` | `cubic-bezier(0.05, 0.7, 0.1, 1.0)`                                                                                                                                                                                                                                                                           |
| `easing.emphasized.accelerate` | `cubic-bezier(0.3, 0.0, 0.8, 0.15)`                                                                                                                                                                                                                                                                           |
| `easing.standard`              | `cubic-bezier(0.2, 0.0, 0, 1.0)`                                                                                                                                                                                                                                                                              |
| `easing.standard.decelerate`   | `cubic-bezier(0, 0, 0, 1)`                                                                                                                                                                                                                                                                                    |
| `easing.standard.accelerate`   | `cubic-bezier(0.3, 0, 1, 1)`                                                                                                                                                                                                                                                                                  |

Durations [A8]: short1–4 = 50/100/150/200ms ("small utility-focused transitions"); medium1–4 =
250/300/350/400ms ("traverse a medium area"); long1–4 = 450/500/550/600ms ("large expressive
transitions", card-to-fullscreen = 500ms Emphasized); extra-long1–4 = 700/800/900/1000ms ("ambient
transitions that don't involve user input").

Suggested pairs ("sensible defaults") [A9]: begin-and-end-on-screen = Emphasized 500ms · enter =
Emphasized decelerate 400ms · exit = Emphasized accelerate 200ms; Standard equivalents 300 / 250 /
200ms. Duration scales with traversed area ("small areas... short durations", small ≈ 200ms, large ≈
500ms) and exits run shorter than enters ("Exit transitions are faster because they require less
attention than the user's next task" — enter 500ms vs exit 200ms) [A10]. Exit-permanently uses
accelerate ("ending at peak velocity... gives the impression the exiting component cannot be
retrieved"); exit-temporarily (drawers) uses Emphasized, easing to rest just off-screen ("can be
retrieved") [A10].

**Legacy note** [A11]: M3's own pages mark this easing/duration system as legacy — "components and
motion now use the motion physics system, which uses springs... The easing and duration system is
still used for transitions... but is no longer maintained." For an "expressive" Android brief in a
baked deterministic timeline, use Google's published spring-to-curve web conversions [A12]:
Expressive fast spatial `cubic-bezier(0.42, 1.67, 0.21, 0.90)` @350ms · default spatial
`(0.38, 1.21, 0.22, 1.00)` @500ms · slow spatial `(0.39, 1.29, 0.35, 0.98)` @650ms · Standard
default spatial `(0.27, 1.06, 0.18, 1.00)` @500ms · effects fast/default/slow
`(0.31, 0.94, 0.34, 1.00)` @150ms / `(0.34, 0.80, 0.34, 1.00)` @200ms / `(0.34, 0.88, 0.34, 1.00)`
@300ms.

## Android back — gesture vs button [A2]

Two cases; do not conflate them.

**Gesture back** (an edge swipe depicted on-screen): the predictive-back preview — "the inner area
should scale down as the gesture progresses. As soon as the user crosses the commit threshold, the
contents should swap to the next state using a fade through." Spec: commit threshold at 35%
progress; exit scale 100%→90%; enter scale 110%→100%; exit fades to 0% at the threshold, enter
fades in from it; progress on `PathInterpolator(0f, 0f, 0f, 1f)` (STANDARD_DECELERATE) "so that the
gesture is more apparent in the beginning"; a non-commit release means contents "swiftly return and
scale back to their original state." Shared-element back detaches the surface from the screen edge —
X shift `((screen width / 20) − 8)dp`, Y shift `((available height / 20) − 8)dp`, preview scale
minimum 90%. (System animations appear for opted-in apps as of Android 15 [A13] — a modern Pixel
mock depicting a back SWIPE should show this preview, not the legacy non-previewing transition.)

**Button / programmatic back** (a tap on a back arrow or three-button nav): the values above do NOT
apply — they are gesture-progress-driven, meaningless without a finger on screen. Play the platform
default backward transition: the forward fade+slide, reversed ("Both Android and iOS should use
platform defaults for forward and backward navigation" [A1]).

## iOS register

The spring is the platform's default motion: since iOS 17, `Animation.default` is a spring with
response 0.55, dampingFraction 1.0 — critically damped, no bounce [B6]; SwiftUI's Spring is
parameterized by perceptual duration + bounce, with `smooth` (no bounce) / `snappy` (small bounce) /
`bouncy` presets [B7]. In HyperFrames this is already implemented seek-safely:
`../adapters/gsap-easing-and-stagger.md` `springEase`. **The iOS system default register is
`springEase({ response: 0.55, dampingFraction: 1.0 })`** — the same critical damping as the house
settle (`Animation.default` / `.smooth` [B6]). dampingFraction 0.80–0.85 (≡ bounce 0.15–0.20) is
NOT the system default: it ≈ SwiftUI's `snappy` preset ("a small amount of bounce" [B7]) — an
optional livelier register for interactive/springy affordances, used only when the brief asks for
felt bounce, never as the default iOS dialect. Use the adapter, not a runtime spring library.

**Parallax caveat**: the push/pop parallax character (outgoing view at partial speed under a dimming
scrim) is real system behavior but appears nowhere in Apple's public HIG or API docs — Apple
documents only that a push hides the previous view controller and a pop reveals it [B8]. Any
parallax ratio or scrim value you replicate is reverse-engineered; do not cite it to Apple. (The
parallax's existence IS citable — to Google's cross-platform note [A1].)

## Recipe

```javascript
// M3 easing/duration tokens, GSAP/CSS-ready [A7][A8][A9].
const M3_EASE = {
  emphasizedDecelerate: "cubic-bezier(0.05, 0.7, 0.1, 1.0)", // enters
  emphasizedAccelerate: "cubic-bezier(0.3, 0.0, 0.8, 0.15)", // exits
  standard: "cubic-bezier(0.2, 0.0, 0, 1.0)",
  standardDecelerate: "cubic-bezier(0, 0, 0, 1)",
  standardAccelerate: "cubic-bezier(0.3, 0, 1, 1)",
};
const M3_DUR = { enter: 0.4, exit: 0.2, beginEndOnScreen: 0.5 }; // Emphasized pairs [A9]

// easing.emphasized — the two-segment path baked as a pure-function ease
// (piecewise cubic-bezier evaluation; stateless, seek-safe — same discipline as
// springEase; no CustomEase plugin, which is not in the house adapter set).
function m3EmphasizedEase() {
  const segs = [
    [0, 0, 0.05, 0, 0.133333, 0.06, 0.166666, 0.4],
    [0.166666, 0.4, 0.208333, 0.82, 0.25, 1, 1, 1],
  ];
  const at = (a, b, c, d, u) => {
    const v = 1 - u;
    return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
  };
  return (x) => {
    const s = x <= segs[0][6] ? segs[0] : segs[1];
    let lo = 0,
      hi = 1,
      u = 0.5;
    for (let i = 0; i < 24; i++) {
      // bisection on the monotone x-cubic — deterministic
      u = (lo + hi) / 2;
      if (at(s[0], s[2], s[4], s[6], u) < x) lo = u;
      else hi = u;
    }
    return at(s[1], s[3], s[5], s[7], u);
  };
}

// Android predictive-back PREVIEW values [A2] — drive by gesture progress 0→1;
// only for a depicted back SWIPE (button back = forward fade+slide reversed [A1]).
const PREDICTIVE_BACK = {
  commitThreshold: 0.35, // fade-through swap point
  exitScale: [1.0, 0.9], // outgoing 100% → 90%
  enterScale: [1.1, 1.0], // incoming 110% → 100%
  progressEase: "cubic-bezier(0, 0, 0, 1)", // STANDARD_DECELERATE
};

// Usage: tl.fromTo("#screenB", { xPercent: 30, opacity: 0 },
//   { xPercent: 0, opacity: 1, duration: M3_DUR.enter, ease: M3_EASE.emphasizedDecelerate }, t);
```

## Both platforms

- Navigation transitions stay plain: "Transitions are not receptive to highly stylized motion...
  Common transitions should not use overt style effects like bouncy springs" [A5]; Apple: "Add
  motion purposefully... Gratuitous or excessive animation can distract people" and "Aim for brevity
  and precision" [B9].
- Reduced-motion depictions: "Use subtle fades instead of intense sliding or scaling animations" and
  "Disable decorative effects like parallax or shape morphing" [A5]; Apple: "Make motion optional"
  [B9].

## See also

- `../blueprints/device-surface-showcase.md` — the stepwise-flow lateral advance ("old content slides
  out left, new in from right, chrome persists") takes the dialect: on an Android frame add the fade
  and shorten the travel [A1]; on an iOS frame add the background-at-partial-speed layer. The
  lockscreen card-expand-to-fill beat is the shared-element row of the table.
- `../blueprints/cursor-ui-demo.md` — "modal SPRINGS/scales up from center" and the side-panel
  slide-ins take the modal/drawer rows: the center spring-pop belongs to centered dialogs/alerts
  (critically damped on an iOS frame); sheets slide from the bottom edge [B3]; on an Android frame
  prefer axis expansion and avoid z-scale [A3].
- `../adapters/gsap-easing-and-stagger.md` — `springEase` implements the iOS registers (system
  default at dampingFraction 1.0; 0.80–0.85 ≈ SwiftUI `snappy`); M3 beziers drop straight into
  GSAP/CSS; the two-segment emphasized path bakes as a pure-function ease (Recipe above).
- `card-morph-anchor.md` / `scale-swap-transition.md` — the mechanics the shared-element
  and top-level rows ride on.
- Local relation grammar: `ui-nav-grammar` (which relation selects which move; this file flavors it).

## Sources

Android/M3 (content licensed Creative Commons Attribution; quotes verbatim):
[A1] https://m3.material.io/styles/motion/transitions/applying-transitions ·
[A2] https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back ·
[A3] https://m3.material.io/styles/motion/transitions/transition-patterns ·
[A4] https://m3.material.io/styles/motion/transitions/transition-patterns ·
[A5] https://m3.material.io/styles/motion/transitions/applying-transitions ·
[A6] https://m3.material.io/styles/motion/easing-and-duration/applying-easing-and-duration ·
[A7] https://m3.material.io/styles/motion/easing-and-duration/tokens-specs ·
[A8] https://m3.material.io/styles/motion/easing-and-duration/tokens-specs ·
[A9] https://m3.material.io/styles/motion/easing-and-duration/applying-easing-and-duration ·
[A10] https://m3.material.io/styles/motion/easing-and-duration/applying-easing-and-duration ·
[A11] https://m3.material.io/styles/motion/easing-and-duration/tokens-specs ·
[A12] https://m3.material.io/styles/motion/overview/specs ·
[A13] https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture

Apple (quotes verbatim from developer.apple.com):
[B1] https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions ·
[B2] https://developer.apple.com/design/human-interface-guidelines/navigation-bars ·
[B3] https://developer.apple.com/documentation/uikit/uimodaltransitionstyle/coververtical ·
[B4] https://developer.apple.com/design/human-interface-guidelines/sheets and
https://developer.apple.com/documentation/swiftui/view/fullscreencover(ispresented:ondismiss:content:) ·
[B5] https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions ·
[B6] https://developer.apple.com/documentation/swiftui/animation/default ·
[B7] https://developer.apple.com/documentation/swiftui/spring ·
[B8] https://developer.apple.com/documentation/uikit/uinavigationcontroller ·
[B9] https://developer.apple.com/design/human-interface-guidelines/motion
