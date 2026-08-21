---
name: multi-cursor-choreography
description: N labeled independent cursor actors work one canvas simultaneously (collaborative-canvas ambience) — per-cursor deterministic waypoint schedules, name-tag pills in distinct colors, grab/drop actions on an interleaved beat grid so paths and actions never collide; the camera stays locked, the liveness itself is the message.
metadata:
  tags: cursor, multi-cursor, collaboration, ensemble, canvas, name-tag, choreography, ambient, teamwork
---

# Multi-Cursor Choreography

> **The camera never chases anyone.** No real camera — any "pan" is the canvas group translating inside a static frame. And per the motion doctrine's idle-motion ban, every cursor must **perform**: travel to a target, act, then rest still. Scheduled rest is stillness; aimless wander loops are wobble.

THE ensemble primitive: **two to four labeled cursor actors** — each an arrow plus a name-tag pill in its own color — work one shared canvas at the same time. No single interaction is the subject; the **simultaneous liveness is** ("a team is in here, working"), usually as ambience under a headline building over the top. Distinct from [cursor-click-ripple.md](cursor-click-ripple.md) and [cursor-drag.md](cursor-drag.md): those are **one protagonist** the viewer follows click-by-click; here the actors are chorus, not lead — each action smaller and quieter than a solo cursor's, the value in the interleaving. Also distinct from [camera-cursor-tracking.md](camera-cursor-tracking.md): that locks the _viewport_ to one focal cursor; this rule forbids exactly that — the frame is static and the eye roams freely.

## How It Works

Everything hangs off one data table:

1. **The actor table** — a literal `ACTORS` array: per actor a name, a color, and a **waypoint schedule** (`{ x, y, at, dur }` legs plus action beats). All coordinates and times are hand-authored constants — the choreography is data: deterministic, seekable, and auditable for collisions before a single frame renders.
2. **Legs as explicit `fromTo`s** — each leg tweens the actor wrapper from the previous waypoint to the next at an absolute position. Gaps between legs are **rests**: the cursor sits still exactly where it landed.
3. **Actions** — a leg can end in a grab (press dip; the payload rides the next leg in lockstep — [cursor-drag.md](cursor-drag.md) mechanics at chorus intensity), a drop (`tl.set` identity swap + tiny settle pop), or a hover (a highlight fades in under the tip, once, then holds).
4. **The interleaved beat grid** — actions land on **alternating beats** (~1.2 / 2.6 / 4.0 s): at any moment at most one action lands while the others glide or rest. Each actor owns a home **zone** of the canvas; only one actor at a time leaves its zone, so paths never cross near-simultaneously. (Short specimens under ~5s can compress beat spacing to ~0.3–0.9s — zones still prevent collisions; the ≥1s spacing is for ambience-length shots.)
5. **Ambience staging** — cursors may already be mid-canvas at t=0 (the team was working before we arrived — the collaborative-canvas idiom), or enter off-frame on staggered starts. The canvas group may slowly translate-pan under the ensemble (element translate, not a camera).

## Recipe

```html
<!-- Canvas group (mockups + payload chips) may translate for an ambient pan.
     One wrapper per actor: arrow + name tag move as ONE object. -->
<div class="canvas-group" id="canvas-group">
  <div class="mockup" id="mockup-a">{mockupA}</div>
  <div class="canvas-chip" id="chip-1">{chipLabel}</div>
</div>
<div class="actor" id="actor-1">
  <svg class="actor-arrow"><!-- arrow path, fill: ACTOR_1_COLOR --></svg>
  <span class="actor-tag" style="background: ACTOR_1_COLOR">{actorName1}</span>
</div>
```

```js
// The choreography IS this table — all literals; read the `at` columns to
// verify beats interleave. Each actor owns a zone.
const ACTORS = [
  {
    id: "#actor-1", // zone: left mockup
    legs: [
      { from: { x: 180, y: 420 }, to: { x: 320, y: 300 }, at: 0.2, dur: 0.9 },
      { to: { x: 340, y: 480 }, at: 2.0, dur: 0.8 }, // rest 0.9s between legs
    ],
  },
  {
    id: "#actor-2", // zone: center mockup
    legs: [
      { from: { x: 900, y: 200 }, to: { x: 820, y: 360 }, at: 0.6, dur: 1.0 },
      { to: { x: 980, y: 380 }, at: 3.4, dur: 0.7 },
    ],
  },
  {
    id: "#actor-3", // zone: right panel — enters from off-frame
    legs: [{ from: { x: 1980, y: 520 }, to: { x: 1560, y: 460 }, at: 1.4, dur: 1.1 }],
  },
];

ACTORS.forEach((actor) => {
  let prev = actor.legs[0].from;
  tl.set(actor.id, { x: prev.x, y: prev.y }, 0); // on stage (or off) from t=0
  actor.legs.forEach((leg) => {
    tl.fromTo(
      actor.id,
      { x: prev.x, y: prev.y },
      { x: leg.to.x, y: leg.to.y, duration: leg.dur, ease: "power2.inOut", immediateRender: false },
      leg.at,
    );
    prev = leg.to;
  });
});

// Actions at chorus intensity — actor 1 grabs the chip: press dip, then the
// chip rides leg 2 in lockstep (matched tween: same position, duration, ease).
tl.to("#actor-1", { scale: 0.88, duration: 0.07, ease: "power2.in", yoyo: true, repeat: 1 }, 1.1);
tl.fromTo(
  "#chip-1",
  { x: 0, y: 0 },
  { x: CHIP_DX, y: CHIP_DY, duration: 0.8, ease: "power2.inOut", immediateRender: false },
  2.0, // = actor-1 leg 2 `at` and `dur`, exactly
);
// Drop: identity swap + tiny settle — quieter than a solo cursor's snap
tl.set("#chip-1", { backgroundColor: "{chipSwapColor}" }, 2.8);
tl.fromTo(
  "#chip-1",
  { scale: 1.06 },
  { scale: 1, duration: 0.2, ease: "power3.out", immediateRender: false },
  2.8,
);

// Optional ambient canvas pan (element translate, NOT a camera)
tl.fromTo("#canvas-group", { x: 0 }, { x: PAN_DX, duration: 6.0, ease: "none" }, 0.3);
```

