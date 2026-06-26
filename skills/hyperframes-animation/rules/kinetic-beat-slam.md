---
name: kinetic-beat-slam
description: Percussive kinetic typography — short phrases slam in on a steady beat with distinct per-phrase entrances, optional rhythm chrome (metronome ticks, beat bar), then a locked finale.
metadata:
  tags: text, kinetic, typography, beat, rhythm, slam, percussive, punchy
---

# Kinetic Beat Slam

Short phrases hit one at a time on a **steady beat**, each with a _different_ entrance, then stack into a locked finale. This is the recipe for "punchy / rhythmic" text-forward pieces (taglines, manifestos, hype intros). The difference between generic and rhythmic is (1) one shared **onset array** driving every element, (2) **distinct** entrances per phrase rather than one reused helper, and (3) optional **rhythm chrome** that visibly keeps the beat.

## How It Works

1. **Define the beat once.** A single `BEATS = [t0, t1, t2, …]` array (seconds) is the rhythmic spine. Every phrase entrance, accent, and chrome tick reads its time from this array — so the whole piece locks to one pulse instead of drifting hand-tuned offsets.
2. **Vary the entrances.** Phrase 1 slams (scale + blur), phrase 2 snaps from the side, phrase 3 rises and rotates. Same _energy_, different _form_ — reusing one `punchIn()` for all three reads as flat.
3. **Land a finale.** All phrases lock into a left-aligned or centered stack; an accent underline sweeps in; optionally a continuous low-amplitude pulse holds the last beat.

## Beat & Easing

Pick the entrance easing by attack character (the choice is discrete):

| GSAP ease     | Attack feel                                 |
| ------------- | ------------------------------------------- |
| `power4.out`  | Hard slam, fast settle ⭐ default for a hit |
| `expo.out`    | Hardest snap (side-snaps, whip-ins)         |
| `back.out(2)` | Overshoot pop — accents, not body words     |
| `circ.out`    | Heavy rise with momentum                    |

Use **at least 3 distinct easings** across the piece (entrances are its "tone of voice"). Keep durations short — 0.35–0.6s on the hit, ≤0.25s on the exit — so the beat stays percussive.

## HTML

```html
<section class="clip" data-start="0" data-duration="15" data-track-index="1">
  <div class="kbs-stage">
    <div class="kbs-line" id="p1"><span class="verb">Notice</span> more.</div>
    <div class="kbs-line" id="p2"><span class="verb">Decide</span> faster.</div>
    <div class="kbs-line" id="p3"><span class="verb">Act</span> now.</div>
  </div>
  <!-- optional rhythm chrome -->
  <div class="kbs-metronome" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
</section>
```

## CSS

```css
.kbs-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 120px 160px; /* title-safe margin */
  box-sizing: border-box;
}
.kbs-line {
  font-family: "Archivo Black", "League Gothic", sans-serif; /* embedded display face */
  font-size: 150px;
  line-height: 0.96;
  letter-spacing: -0.03em;
  color: #f5f5f5;
  will-change: transform, filter, opacity;
}
.kbs-line .verb {
  color: #ff5b2e;
} /* one accent hue */
.kbs-metronome {
  position: absolute;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 14px;
}
.kbs-metronome i {
  width: 6px;
  height: 28px;
  background: #ff5b2e;
  opacity: 0.25;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ONE tempo grid drives everything — phrases AND the metronome read it (no scattered offsets).
  const PULSE = 0.4; // seconds per sub-beat (the grid)
  const BEATS = [PULSE * 1, PULSE * 5, PULSE * 9]; // phrase onsets, on the grid

  // Distinct entrances per phrase (NOT one reused helper).
  tl.fromTo(
    "#p1",
    { scale: 1.5, filter: "blur(16px)", opacity: 0 },
    { scale: 1, filter: "blur(0px)", opacity: 1, duration: 0.5, ease: "power4.out" },
    BEATS[0],
  );
  tl.fromTo(
    "#p2",
    { x: -320, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.45, ease: "expo.out" },
    BEATS[1],
  );
  tl.fromTo(
    "#p3",
    { y: 90, rotation: 6, opacity: 0 },
    { y: 0, rotation: 0, opacity: 1, duration: 0.55, ease: "circ.out" },
    BEATS[2],
  );

  // Rhythm chrome: each metronome tick flashes on the SAME grid (PULSE), not a magic offset.
  const ticks = gsap.utils.toArray(".kbs-metronome i");
  ticks.forEach((tick, i) => {
    tl.to(
      tick,
      { opacity: 1, duration: 0.08, yoyo: true, repeat: 1, ease: "none" },
      PULSE * (i + 1),
    );
  });

  // Finale hold: a low-amplitude breath on the locked stack.
  // floor (not ceil) so the repeat never overshoots data-duration; max(0,…) so a short hold
  // never yields a negative repeat (GSAP treats negative repeat as -1 = infinite = non-deterministic).
  const holdStart = BEATS[2] + 0.7,
    cycle = 1.6,
    holdDur = 15 - holdStart;
  tl.to(
    ".kbs-stage",
    {
      scale: 1.01,
      duration: cycle / 2,
      ease: "sine.inOut",
      yoyo: true,
      repeat: Math.max(0, Math.floor(holdDur / cycle) - 1),
    },
    holdStart,
  );

  window.__timelines["main"] = tl;
</script>
```

