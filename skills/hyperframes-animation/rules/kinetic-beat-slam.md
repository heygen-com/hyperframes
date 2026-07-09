---
name: kinetic-beat-slam
description: Percussive kinetic typography - short phrases slam in on a steady beat with distinct per-phrase entrances, optional rhythm chrome (metronome ticks, beat bar), then a locked finale.
metadata:
  tags: text, kinetic, typography, beat, rhythm, slam, percussive, punchy
---

# Kinetic Beat Slam

Short phrases hit one at a time on a **steady beat**, each with a _different_ entrance, then stack into a locked finale. This is the recipe for "punchy / rhythmic" text-forward pieces (taglines, manifestos, hype intros). The difference between generic and rhythmic is (1) one shared **onset array** driving every element, (2) **distinct** entrances per phrase rather than one reused helper, and (3) optional **rhythm chrome** that visibly keeps the beat.

## How It Works

1. **Define the beat once.** A single `BEATS = [t0, t1, t2, …]` array (seconds) is the rhythmic spine. Every phrase entrance, accent, and chrome tick reads its time from this array - so the whole piece locks to one pulse instead of drifting hand-tuned offsets.
2. **Vary the entrances.** Phrase 1 slams (scale + blur), phrase 2 snaps from the side, phrase 3 rises and rotates. Same _energy_, different _form_ - reusing one `punchIn()` for all three reads as flat.
3. **Land a finale.** All phrases lock into a left-aligned or centered stack; an accent underline sweeps in; optionally a continuous low-amplitude pulse holds the last beat.

## Beat & Easing

Pick the entrance easing by attack character (the choice is discrete):

| anime.js ease | Attack feel                                 |
| ------------- | ------------------------------------------- |
| `outQuint`    | Hard slam, fast settle ⭐ default for a hit |
| `outExpo`     | Hardest snap (side-snaps, whip-ins)         |
| `outBack(2)`  | Overshoot pop - accents, not body words     |
| `outCirc`     | Heavy rise with momentum                    |

Use **at least 3 distinct easings** across the piece (entrances are its "tone of voice"). Keep durations short - 0.35–0.6s on the hit, ≤0.25s on the exit - so the beat stays percussive.

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

## Anime.js Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const tl = anime.createTimeline({ autoplay: false });

  // ONE tempo grid drives everything: phrases AND the metronome read it (no scattered offsets).
  const PULSE = 0.4; // seconds per sub-beat (the grid)
  const BEATS = [PULSE * 1, PULSE * 5, PULSE * 9]; // phrase onsets, on the grid

  // Distinct entrances per phrase (NOT one reused helper).
  tl.add(
    "#p1",
    {
      scale: [1.5, 1],
      filter: ["blur(16px)", "blur(0px)"],
      opacity: [0, 1],
      duration: 500,
      ease: "outQuint",
    },
    BEATS[0] * 1000,
  );
  tl.add(
    "#p2",
    { translateX: [-320, 0], opacity: [0, 1], duration: 450, ease: "outExpo" },
    BEATS[1] * 1000,
  );
  tl.add(
    "#p3",
    { translateY: [90, 0], rotate: [6, 0], opacity: [0, 1], duration: 550, ease: "outCirc" },
    BEATS[2] * 1000,
  );

  // Rhythm chrome: each metronome tick flashes on the SAME grid (PULSE), not a magic offset.
  const ticks = [...document.querySelectorAll(".kbs-metronome i")];
  ticks.forEach((tick, i) => {
    tl.add(
      tick,
      { opacity: 1, duration: 80, alternate: true, loop: 2, ease: "linear" },
      PULSE * (i + 1) * 1000,
    );
  });

  // Finale hold: a low-amplitude breath on the locked stack.
  // floor (not ceil) so the loop never overshoots data-duration; max(1, ...) so a short hold
  // still plays once without becoming infinite.
  const holdStart = BEATS[2] + 0.7,
    cycle = 1.6,
    holdDur = 15 - holdStart;
  tl.add(
    ".kbs-stage",
    {
      scale: 1.01,
      duration: (cycle / 2) * 1000,
      ease: "inOutSine",
      alternate: true,
      loop: Math.max(1, Math.floor(holdDur / cycle)),
    },
    holdStart * 1000,
  );

  hyperframesAnime.register("main", tl);
</script>
```

## How to Choose Values

- **BEATS spacing** - 1.2–1.8s between hits reads as a confident beat; <0.8s feels frantic, >2.5s loses the pulse. Keep spacing even (it's a _beat_).
- **Entrance duration** - 0.35–0.6s. The hit must resolve before the next beat.
- **Distinct entrances** - assign a different transform axis per phrase (scale / x / y+rotate). Reuse the _ease family_, vary the _motion_.
- **Accent hue** - exactly one (the verbs). The rest is mono white/near-black.
- **Rhythm chrome** - optional but high-impact for "rhythmic": a 5-tick metronome, a center beat bar, or a `// label` monospace tag pulsing on-beat. Mark any decorative that must survive a shader transition per `../../transitions/overview.md` rules.

## Key Principles

- **One beat array, not scattered offsets** - every element times off `BEATS[]`. This is the single biggest lever for "rhythmic."
- **Different entrance per phrase** - a reused `punchIn()` for all lines is the flat-but-competent tell.
- **Short attacks** - percussive means fast in, brief, decisive. Long fades kill the beat.
- **One accent hue, heavy weight** - embedded display faces (Archivo Black, League Gothic, Oswald) at 150px+; see `hyperframes-creative/references/typography.md`.
- **Finale earns the hold** - stack + underline sweep + optional breath; don't just leave the last phrase sitting.

## Critical Constraints

- **Timeline must be paused**: `anime.createTimeline({ autoplay: false })`. Never `tl.play()`.
- **No infinite repeats** on the hold/chrome: use finite `loop` counts derived with `Math.floor`, not `Math.ceil`. `ceil` overshoots `data-duration`; `Math.max(1, ...)` guards against an invalid loop count when the hold is shorter than one cycle.
- **No banned exit animations** between scenes - if this is one of several scenes, the _transition_ is the exit (see `../../transitions/overview.md`); only a final scene may fade out.
- **Display font must be embedded** or it silently falls back at render (Anton/Bebas-as-literal are NOT embedded - `Bebas Neue` aliases to League Gothic; verify in `typography.md`).
- **Registration id = `data-composition-id`**: call `hyperframesAnime.register("<id>", tl)` with the same id as the scene root.
- **One property owner per registered instance**: do not animate the same CSS property on the same element from two independently registered anime.js timelines; keep render-critical ownership in one timeline or split properties.

## Combinations

- [3d-text-depth-layers.md](3d-text-depth-layers.md) - extruded depth on the slammed words
- [css-marker-patterns.md](css-marker-patterns.md) - underline sweep / circle on the finale
- [sine-wave-loop.md](sine-wave-loop.md) - the finale breath/pulse

## Pairs with HF skills

- `/hyperframes-animation` - timeline + easing vocabulary (`../../adapters/animejs.md`)
- `/hyperframes-creative` - `references/video-composition.md` (foreground rhythm chrome), `references/typography.md` (embedded display fonts)
- `/hyperframes-core` - composition wiring, determinism (finite loops)