## Variations

- **Ambient collaborative canvas (the Hook register)** — the default: actors mid-canvas at t=0, canvas slowly panning, a headline building over the top ([waterfall-entry.md](waterfall-entry.md)). The demo is set-dressing for the words; keep every action small and the beat grid loose.
- **One labeled editor (N = 1, still ensemble-styled)** — a single labeled teammate cursor performs one visible edit (deletes and retypes a headline word via [discrete-text-sequence.md](discrete-text-sequence.md), or drops one component). The name tag is the point: _a person_ did this.
- **Featured beat inside the ensemble** — one actor briefly becomes the lead: full [cursor-drag.md](cursor-drag.md) grab-carry-drop with chrome while the others explicitly REST for that window. Freeze the chorus; two things moving with intent at once splits the eye.
- **Staggered entrances** — cursors enter from off-frame at `ENTER_AT + i * ENTER_STAGGER`, each gliding to its zone ("the team assembles"); entry vectors from different edges, per the house cursor entry law.

## Values

| token               | range                     | notes                                                                                                                        |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ACTOR_COUNT         | 2–4                       | one is a solo rule's job; five+ reads as noise — no viewer tracks five pointers                                              |
| leg `dur`           | 0.6–1.2 s, `power2.inOut` | human, considered mouse movement; sub-0.5 s across long distances reads as a teleport                                        |
| rest gaps           | 0.5–1.5 s                 | rests make the ensemble read as people; zero-rest actors read as screensavers                                                |
| action beat spacing | ≥ 1.0 s                   | while one acts, others may glide but must not act — audit by sorting all `at` values                                         |
| zones               | one per actor             | only the acting actor crosses zones; two cursors within ~80 px reads as a glitch — check waypoint pairs at overlapping times |
| PAN_DX              | ~40–80 px, linear         | parallax life, not a camera move; omit for busier ensembles                                                                  |
| tag / arrow size    | smaller than a solo lead  | the oversized-cursor treatment is for protagonists; tags must stay legible at render resolution                              |
| colors              | one saturated hue each    | from the palette's accent range; tag pill and arrow fill share the hue                                                       |

## Critical Constraints

- **The table is the choreography** — all waypoints, times, and actions are literal data. If you can't verify non-collision by reading the `at` columns, the schedule is too clever.
- **Every leg is an explicit `fromTo`** with the previous waypoint as the from-state, `immediateRender: false` on all but each actor's initial placement — chained `.to()`s on shared properties capture stale starts under seek.
- **Interleave, never chord** — at most one action landing at any moment; simultaneous travel is fine (that's the liveness), simultaneous _payoffs_ compete.
- **Chorus intensity** — every action is a quieter version of its solo rule: smaller dips, subtler snaps, no ripple bursts; save full treatment for a featured beat.
- **Rest is stillness** — between legs a cursor holds exactly where it landed: no idle drift, no yoyo wander on any actor.
- **Payload lockstep** — a carried chip's tween matches its actor's leg exactly (position, duration, ease), per the cursor-drag law.
- **The wrapper moves, never the parts** — arrow + name tag are one element; tweening them separately shears the actor apart under seek.
- **Camera locked** — no viewport zoom/pan tweens; the only large-scale motion is the linear canvas-group translate. Never zoom to an actor (that's a solo-cursor shot).
- **Actors are people** — human-speed glides, pauses, one thing at a time; `pointer-events: none` on all actors. Check `tl.duration()` — ensembles accumulate long tails from late rests.

## See also

`cursor-drag` (full-treatment featured beat) · `cursor-click-ripple` (chorus click — press only, skip the ripple) · `discrete-text-sequence` (a labeled actor's retype edit) · `viewport-change` (the canvas-group translate math) · `spring-pop-entrance` (components popping in as drop results).
