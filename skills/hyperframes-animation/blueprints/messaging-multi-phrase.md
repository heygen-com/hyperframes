---
id: messaging-multi-phrase
role: messaging
duration_seconds: [7, 8]
phases: 3
visual_arc: phrase-type → phrase-type → phrase-type (hard-cut between)
uses_rules: [dynamic-content-sequencing, context-sensitive-cursor]
element_roles:
  main_text: Contextual lead-in portion of each phrase, typed in primary color
  accent_text: Emphatic / highlighted portion, typed in accent color immediately after main
  cursor: Blinking cursor whose color reflects the active text segment
when_to_use:
  - Multiple text phrases displayed sequentially with typing rhythm
  - Each phrase has a dual-tone structure (neutral lead-in + colored emphasis)
  - Scene is purely text-driven, no visual hero
  - Phrase content varies in length, needs proportional screen time
  - "Statement after statement" cadence for layered messaging
when_not_to_use:
  - Text coexists with a visual hero — see brand-reveal-assemble-zoom or takeover-ticker-displace
  - Phrases should cross-dissolve, not hard-cut
  - Single phrase only — use [context-sensitive-cursor](../rules/context-sensitive-cursor.md) alone
  - Need camera movement / zoom between phrases — see concept-demo-decode-pan
triggers: [multiple phrases typing, sequential statements, typing with highlight, text carousel, dual-color text, rhythmic messaging]
---

# Messaging · Multi-Phrase (HyperFrames)

Multiple phrases type sequentially. Each phrase has a main + accent segment. The cursor color tracks the active segment. The timeline is computed from content length — no hardcoded phase windows.

This blueprint is the HyperFrames port of the Remotion `sequential-type-cursor` choreography. Same hard-cut multi-phrase arc, restructured around one paused GSAP timeline and a single `onUpdate` that reads `tl.time()` and writes both text and cursor state. Constituent patterns map to [dynamic-content-sequencing](../rules/dynamic-content-sequencing.md) (for the timeline pre-calculation) and [context-sensitive-cursor](../rules/context-sensitive-cursor.md) (for the cursor color + blink).

> Remotion drove this scene by re-running every component every frame and finding `currentPhrase` per render. HyperFrames runs a _single_ paused timeline; the same `currentPhrase = TIMELINE.find(...)` lookup moves inside one `onUpdate` callback that fires whenever GSAP advances the timeline. No conditional DOM — the phrase container exists from t=0 with empty text, and the `onUpdate` overwrites `textContent` in-place.

## When to Use

- Scene delivers multiple messaging beats through text alone
- Each beat has a neutral lead-in followed by an emphasized keyword/phrase
- Content length varies and timing should adapt automatically
- Consistent typing rhythm across all phrases is desired

## Phase Pipeline

Phases are _content-driven_ — derived from script length, not pre-baked into the timeline. The pipeline shape is:

| Phase | Time window                 | What Happens                                                                       | Skill Reference                                                      |
| ----- | --------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1     | `0 – phrase1End`            | Phrase 1: main text types char-by-char → accent text types                         | [context-sensitive-cursor](../rules/context-sensitive-cursor.md)     |
| 2     | `phrase1End – phrase2End`   | Phrase 2: same typing pattern, hard-cut entry                                      | [dynamic-content-sequencing](../rules/dynamic-content-sequencing.md) |
| N     | `phraseN-1End – phraseNEnd` | Phrase N: same pattern repeats; last phrase has a longer `hold` for closing weight | (same skills compose)                                                |

Each phase internally follows the same structure: main characters type at `charSpeed` seconds-per-char, then accent characters continue, then hold for `holdDuration` seconds, then hard-cut to next phrase.

## Data Architecture

Script is a flat array. Each entry defines its own text and timing parameters. No hardcoded offsets — every phase boundary is computed from the entry above it.

```js
const SCRIPT = [
  { textMain: "Build video with ", textAccent: "HTML", charSpeed: 0.083, hold: 1.0 },
  { textMain: "Seek ", textAccent: "any frame", charSpeed: 0.083, hold: 1.0 },
  { textMain: "Render to ", textAccent: "MP4", charSpeed: 0.083, hold: 2.0 },
];
```

`charSpeed` is **seconds per character** (`2.5 frames / 30 fps = 0.083 s/char` matches the Remotion source). `hold` is the seconds to dwell on the completed phrase before cutting to the next.

## Dynamic Timeline Calculation (Setup, Not a Tween)

Compute the timeline once at composition setup — plain reduce, no `useMemo` needed because there's no React lifecycle:

