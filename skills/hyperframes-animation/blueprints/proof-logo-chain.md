---
id: proof-logo-chain
role: social-proof
duration_seconds: [6, 10]
phases: 5
visual_arc: brand-decode → text-swap → logo-centers → avatars-network → brand-logos
uses_rules: [hacker-flip-3d, vertical-spring-ticker, coordinate-target-zoom, avatar-cloud-network]
element_roles:
  anchor: Logo that threads across all shots, repositioning as the visual link
  decode_text: Brand name revealed via hacker-flip alongside the anchor
  swap_text: Replacement text sliding in after the decode (e.g., "#1 AI tool")
  counter: Numeric/short label (e.g., "60 FPS", "12M+") appearing with the avatar cloud
  avatars: User avatars on an elliptical ring around the anchor
  endorsement_logos: Partner / brand logos scrolling at the bottom
when_to_use:
  - Brand authority via multiple progressive proof points
  - Logo threads multiple shots as the visual link
  - 3-4 distinct claims packed in one continuous sequence
when_not_to_use:
  - Single-beat scene, no progression
  - No persistent brand element available
  - Authority from a single source only
triggers: [brand reveal, social proof, "#1 tool", million users, trusted by]
---

# Proof · Logo Chain (HyperFrames)

Logo + hacker-flip text → text swaps to claim → logo repositions center → avatar cloud builds around logo → brand endorsement logos appear.

This blueprint is the HyperFrames port of the Remotion `anchor-chain-reveal` choreography. The visual arc is identical; the implementation uses a single paused GSAP timeline driven by HyperFrames' seek loop instead of Remotion's frame-based render.

## When to Use

- Authority/credibility scene with progressive proof stacking
- A brand logo should anchor the viewer's attention across multiple content changes
- Scene packs 3-4 distinct claims into one continuous sequence

## Phase Pipeline

All phase boundaries are expressed in **seconds**, not frames. HyperFrames operates on continuous time; GSAP tween durations carry the choreography.

| Phase | Time window (s)               | What Happens                                                               | Skill Reference                                                              |
| ----- | ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1     | `0 – decodeEnd`               | Logo pops in + brand name decodes via hacker-flip                          | [hacker-flip-3d](../rules/hacker-flip-3d.md)                                 |
| 2     | `swapTrigger – swapEnd`       | Brand name slides out, claim text slides in; logo + container shift left   | [vertical-spring-ticker](../rules/vertical-spring-ticker.md) or inline slide |
| 3     | `recenterTrigger – +0.9`      | Claim text exits, logo shifts to screen center + optional vertical adjust  | [coordinate-target-zoom](../rules/coordinate-target-zoom.md) (shift only)    |
| 4     | `avatarsTrigger – avatarsEnd` | Counter appears top, avatar cloud builds around logo with connection lines | [avatar-cloud-network](../rules/avatar-cloud-network.md)                     |
| 5     | `logosTrigger – end`          | Partner brand logos stagger-enter at bottom with horizontal scroll         | inline                                                                       |

## Layout

Logo and text in a centered flex row. Logo is the persistent element; text container is the swappable element. Both wrapped in a translation container for recentering. **All transforms use GSAP transform aliases (`x`, `y`, `scale`)**, never CSS `left` / `top` — the HyperFrames allowlist forbids layout-property tweens.

```html
<div
  class="anchor-stage"
  style="position: absolute; inset: 0;
     display: flex; align-items: center; justify-content: center;"
>
  <!-- shift container: GSAP tweens .x on this element for recentering -->
  <div class="anchor-shift" style="display: flex; align-items: center; gap: 35px;">
    <!-- Anchor: logo — persists across all phases, z-index above everything else -->
    <div
      class="anchor-logo"
      style="
         position: relative;
         width: 192px; height: 192px;
         z-index: 100;
         transform: scale(0);"
    >
      <img
        src="./assets/logo.png"
        style="width:100%; height:100%; object-fit:contain;
           filter: drop-shadow(0 4px 24px rgba(0,0,0,0.4));"
      />
    </div>

    <!-- Swappable text zone — fades out in Phase 3 -->
    <div class="anchor-text" style="position: relative; display: flex; align-items: center;">
      <!-- Phase 1: hacker-flip brand name (see hacker-flip-3d.md) -->
      <div class="phase1-text" style="display: flex; perspective: 800px; white-space: nowrap;">
        <!-- one .flip-glyph per character -->
      </div>

      <!-- Phase 2: claim text — absolutely positioned at phase1-text's origin -->
      <div
        class="phase2-claim"
        style="position: absolute; left: 0; top: 50%;
           transform: translateY(-50%); opacity: 0; white-space: nowrap;
           display: flex; align-items: center; gap: 0.25em;"
      >
        <span class="claim-rank">#1</span>
        <span class="claim-ai">AI</span>
        <span class="claim-video">video</span>
        <!-- vertical-spring-ticker swaps "clipping" ↔ "editing" -->
        <div class="claim-ticker"><!-- ticker structure here --></div>
      </div>
    </div>
  </div>
</div>
```