## How to Choose Values

- **BEATS spacing** — 1.2–1.8s between hits reads as a confident beat; <0.8s feels frantic, >2.5s loses the pulse. Keep spacing even (it's a _beat_).
- **Entrance duration** — 0.35–0.6s. The hit must resolve before the next beat.
- **Distinct entrances** — assign a different transform axis per phrase (scale / x / y+rotate). Reuse the _ease family_, vary the _motion_.
- **Accent hue** — exactly one (the verbs). The rest is mono white/near-black.
- **Rhythm chrome** — optional but high-impact for "rhythmic": a 5-tick metronome, a center beat bar, or a `// label` monospace tag pulsing on-beat. Mark any decorative that must survive a shader transition per `../../transitions/overview.md` rules.

## Key Principles

- **One beat array, not scattered offsets** — every element times off `BEATS[]`. This is the single biggest lever for "rhythmic."
- **Different entrance per phrase** — a reused `punchIn()` for all lines is the flat-but-competent tell.
- **Short attacks** — percussive means fast in, brief, decisive. Long fades kill the beat.
- **One accent hue, heavy weight** — embedded display faces (Archivo Black, League Gothic, Oswald) at 150px+; see `hyperframes-creative/references/typography.md`.
- **Finale earns the hold** — stack + underline sweep + optional breath; don't just leave the last phrase sitting.

## Critical Constraints

- **Timeline paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`.
- **No infinite repeats** on the hold/chrome — use `repeat: Math.max(0, Math.floor(dur / cycle) - 1)` (no `repeat: -1`). Use **`Math.floor`, not `Math.ceil`** — `ceil` overshoots `data-duration` and trips the `gsap_repeat_ceil_overshoot` lint rule; the `Math.max(0, …)` guards against a negative repeat (which GSAP reads as `-1` = infinite = non-deterministic) when the hold is shorter than two cycles.
- **No banned exit animations** between scenes — if this is one of several scenes, the _transition_ is the exit (see `../../transitions/overview.md`); only a final scene may fade out.
- **Display font must be embedded** or it silently falls back at render (Anton/Bebas-as-literal are NOT embedded — `Bebas Neue` aliases to League Gothic; verify in `typography.md`).
- **Registry key = `data-composition-id`** on the root.

## Combinations

- [3d-text-depth-layers.md](3d-text-depth-layers.md) — extruded depth on the slammed words
- [css-marker-patterns.md](css-marker-patterns.md) — underline sweep / circle on the finale
- [sine-wave-loop.md](sine-wave-loop.md) — the finale breath/pulse

## Pairs with HF skills

- `/hyperframes-animation` — timeline + easing vocabulary (`../../adapters/gsap-easing-and-stagger.md`)
- `/hyperframes-creative` — `references/video-composition.md` (foreground rhythm chrome), `references/typography.md` (embedded display fonts)
- `/hyperframes-core` — composition wiring, determinism (finite repeats)
