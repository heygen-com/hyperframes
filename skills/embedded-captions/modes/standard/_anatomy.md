---
name: caption-template-anatomy
description: The shared, reproducible scene engine every caption template is built on, a matted talking-head with a flowing verbatim foreground caption and a single climax word, driven by one paused anime.js timeline. Read it ONCE per session (it is identical for all 54 templates); each per-template file in templates/ only overrides the style tokens + the named climax entrance/exit.
metadata:
  tags: caption, talking-head, matte, occlusion, verbatim, climax, animejs, hyperframes
---

# Caption Template - Anatomy (the shared engine)

A **caption template** = one complete, reproducible HyperFrames scene:

> **the person (always in frame)** + a **flowing foreground caption** (verbatim, word-by-word, with appear **and** disappear) + a **climax word** (big, behind the speaker, with a designed entrance **and** exit) + a coherent **font / colour / motion** design.

Every file in `templates/` is the SAME engine described here with three things swapped: (1) the **style tokens** (font, fills, accent, optional gradient/stroke), (2) the named **climax entrance** + **exit** (see `_motion.md`), (3) the **copy** (flow lines + climax word) and **scene/person**. So read this once; each template file is short.

HyperFrames-native, so anyone can reproduce it:

- **One paused anime.js timeline per composition**, registered with `hyperframesAnime.register(data-composition-id, tl)`.
- Anime.js timeline durations and positions are in **milliseconds**; `data-start` / `data-duration` carry the scene window in seconds.
- **Deterministic + seek-safe** only - no `Math.random()`, no `Date.now()`, no infinite repeats, no un-seekable CSS animations. Every state is reachable by seeking the timeline to a time `t`.
- Animate `x`, `y`, `scale`, `rotation`, `opacity`, `filter`, `clipPath`, `textShadow`, `backgroundPosition`, `letterSpacing`; never layout props (width/top/left/margin).

For the composition contract see `hyperframes-core`; eases + the animated-property allowlist see `hyperframes-animation`; caption grouping/positioning/exit guarantees see `hyperframes-captions`.

## 1 · Asset prep (two CLI calls)

```bash
# 1) The person - transparent talking-head cutout over the scene (VP9 + alpha)
bash scripts/prepare.sh   <project>      # matte ∥ transcribe ∥ safe-zones (THIS skill - not remove-background)
#    (a still works too:  remove-background portrait.jpg -o person.png)

# 2) The verbatim word timings that drive the flowing caption
npx hyperframes transcribe subject.mp4 --model small            # → transcript.json
#    shape: [{ "id":"w0","text":"Hello","start":0.0,"end":0.5 }, …]
```

The flow caption consumes that `transcript.json` directly (word `start`/`end` → reveal + active-word emphasis). The climax word is authored by hand (it is the headline beat, not part of the spoken transcript). In production the avatar/matte pipeline yields a pixel-perfect alpha for free - `remove-background` is the fallback for arbitrary footage.

## 2 · The matte sandwich (HTML)

Six layers, back-to-front. The person is layered ON TOP of the climax so they physically **occlude** it - this is what sells "behind the speaker" (blur/opacity alone reads as a flat overlay).

```html
<div
  class="stage {STYLE} {PERSON}"
  id="cap-{id}"
  data-composition-id="cap-{id}"
  data-start="0"
  data-duration="{SCENE_DUR}"
  data-track-index="0"
>
  <!-- z0  background plate (the original frame, full) -->
  <!--     supplied by .{PERSON} as background-image, or a <video> at z-index:0 -->

  <!-- z1  CLIMAX - big, BEHIND the person, occluded -->
  <div class="climax"><span>{CLIMAX_WORD}</span></div>

  <!-- z4  the person cutout (transparent webm/png), aligned to the plate -->
  <video class="cut" src="person.webm" muted playsinline></video>
  <!-- or:  <img class="cut" src="person.png"> -->

  <!-- z5  grade / vignette for depth + legibility -->
  <div class="grade"></div>

  <!-- z6  FLOW - the verbatim caption, IN FRONT, lower third -->
  <div class="flow"></div>
  <!-- words injected from transcript.json -->
</div>
```