## Phase 2: Text Swap (Core Glue)

A single tween position drives three concurrent animations: old text slides out, container shifts left, new text fades in. The "single spring" in the Remotion source becomes **multiple GSAP tweens started at the same timeline position**, which is the GSAP idiom for parallel motion.

```js
const SWAP_TRIGGER = 1.1; // seconds
const SWAP_DUR = 0.55;
const SLIDE_DIST = 200; // px — how far the old text slides right
const RECENTER_OFFSET = -420; // px — PRE-CALCULATED constant, never derived

// All three tweens at the same timeline position → fire in parallel.
tl.to(
  ".phase1-text",
  {
    x: SLIDE_DIST,
    opacity: 0,
    duration: SWAP_DUR * 0.5, // exit completes by mid-swap
    ease: "power3.out",
  },
  SWAP_TRIGGER,
);

tl.to(
  ".anchor-shift",
  {
    x: RECENTER_OFFSET,
    duration: SWAP_DUR,
    ease: "power3.out", // approximates spring(stiffness:80, damping:18)
  },
  SWAP_TRIGGER,
);

tl.fromTo(
  ".phase2-claim",
  { opacity: 0 },
  { opacity: 1, duration: SWAP_DUR * 0.6, ease: "power2.out" },
  SWAP_TRIGGER + SWAP_DUR * 0.2, // claim fades in after old text begins exit
);
```

**`RECENTER_OFFSET` must be a pre-calculated constant.** Dynamic calculation (e.g. `phase2.offsetWidth - phase1.offsetWidth`) drifts sub-pixels between renders and causes a visible jitter when the camera scales the wrapping shift container. Measure once at design time, bake in.

## Phase 3: Logo Recenters

The text zone fades out completely. The logo translates from its left-offset position to true screen center and lifts slightly to make room for the counter and avatars about to enter. This is the moment the logo becomes the sole focal point.

```js
const RECENTER_TRIGGER = 3.87; // seconds (after Phase 2 settles)
const RECENTER_DUR = 0.9;
const CENTER_OFFSET = 326; // px to the right — undoes RECENTER_OFFSET + extra
const VERTICAL_ADJUST = -54; // px upward (logo lifts to make space)

// Text fades out.
tl.to(
  ".anchor-text",
  {
    opacity: 0,
    duration: 0.3,
    ease: "power2.out",
  },
  RECENTER_TRIGGER,
);

// Logo glides to center + lifts up. Two tweens, same start, longer duration.
tl.to(
  ".anchor-logo",
  {
    x: CENTER_OFFSET,
    y: VERTICAL_ADJUST,
    duration: RECENTER_DUR,
    ease: "power2.out", // approximates spring(stiffness:45, damping:22) — gentle
  },
  RECENTER_TRIGGER,
);
```

`VERTICAL_ADJUST` is small and upward — it lifts the logo so the avatar cloud (centered at ~42% of composition height) lands around the logo, not below it.

## Phase 4: Avatar Cloud

The logo is now at center. Counter appears above. Avatars build on the elliptical ring around the logo. Connection lines draw from logo to each avatar.

See [avatar-cloud-network](../rules/avatar-cloud-network.md) for the full pattern. The **logo (anchor) serves as the network center point** — its post-Phase-3 position must match the cloud's `CENTER_X / CENTER_Y` constants exactly. This is the single most-likely-to-drift coordinate in the whole blueprint; bake both numbers from the same source.

Counter sits above the cloud (e.g. a static `60FPS` label) with a brief scale pulse on entry.

## Phase 5: Brand Endorsement

Partner logos enter at the bottom with a staggered scale tween and a finite horizontal scroll.