```js
let acc = 0;
const TIMELINE = SCRIPT.map((item) => {
  const totalChars = item.textMain.length + item.textAccent.length;
  const typingDuration = totalChars * item.charSpeed;
  const totalDuration = typingDuration + item.hold;
  const start = acc;
  const end = start + totalDuration;
  acc = end;
  return { ...item, startTime: start, endTime: end, typingDuration };
});
const TOTAL = TIMELINE[TIMELINE.length - 1].endTime;
```

The final `TOTAL` value drives the composition's `data-duration` and the master `onUpdate`'s tween length.

## Master Engine: One onUpdate Drives Everything

Single GSAP "clock" tween spans the whole composition. Its `onUpdate` finds the current phrase, computes the visible main / accent text, and writes the cursor color + blink opacity. _Everything_ per-frame happens here.

```js
const MAIN_COLOR = "#FFFFFF";
const ACCENT_COLOR = "#FF1E7A";
const BLINK_CYCLE = 1.0; // seconds — 0.5s on, 0.5s off

const mainEl = document.querySelector(".phrase-main");
const accentEl = document.querySelector(".phrase-accent");
const cursorEl = document.querySelector(".phrase-cursor");

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL,
    ease: "none",
    onUpdate: () => {
      const t = tl.time();

      // ----- Cursor blink: square wave via modulo -----
      // (Runs continuously, including in the "no phrase" fallback window.)
      cursorEl.style.opacity = t % BLINK_CYCLE < BLINK_CYCLE / 2 ? "1" : "0";

      // ----- Find current phrase -----
      let phrase = null;
      for (let i = 0; i < TIMELINE.length; i++) {
        if (t >= TIMELINE[i].startTime && t < TIMELINE[i].endTime) {
          phrase = TIMELINE[i];
          break;
        }
      }

      if (!phrase) {
        // Cursor-only fallback (before first phrase or after last)
        if (mainEl.textContent !== "") mainEl.textContent = "";
        if (accentEl.textContent !== "") accentEl.textContent = "";
        cursorEl.style.background = MAIN_COLOR;
        return;
      }

      // ----- Compute visible characters for this phrase -----
      const activeT = t - phrase.startTime;
      const charIdx = Math.floor(activeT / phrase.charSpeed);
      const mainLen = phrase.textMain.length;

      const visMain = phrase.textMain.slice(0, Math.min(charIdx, mainLen));
      const accentLen = Math.max(0, charIdx - mainLen);
      const visAccent = phrase.textAccent.slice(0, accentLen);

      // ----- Write to DOM (only on change to minimize layout work) -----
      if (mainEl.textContent !== visMain) mainEl.textContent = visMain;
      if (accentEl.textContent !== visAccent) accentEl.textContent = visAccent;

      // ----- Cursor color follows the active segment -----
      const inAccent = visMain.length === mainLen && visAccent.length > 0;
      cursorEl.style.background = inAccent ? ACCENT_COLOR : MAIN_COLOR;
    },
  },
  0,
);
```

### Why one `onUpdate` and not three

The text content, cursor color and cursor blink are _all_ pure functions of `tl.time()` and the script. Splitting them across three onUpdates triples the per-frame dispatch cost without buying any clarity — the math interleaves naturally. The `textContent !== visMain` guard prevents redundant DOM writes when the character count hasn't advanced this frame.

### Why a linear scan instead of GSAP labels / per-phrase tweens

Per-phrase tweens would each schedule their own `onUpdate` reading `tl.time()`. With N phrases that's N parallel scans. The single master scan above is O(N) but runs once per frame, so the total cost is the same — and the cursor-blink + fallback logic stays unified.

## Layout

Centered flex row. `white-space: pre` preserves intentional trailing spaces in `textMain` (e.g. `"Build video with "` — note the trailing space before the accent).

```html
<div class="phrase-stage">
  <span class="phrase-main"></span><span class="phrase-accent"></span
  ><span class="phrase-cursor"></span>
</div>
```

```css
.phrase-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: pre;
  font:
    600 100px/1 "Inter",
    system-ui,
    sans-serif;
}
.phrase-main {
  color: #ffffff;
}
.phrase-accent {
  color: #ff1e7a;
}
.phrase-cursor {
  display: inline-block;
  width: 6px;
  height: 110px;
  background: #ffffff; /* overridden by onUpdate per segment */
  margin-left: 4px;
  vertical-align: middle;
  transform: translateY(8px); /* fine-tune to align with text baseline */
  will-change: opacity, background-color;
}
```

No fixed-width container — each phrase replaces the previous entirely, so the centered flex re-layouts cleanly at every cut.

## Font Sizing

Pick the largest `fontSize` such that the _longest_ phrase fits within the canvas with comfortable margins. Run once at setup:

```js
const CANVAS_W = 1920;
const longestChars = Math.max(...SCRIPT.map((p) => p.textMain.length + p.textAccent.length));
// Inter at 100px averages ~0.5 × fontSize per character → ~50px/char
// safe upper bound: CANVAS_W * 0.85 / longestChars / 0.5
const safeFontSize = Math.floor((CANVAS_W * 0.85) / (longestChars * 0.5));
// e.g. 33 chars → ~99px → round to 100
```

For more accuracy, measure with a hidden canvas after `document.fonts.ready` (see [camera-cursor-tracking](../rules/camera-cursor-tracking.md) for the `ctx.measureText` pattern). For most decks a hand-tuned constant (100–120 px at 1920×1080) works fine — this is a statement scene, not body copy.

## Inter-Phase State Handoff

```
Phrase N → Phrase N+1:
  Hard cut. No cross-dissolve, no animation.
  The next onUpdate frame's TIMELINE.find returns Phrase N+1, the previous
  phrase's textContent is overwritten to the new phrase's first character.
  activeT resets to ~0 (specifically t - phrase.startTime, which is small).

Before first phrase (t < TIMELINE[0].startTime):
  TIMELINE.find returns undefined → fallback branch fires → text empties,
  cursor blinks at MAIN_COLOR. (In the standard scene TIMELINE[0].startTime
  is exactly 0, so this branch only matters if you offset the script start.)

After last phrase (t ≥ TIMELINE[last].endTime):
  Same fallback branch. data-duration should be ≤ TOTAL so the composition
  ends right at the last phrase's hold completion — no trailing blank state.

Cursor blink:
  Continues through fallback windows. The blink is uncorrelated with phrase
  state — it's a pure function of (t % BLINK_CYCLE).
```

## Critical Constraints

- **Single paused timeline** — all per-frame state derives from `tl.time()` in one `onUpdate`. No per-phrase GSAP tweens.
- **`Math.floor` on charIndex** — `slice` with float indices produces fractional-character output (no error, but visibly wrong).
- **`white-space: pre`** — required when `textMain` ends with a space. Without it the trailing space collapses and the accent joins the lead-in without a gap.
- **`charSpeed` in seconds, not frames** — `frames / fps`. Source `2.5 frames @ 30 fps = 0.083 s`.
- **DOM-write guard** — `if (mainEl.textContent !== visMain) ...` — even though `textContent` is cheap, skipping no-op writes prevents needless layout invalidations on phrases where char count is steady (e.g. during `hold`).
- **`data-duration` ≥ `TOTAL`** — the composition root's data-duration must cover the full computed timeline. Less and the last phrase truncates; more and the fallback fires at the end.
- **Longest phrase fits without wrap** — measure or hand-tune `fontSize` so `textMain + textAccent` of the longest entry stays on one line at the chosen canvas width.
- **No infinite repeats** — the master tween has `duration: TOTAL`; the blink is computed via modulo inside the onUpdate (no `repeat: -1` anywhere).
- **No `Math.random` / `Date.now`** — all state is a pure function of `tl.time()` and the immutable SCRIPT array.
- **GSAP transform aliases on the cursor** — if you tween cursor _position_, use `x`/`y`. The CSS `translateY(8px)` baseline-fix is static; don't tween over it.

## Spring → GSAP Ease Cheatsheet (this blueprint)

This blueprint has **no springs** — typing is linear (`ease: "none"`), the blink is a step function via modulo, and the cuts between phrases are instant. The only "ease" is the clock tween's `ease: "none"`.

If you want a _soft_ fade-in instead of a hard cut between phrases, add a short opacity tween on each phrase boundary:

```js
TIMELINE.forEach((p) => {
  tl.fromTo(
    ".phrase-stage",
    { opacity: 0 },
    { opacity: 1, duration: 0.1, ease: "none" },
    p.startTime,
  );
});
```

But this departs from the source's "hard-cut" semantic — use sparingly.

## Golden Sample

- [messaging-multi-phrase.html](../examples/messaging-multi-phrase.html) — "Build video with **HTML**" → "Seek **any frame**" → "Render to **MP4**" sequential typing on a dark gradient background. Single paused GSAP timeline, one master `onUpdate` drives text content, cursor color (white during main, cyan during accent) and cursor blink (1 s square wave). Typing rate 0.083 s/char ≈ 12 chars/sec. Holds: 1.0 s, 1.0 s, 2.0 s. Natural computed TOTAL ≈ 7.98 s; the composition's `data-duration="7.5"` caps the render window slightly under TOTAL (final phrase's hold is truncated by ~0.5 s but the accent word is fully typed and held well before the cap).