## 3 · Base CSS (layout · z-order · sizing)

Caption size is in **`cqh`** (% of frame height) via a size container, so it honours broadcast spec at any resolution (~8% cap-height for a 16:9 word). The per-template file only sets the `--ff` / `--cfill` / `--cacc` tokens and any `.climax span` fill (gradient/stroke).

```css
.stage {
  position: relative;
  aspect-ratio: 16/9;
  overflow: hidden;
  container-type: size;
  background-size: cover;
  background-position: center 12%;
  background-color: #0a0a0e;
  font-family: var(--ff);
}
.stage > * {
  position: absolute;
}
.cut {
  z-index: 4;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 12%;
  pointer-events: none;
}
.grade {
  z-index: 5;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(130% 100% at 50% 26%, transparent 40%, rgba(0, 0, 0, 0.6));
}

/* CLIMAX - big, behind person (z1), occluded. line-height ≥1.15 so clip-reveal
   entrances (inset(0)) never slice glyph tops; pad clips negative for script faces. */
.climax {
  z-index: 1;
  left: 50%;
  top: 37%;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  text-align: center;
  line-height: 1.18;
  font-family: var(--ff);
  color: var(--cfill);
  font-weight: 900;
  font-size: 44cqh;
  text-transform: uppercase;
  text-shadow:
    0 2px 13px rgba(0, 0, 0, 0.6),
    0 0 48px rgba(0, 0, 0, 0.42);
}
.climax span {
  display: inline-block;
  opacity: 0;
} /* anime.js reveals it */

/* FLOW - verbatim caption, in front (z6), lower third */
.flow {
  z-index: 6;
  left: 50%;
  bottom: 9%;
  transform: translateX(-50%);
  width: 90%;
  text-align: center;
  line-height: 1.15;
  font-family: var(--ff);
  font-weight: 700;
  font-size: 7.5cqh;
  color: var(--cfill);
}
.flow .w {
  display: inline-block;
  opacity: 0;
  margin: 0 0.1em;
  color: var(--cfill);
}
.flow .w.act {
  color: var(--cacc);
} /* the currently-spoken word */

/* tokens every template overrides: */
.stage {
  --ff: "Inter";
  --cfill: #fff;
  --cacc: #10a37f;
}
```

**Legibility on busy/bright scenes:** a behind-the-person climax needs separation from the footage, not just a fill colour. For dark or gradient fills on lit scenes give the climax an outline - `-webkit-text-stroke:1px rgba(0,0,0,.5);paint-order:stroke fill` - a dark drop-shadow alone fails against highlights (e.g. a lamp). Gradient/clip fills must live on `.climax span` (the text node), never on the transformed `.climax` container, or the clip detaches and only the shadow shows.

## 4 · One paused anime.js timeline (the loop, made seek-safe)