```js
const LOGOS_TRIGGER = 5.4;
const SCROLL_DUR = 4.0; // remaining composition time
const LOGO_WIDTH = 180; // px per logo slot

// Stagger entry — same pattern as avatar cloud.
tl.to(
  ".brand-logo",
  {
    scale: 1,
    opacity: 0.7,
    duration: 0.5,
    ease: "back.out(1.4)",
    stagger: { each: 0.1, from: "start" },
  },
  LOGOS_TRIGGER,
);

// Finite horizontal scroll. NOT repeat: -1 — compute distance from remaining time.
tl.to(
  ".brand-logo-strip",
  {
    x: -LOGO_WIDTH * 4, // four logos travel left
    duration: SCROLL_DUR,
    ease: "none",
  },
  LOGOS_TRIGGER,
);
```

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Decode must settle before swap triggers.
  SWAP_TRIGGER ≥ last-character-decode-end + ~0.33s (≈20 frames at 60fps).

Phase 2 → Phase 3:
  RECENTER_OFFSET (Phase 2 shift) feeds CENTER_OFFSET in Phase 3.
  Both are pre-calculated constants, not derived at render time.

Phase 3 → Phase 4:
  Logo final position (CENTER_OFFSET applied to .anchor-logo) defines the
  cloud center. Bake those coordinates into the cloud constants:
    cloud CENTER_X = composition_width / 2  + (shift result)
    cloud CENTER_Y = composition_height / 2 + VERTICAL_ADJUST
  AVATARS_TRIGGER ≥ RECENTER_TRIGGER + ~0.42s (recenter ease settles).

Phase 4 → Phase 5:
  Avatars + counter remain visible (no exit tween).
  Brand logos enter independently at bottom. No value dependency.
```

## Critical Constraints

- **Logo z-index highest**: `z-index: 100`. Logo must always sit above connection lines (z:1), avatars (z:10), and text (no z).
- **Pre-calculated offsets**: `RECENTER_OFFSET`, `CENTER_OFFSET`, `VERTICAL_ADJUST` are constants. **Never** derive from `getBoundingClientRect()` at tween time — sub-pixel drift compounds across the camera scale and produces visible jitter.
- **Camera wrap**: All phases share a single `data-composition-id` root so the optional camera drift/scale tween wraps everything coherently. Don't split phases across sub-compositions unless you also share the camera transform.
- **Avatar cloud center = logo position**: After Phase 3, the cloud center coordinates must match the logo's final position exactly. The number is computed once and used in both places.
- **Text swap is position-fixed**: `.phase2-claim` renders at `.phase1-text`'s origin (absolute within the flex row), not at a new location. This is what makes the swap read as "in place."
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never tween `left`, `top`, `width`, `height` — they trigger layout reflows and are forbidden by the HyperFrames animated-property allowlist.
- **Single paused timeline**: One `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`. HyperFrames seeks it.
- **No infinite repeats**: Brand logo scroll uses a finite `duration`. If you want continuous-looking scroll, oversize the strip and tween it the visible distance.
- **`data-duration` on the root** governs total render time. The GSAP timeline's intrinsic length is irrelevant to the renderer.

## Remotion → HyperFrames Cheatsheet

Quick reference for porting the rest of this skill from the Remotion source:

| Remotion concept                                             | HyperFrames equivalent                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `useCurrentFrame()`                                          | GSAP `tl.time()` (seconds) — used inside `onUpdate` callbacks only                                                                     |
| `useVideoConfig().fps`                                       | Constant `FPS = 60` only if you need frame-discrete bucketing (e.g. flicker)                                                           |
| `useVideoConfig().width / height`                            | Constants matching `data-width` / `data-height` on the composition root                                                                |
| `spring({ frame, fps, config })`                             | GSAP tween with a matching ease (`back.out`, `power2.out`, `power3.out`) — see mapping in [hacker-flip-3d](../rules/hacker-flip-3d.md) |
| `interpolate(frame, [a,b], [x,y], { extrapolate: 'clamp' })` | `gsap.to(el, { value: y, duration: (b-a)/fps, ease: '…' })` — duration replaces the explicit range                                     |
| `<AbsoluteFill>`                                             | `<div style="position: absolute; inset: 0;">`                                                                                          |
| `<Img src={staticFile("logo.png")}>`                         | `<img src="./assets/logo.png">`                                                                                                        |
| `random(seed)`                                               | Pre-computed integer hash: `((i * 374761393 + t * 668265263) >>> 0)`                                                                   |
| React component                                              | HTML element with classes, generated via JS where needed                                                                               |
| `frame * 0.003` (continuous drift)                           | Finite `yoyo` tween with computed repeats                                                                                              |

## Golden Sample

- [proof-logo-chain.html](../examples/proof-logo-chain.html) — full Authority scene: hacker-flip "HyperFrames" → `HTML Video` lockup with rolling `render / ship` ticker → logo recenters → `60 FPS` counter with scale-pulse + avatar cloud + SVG connection lines → partner brand logos scroll. Single paused GSAP timeline drives all five phases.
