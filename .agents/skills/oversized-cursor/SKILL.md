---
name: oversized-cursor
description: House-style oversized macOS cursor technique for HyperFrames launch videos. Load whenever a scene involves cursors or a pointer-led action, when kicking off a UI scene, when igniting a morph/transition/typing run with a click, or when a scene reads as static, dead, or stale and needs a cheap high-yield source of motion to carry the viewer's eye and segment them out of the stale state. Covers cursor size/look (incl. brand-motif cursors), the off-screen entry law, tip-targeting and the click tap, click-ignites-the-next-beat, and exit / cross-scene handoff.
---

# Oversized Cursor — the eye-carrier

A deliberately oversized macOS-style pointer that travels the frame as a _visible
protagonist_: it enters from off-screen, walks the viewer's eye to the next point of
interest, clicks to cause the next thing that happens, and leaves. Production-proven
across multiple launch films.

**Why it exists.** Big cursor movement is one of the cheapest high-yield motion sources
in a launch video: one element, transform-only tweens, and it (1) brings the eye across
the screen on scenes that would otherwise read as dead, (2) gives causal ignition to
morphs/transitions ("the click did that"), and (3) segments the eye out of a stale
state when kicking off a new scene or a complex animation sequence. Bigger is better —
an actual-size cursor disappears at video scale.

## Size & look (house convention)

- **Full-frame scenes: `7cqw`** (≈134px at 1920). In-mock / small-frame variants:
  `4.6–5.5cqw`. Never smaller.
- One SVG arrow geometry everywhere. Two proven fills — white body + black stroke, or
  black body (`#1c1c1c`) + white stroke (1.4px). Pick per scene contrast, keep it
  constant per film.
- **Brand-motif cursors (the power play).** The macOS arrow is the DEFAULT, not a
  mandate. When the subject brand has a recognizable cursor identity — a collaborative
  design tool's colored multiplayer arrow with a name tag (Figma-style), a creative
  suite's precision crosshair, a distinctive product pointer — use THAT cursor instead:
  instantly legible brand language for anyone who knows the product. Same laws apply
  unchanged (oversized scale, physical entry/exit, tip-targeting, click-ignition), and
  a name-tag variant travels as one rigid unit (tag trailing the arrow). Reach for it
  only when the motif is genuinely referenceable; a cursor nobody recognizes is just a
  weird arrow — default back to macOS.
- `filter: drop-shadow(0 4px 6px rgba(0,0,0,.3))`, `pointer-events: none`,
  `z-index` above all scene content, `will-change: transform`.

```css
#root .cursor {
  position: absolute;
  left: 48%;
  top: 115%; /* off-screen below — the resting pose IS off-screen */
  width: 7cqw;
  height: 7cqw;
  z-index: 20;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));
  pointer-events: none;
  will-change: transform;
}
```

## Entry law — physical, never revealed

The cursor **always enters from off-screen** (canonical: from below, `top:115–120%`)
and travels to its first target in one decelerating glide. It must _feel like it
entered the room_. Never opacity-fade it in at a resting position, never mask-reveal
it — that reads as a glitch (a real, repeatedly observed failure mode).

- Default path: **straight up the y-axis** to the target — no fragmented diagonals.
  A diagonal is fine when it IS the story (entering toward an off-axis target), but it
  is one continuous vector either way.
- `duration: 0.4–0.92s`, `ease: power3.out`, `immediateRender: false` on the fromTo.

```js
tl.fromTo(
  cursor,
  { left: "48.6%", top: "115%" },
  { left: "48.6%", top: "55%", duration: 0.85, ease: "power3.out", immediateRender: false },
  0.25,
);
```

## Tip-targeting & the click tap

The hot-spot is the arrow TIP, not the box center. Land the **tip** on the target's
center, and pivot all press scaling on the tip: `transformOrigin: '21% 14%'` (for the
house arrow path in a 24-unit viewBox).

Click = asymmetric compress/expand (1:2 ratio reads as a real tap):

```js
tl.to(cursor, { scale: 0.84, duration: 0.1, ease: "power2.in", transformOrigin: "21% 14%" }, t);
tl.to(
  cursor,
  { scale: 1, duration: 0.22, ease: "power2.out", transformOrigin: "21% 14%" },
  t + 0.1,
);
```

**The target's reaction is a separate, parallel tween** (button: `scale: 0.94` + press
color/shadow, starting at the same `t`). Cursor-only taps (e.g. focusing a text input)
get NO target reaction. Pair with `cursor-click-ripple` / `press-release-spring` for
the target side.

## The click IGNITES the next beat

Never let a morph, typing run, window transform, or scene-defining animation simply
_start_. Park the cursor on the trigger and let the click cause it, same-frame:

- click ▸ menu/submenu cascade, toggle flip
- click ▸ typing kickoff into an input
- click ▸ composer morph-down / window shrink
- click ▸ logo ignition / flight launch
- click ▸ play-state flip + UI-life wake in a product mock

During long beats it doesn't own (typing, narration), the cursor **drifts aside**
(0.5–0.9s, `power2.out`) — never sits frozen on top of the action, never wobbles idly.

## Exit law & cross-scene handoff

Two sanctioned exits — both physical, **never an opacity fade in place**:

1. **Leave the frame**: accelerate off the nearest edge with `power2.in`
   (`left:'118%'`, `left:'-12%'`, or `top:'116%'`), 0.5–0.7s.
2. **Cut-the-curve handoff**: in the final ~0.3s before a hard cut, the cursor starts
   accelerating (`power2.in`) toward the NEXT scene's first click point, covering the
   first ~1/3 of that path; the next composition `gsap.set`s the cursor at the
   handoff pose and continues with `power2.out` at matched velocity. The cursor itself
   becomes the carrier element that stitches the seam:

```js
// scene A, last 0.3s — start the journey:
tl.to(cursor, { left: "40.7%", top: "63.7%", duration: 0.3, ease: "power2.in" }, CUT - 0.3);
// scene B, t=0 — finish it at matched velocity:
gsap.set(cursorB, { left: "40.7%", top: "63.7%" });
tl.to(cursorB, { left: "22%", top: "45%", duration: 0.6, ease: "power2.out" }, 0);
```

## Checklist

- [ ] ≥ 7cqw full-frame (4.6–5.5cqw inside a mock) — when unsure, bigger
- [ ] enters from off-screen on one continuous vector (no fade/mask reveal)
- [ ] tip lands on the target center; press pivots on `transformOrigin: '21% 14%'`
- [ ] every click causes something, same-frame
- [ ] drifts aside during beats it doesn't own; zero idle wobble
- [ ] exits physically (off-frame or cut-the-curve handoff) — no fade-in-place