The gallery used a `setInterval` loop; HyperFrames needs the same beats as **absolute-time tweens on one paused timeline**. The cycle is **FLOW line → (FLOW line) → CLIMAX in → hold → out**. Restraint is the rule: flow stays clean; the one big mood move happens only at the climax.

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const stage = document.getElementById("cap-{id}");
  const flow = stage.querySelector(".flow");
  const climax = stage.querySelector(".climax span");
  const tl = anime.createTimeline({ autoplay: false });
  const ms = (seconds) => Math.max(0, Math.round((Number(seconds) || 0) * 1000));

  // FLOW: render words from transcript.json, reveal each at its start time.
  // WORDS = grouped transcript lines: [{ words:[{text,start,end}], end }] in scene-local seconds.
  function renderLine(line) {
    flow.innerHTML = line.words
      .map((w, i) => `<span class="w" data-i="${i}">${w.text}</span>`)
      .join(" ");
    return [...flow.querySelectorAll(".w")];
  }
  WORDS.forEach((line) => {
    const spans = renderLine(line); // (one renderLine per active line; see captions skill for multi-line groups)
    spans.forEach((el, i) => {
      const w = line.words[i];
      tl.add(el, { opacity: 0, y: 14, duration: 0 }, ms(w.start));
      tl.add(el, { opacity: 1, y: 0, duration: 420, ease: "outQuart" }, ms(w.start));
      tl.add(spans, { color: "var(--cfill)", duration: 0 }, ms(w.start));
      tl.add(el, { color: "var(--cacc)", duration: 0 }, ms(w.start));
    });
    tl.add(spans, { opacity: 0, y: -10, duration: 420, ease: "inCubic" }, ms(line.end));
    tl.add(flow, { opacity: 0, visibility: "hidden", duration: 0 }, ms(line.end + FOUT));
    tl.add(flow, { opacity: 1, visibility: "visible", duration: 0 }, ms(line.end + FOUT + 0.001));
  });

  // CLIMAX: entrance at the beat, hold >=1s, exit.
  const T = CLIMAX_AT; // beat time (after the flow lines)
  tl.add(climax, { opacity: 0, scale: 1.6, filter: "blur(12px)", duration: 0 }, ms(T));
  tl.add(
    climax,
    { opacity: 1, scale: 1, filter: "blur(0)", duration: 700, ease: "outBack(1.6)" },
    ms(T),
  );
  tl.add(climax, { opacity: 0, scale: 1.03, duration: 600, ease: "inCubic" }, ms(T + CLIMAX_HOLD));

  hyperframesAnime.register("cap-{id}", tl);
</script>
```

`FLOW_IN` / `FLOW_OUT` / `CLIMAX_IN` / `CLIMAX_OUT` are the named recipes in **`_motion.md`**. Each recipe maps to anime.js `tl.add(...)` calls at absolute millisecond positions. A simpler equivalent for the flow active-word _glow_ (rather than discrete reveal) is the single-driver envelope in `hyperframes-animation/rules/asr-keyword-glow.md`.

## 5 · How to choose values

- **SCENE_DUR** - must equal `data-duration`. Typical 6–10 s for a looping demo card.
- **WORDS grouping** - 2–4 words / line, ~380–520 ms per word (premium pacing is slower than Hormozi). Group from `transcript.json`; keep `end < next.start` (monotonic).
- **CLIMAX_AT** - place the climax _after_ the flow lines clear, on the narration's emphasis beat.
- **CLIMAX_HOLD** - **≥1 s** of settled dwell _after_ the entrance finishes (the climax is the headline beat). Entrances run 0.6–1.6 s, so e.g. hold = entranceDur + 1.0–1.6.
- **FOUT** - flow exit ≈ 0.5 s. **Exit ≈ 75 % of entry** for every element (arrival deliberate, departure swift; see `_motion.md`).
- **Climax size** - base 44 cqh; long words bleed off-frame (intended cinematic); 3-char words behind a centred subject need size + an outline so they peek.

## Critical constraints (HyperFrames)

- Timeline **paused**; registry key = `data-composition-id`.
- **No CSS keyframe animation** on caption elements, all motion is anime.js timeline events at absolute millisecond times (seek-safe).
- No `Math.random` / `Date.now` / infinite repeats.
- `display:inline-block` on every `.w` and the climax `span`.
- **Hard-hide** each flow group at its end time; **CLIMAX_OUT ends at `opacity:0`** (or fully-clipped) so nothing lingers.
- Gradient / `background-clip:text` / stroke fills go on `.climax span`, not the transformed `.climax`.
- `.climax` `line-height ≥ 1.15`; pad clip-reveal entrances with negative insets for script/decorative fonts.

## Pairs with HF skills

- `media-use` - `remove-background` (the matte) + `transcribe` (word timings).
- `hyperframes-captions` - transcript consumption, grouping, positioning, exit guarantees, `fitTextFontSize`.
- `hyperframes-animation/rules/asr-keyword-glow.md` - the verbatim active-word envelope.
- `hyperframes-animation` - single paused timeline, transform properties, ease palette.
- `_motion.md` (this folder) - the named flow/climax entrance + exit recipes.
