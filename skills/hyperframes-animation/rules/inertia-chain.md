---
name: inertia-chain
description: Follow-the-leader secondary motion — every follower runs the leader's IDENTICAL tween, time-shifted by i × DELTA (≈ 2 frames) on the master timeline, so a stack or trail reads as one body with drag: the overshoot ripples down the chain and the tip settles last. Distinct from an entrance stagger, which offsets the start times of separate arrivals.
metadata:
  tags: inertia, chain, drag, follow-the-leader, secondary-motion, trail, stack, overlap, spring, offset, whip
---

# Inertia Chain

A title stack, a dotted trail, a ribbon of chips: when the leader moves, each follower replays the **same curve** a beat later. The group reads as one body with drag — the leader's overshoot travels down the chain and the last member settles last. The mechanism is time, not a second animation: every follower gets the leader's exact tween (same from/to, same ease, same duration) placed at `leaderAt + i × DELTA` on the master timeline.

Boundaries: an entrance **stagger** ([spring-pop-entrance.md](spring-pop-entrance.md), [waterfall-entry.md](waterfall-entry.md)) offsets the start of _separate_ arrivals so a group lands as one beat; the chain offsets one _continuing_ motion so a group moves as one object. A stagger ends when everyone has arrived; a chain persists through every subsequent move of the leader.

## How It Works

1. **One curve, many clocks.** Build the leader's tween once and give each follower `i` the identical tween at `leaderAt + i × DELTA`. The arrival move uses an entrance register (`snappy`, `heavy-settle` — `../adapters/gsap-easing-and-stagger.md` → Named Registers): the phase lag alone is the drag. A later settle-back or recovery move — the group returning after contact — may use a recovery register (`bouncy`); its overshoot is what makes the ripple down the chain visible.
2. **DELTA is frames, not a fraction of the tween** — ~2 frames at the composition fps for a tight body, 3–5 for a loose tail. The chain's "drag" is the visible phase lag between neighbours.
3. **Every later move of the leader gets the same treatment** — the chain is a property of the group, so a second move (a settle-back, a nudge) is placed with the same per-member offsets.
4. **A follower that must travel further** (trail dots crossing more distance than the leader) runs the same register with a larger `response` — `springEase({ ...register, response: register.response × k })` — the same normalized curve over a longer physics-derived settle. Never a stretched duration (`../adapters/gsap-easing-and-stagger.md` → Duration Is an Output).

## Recipe

```html
<div class="chain-stack" id="chain-stack">
  <div class="chain-row">{lineA}</div>
  <div class="chain-row">{lineB}</div>
  <div class="chain-row">{lineC}</div>
  <div class="chain-row">{lineD}</div>
</div>
```

```js
// Two curves, durations from the helper: an entrance register for the arrival, a recovery register for the settle-back.
const arrive = springEase(SPRING_REGISTERS.snappy); // the arrival move — the phase lag alone is the drag
const recover = springEase(SPRING_REGISTERS.bouncy); // the settle-back after contact — its overshoot ripples down the chain
const DELTA = 2 / FPS; // 2 frames

// Move 1: the stack slides in. Same tween per row, time-shifted.
gsap.utils.toArray(".chain-row").forEach((row, i) => {
  tl.fromTo(
    row,
    { x: FROM_X },
    { x: TO_X, duration: arrive.duration, ease: arrive.ease },
    MOVE_AT + i * DELTA,
  );
});

// Move 2: the leader settles back after the contact; the chain drags the same way and the overshoot travels down it.
gsap.utils.toArray(".chain-row").forEach((row, i) => {
  tl.to(row, { x: REST_X, duration: recover.duration, ease: recover.ease }, MOVE2_AT + i * DELTA);
});

// Trail dots crossing more distance: the same register with a longer response, not a stretched duration.
const trail = springEase({
  ...SPRING_REGISTERS["heavy-settle"],
  response: SPRING_REGISTERS["heavy-settle"].response * 1.4,
});
gsap.utils.toArray(".trail-dot").forEach((dot, i) => {
  tl.fromTo(
    dot,
    { x: TRAIL_FROM_X },
    { x: TRAIL_TO_X, duration: trail.duration, ease: trail.ease },
    TRAIL_AT + i * DELTA,
  );
});
```

## Variations

- **Path leader** — when the leader follows a function of time rather than a tween (a driven cursor, a tracked point), followers evaluate `leaderFn(t − i × DELTA)` inside one timeline-driven `onUpdate` (an `ease: "none"` proxy tween): the same pure lookup, time-shifted, no state.
- **Whip** — larger `DELTA` (4–5 frames) on the `snappy` arrival: the tail cracks after the head.
- **Rotation chain** — the same time-shifted tween on `rotation` for a hanging sign or a ribbon of cards; combine with [follow-through.md](follow-through.md) when the leader's own ease arrives with velocity.
- **Two-axis** — x and y on the same offsets; keep both from one tween so the phase lag stays identical per axis.

## Values

| token        | range                                                     | notes                                                                                                                                    |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| DELTA        | 2 frames (tight) – 5 (loose)                              | in seconds: `frames / FPS`; more than ~6 frames stops reading as one body                                                                |
| N (members)  | 3–12                                                      | a 12-dot trail and a 5-line stack both read; keep `N × DELTA ≤ ~0.8 s`                                                                   |
| register     | arrival: `snappy` / `heavy-settle`; settle-back: `bouncy` | recovery registers only on the post-contact move — never on the slide-in (`../adapters/gsap-easing-and-stagger.md` → Recovery Registers) |
| response × k | 1.2–1.6 for longer-travel followers                       | scale `response`, never the duration                                                                                                     |

## Critical Constraints

- **Identical tween per member** — same from/to, ease and duration; only the timeline position differs. A per-member ease or duration breaks the one-body read.
- **Offsets are frames at the composition fps** — never a fraction of the tween duration (a longer tween would loosen the chain).
- **Every leader move is chained** — a second move without the offsets snaps the group back into lockstep and reads as a cut.
- **`fromTo` with explicit from-states** for the first move (t=0 correct under seek); later moves are absolute `to` values, never relative `+=`.
- Head-to-tail lag `N × DELTA ≤ ~0.8 s` (a 12-member trail at 2 frames, 30 fps) — past that the tail is a separate arrival, not drag. This lag is drag on a continuing move, not the entrance-stagger cap: the chain's own slide-in still lands inside one beat (`items × stagger ≤ ~0.5 s`, rules-index contract).

## See also

`follow-through` (a ring composed into the leader's ease, rippled by the chain) · `spring-pop-entrance` / `waterfall-entry` (arrival staggers — not chains) · `cursor-drag` (a ghost riding a cursor in exact lockstep is the zero-DELTA case) · `nudge-curve` (a group slide that can be chained).
