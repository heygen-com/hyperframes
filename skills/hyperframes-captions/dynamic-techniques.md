# Dynamic Caption Techniques

The default caption pattern — fade group in, hold, fade out — works but looks like subtitles. These techniques make captions feel designed and intentional. Mix them based on the content's energy. Every technique below is deterministic and works with HyperFrames' frame-by-frame rendering.

## Per-Word Staggered Entrances

Each word in a group enters individually with staggered timing. The stagger creates a wave that follows the speaker's rhythm.

```js
// Words enter one by one, timed to their speech timestamps
group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  tl.set(wordEl, { opacity: 0, y: 30, scale: 0.85 }, group.start);
  tl.to(
    wordEl,
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.18,
      ease: "back.out(1.7)",
    },
    word.start,
  );
});
```

Vary the entrance per word role. Content words (nouns, verbs) get scale + y. Function words (the, a, and) get opacity only — they shouldn't compete for attention.

## Karaoke Highlight

All words in the group are visible from the start but muted. Each word transitions to full brightness as it's spoken. This gives the viewer reading context while directing attention to the current word.

```js
// Show all words muted at group start
group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  tl.set(wordEl, { opacity: 0.3, scale: 0.95, color: "rgba(255,255,255,0.4)" }, group.start);
  // Light up when spoken
  tl.to(
    wordEl,
    {
      opacity: 1,
      scale: 1.05,
      color: "#ffffff",
      duration: 0.1,
      ease: "power2.out",
    },
    word.start,
  );
  // Settle after speaking
  tl.to(
    wordEl,
    {
      scale: 1,
      color: "rgba(255,255,255,0.85)",
      duration: 0.2,
      ease: "power1.out",
    },
    word.end,
  );
});
```

For high-energy content, add a color accent to the active word (`color: accentColor`) and a subtle glow (`textShadow: "0 0 20px " + accentColor`).

## Clip-Path Reveals

Words or groups reveal through an animated clip-path rather than fading. This creates a physical, tactile feeling — like text being uncovered.

```js
// Horizontal wipe: text sweeps in from left
tl.fromTo(
  groupEl,
  { clipPath: "inset(0 100% 0 0)" },
  { clipPath: "inset(0 0% 0 0)", duration: 0.4, ease: "power3.out" },
  group.start,
);

// Per-word vertical reveal: each word drops in from behind a mask
group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  tl.fromTo(
    wordEl,
    { clipPath: "inset(100% 0 0 0)", y: -10 },
    { clipPath: "inset(0% 0 0 0)", y: 0, duration: 0.2, ease: "power2.out" },
    word.start,
  );
});

// Circle reveal: text appears through an expanding circle
tl.fromTo(
  groupEl,
  { clipPath: "circle(0% at 50% 50%)" },
  { clipPath: "circle(100% at 50% 50%)", duration: 0.35, ease: "expo.out" },
  group.start,
);
```

## Slam / Impact Words

Hero words slam onto the screen — they arrive fast, overshoot, and settle with weight. Reserve this for emphasis words (1-2 per group max). Over-using it kills the impact.

```js
var isHeroWord = /^(LAUNCH|FREE|NOW|NEW|HUGE|INSANE)$/i.test(word.text);
if (isHeroWord) {
  tl.fromTo(
    wordEl,
    { scale: 2.5, opacity: 0, rotation: -8 },
    { scale: 1, opacity: 1, rotation: 0, duration: 0.25, ease: "back.out(2.5)" },
    word.start,
  );
  // Micro-shake on impact
  tl.to(wordEl, { x: 4, duration: 0.03 }, word.start + 0.25);
  tl.to(wordEl, { x: -3, duration: 0.03 }, word.start + 0.28);
  tl.to(wordEl, { x: 0, duration: 0.04, ease: "power2.out" }, word.start + 0.31);
} else {
  tl.fromTo(
    wordEl,
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, duration: 0.15, ease: "power2.out" },
    word.start,
  );
}
```

## Absolute-Positioned Word Layout with Pretext

Position every word with `position: absolute` using pretext-measured widths. This unlocks animation paths that CSS inline flow can't do — words can fly in from any direction to their reading position.

```js
var FONT = "900 72px Outfit";
var GAP = 14; // px between words
var containerWidth = 1600;

// Measure each word and compute its x position
var xCursor = 0;
var wordPositions = [];
group.words.forEach(function (word) {
  var prepared = window.__hyperframes.pretext.prepare(word.text.toUpperCase(), FONT);
  var measured = window.__hyperframes.pretext.layout(prepared, 9999, 72 * 1.2);
  var w = measured.height / 1.2;
  wordPositions.push({ x: xCursor, width: w });
  xCursor += w + GAP;
});

// Center the whole group
var totalWidth = xCursor - GAP;
var offsetX = (containerWidth - totalWidth) / 2;

group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  var finalX = wordPositions[wi].x + offsetX;
  wordEl.style.position = "absolute";
  wordEl.style.left = finalX + "px";

  // Scatter entrance: each word arrives from a unique direction
  var angle = (wi / group.words.length) * Math.PI * 2;
  var radius = 300;
  var startX = finalX + Math.cos(angle) * radius;
  var startY = Math.sin(angle) * radius;

  tl.fromTo(
    wordEl,
    { x: startX - finalX, y: startY, opacity: 0, scale: 0.5 },
    { x: 0, y: 0, opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.4)" },
    word.start,
  );
});
```

## Elastic / Spring Entrances

Words arrive with physics — they overshoot their target and oscillate before settling. Different spring constants per word create an organic, staggered feeling.

```js
group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  // Vary elasticity by word position — earlier words bouncier
  var elasticity = 0.3 + wi * 0.05;
  var amplitude = 1.2 - wi * 0.1;

  tl.fromTo(
    wordEl,
    { y: 60, opacity: 0, scaleY: 1.3, scaleX: 0.85 },
    {
      y: 0,
      opacity: 1,
      scaleY: 1,
      scaleX: 1,
      duration: 0.5,
      ease: "elastic.out(" + amplitude + ", " + elasticity + ")",
    },
    word.start,
  );
});
```

## Rotation & 3D Perspective

Words rotate into view on the X or Y axis, creating a sense of depth. Requires `transformPerspective` on the parent for 3D effect.

```js
// Set perspective on the group container
gsap.set(groupEl, { transformPerspective: 800 });

group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  // Alternate rotation direction per word
  var rotDir = wi % 2 === 0 ? 90 : -90;
  tl.fromTo(
    wordEl,
    { rotationX: rotDir, opacity: 0, transformOrigin: "50% 100%" },
    { rotationX: 0, opacity: 1, duration: 0.3, ease: "power3.out" },
    word.start,
  );
});
```

## Kinetic Exit Patterns

Exits are as important as entrances. Don't always fade out — give words somewhere to go.

```js
// Scatter exit: words fly apart when the group ends
group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  var angle = (wi / group.words.length) * Math.PI * 2;
  var exitX = Math.cos(angle) * 200;
  var exitY = Math.sin(angle) * 150;
  tl.to(
    wordEl,
    {
      x: exitX,
      y: exitY,
      opacity: 0,
      scale: 0.6,
      rotation: wi % 2 ? 15 : -15,
      duration: 0.2,
      ease: "power3.in",
    },
    group.end - 0.2,
  );
});
// Hard kill still required
tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);

// Collapse exit: words squeeze together then vanish
tl.to(
  groupEl.querySelectorAll("span"),
  {
    letterSpacing: "-0.15em",
    scaleX: 0.7,
    opacity: 0,
    duration: 0.15,
    ease: "power2.in",
    stagger: { each: 0.02, from: "edges" },
  },
  group.end - 0.2,
);

// Drop exit: words fall with gravity
group.words.forEach(function (word, wi) {
  var wordEl = document.getElementById("w-" + gi + "-" + wi);
  tl.to(
    wordEl,
    {
      y: 300,
      rotation: 10 + wi * 5,
      opacity: 0,
      duration: 0.3,
      ease: "power2.in",
    },
    group.end - 0.3 + wi * 0.03,
  );
});
```

## Combining Techniques

The best dynamic captions layer 2-3 techniques together. A few combinations that work:

| Combination                              | Energy      | Best for                        |
| ---------------------------------------- | ----------- | ------------------------------- |
| Karaoke highlight + audio reactivity     | Medium-high | Music videos, lyric videos      |
| Staggered entrance + scatter exit        | High        | Hype content, trailers          |
| Clip-path reveal + fade exit             | Medium      | Corporate, storytelling         |
| Slam heroes + elastic others + drop exit | Very high   | Product launches, announcements |
| 3D rotation entrance + collapse exit     | Medium-high | Tech, modern brands             |

Don't combine slam entrances with elastic entrances on the same group — pick one motion personality per group. You can vary techniques across groups to match the content's pace changes.

## Width-Aware Grouping with Pretext

Instead of grouping by word count alone, use pretext to group by visual width. This prevents some groups from filling the frame while others use 30%.

```js
var FONT = "900 72px Outfit";
var MAX_WIDTH = 1500; // slightly under container to leave padding

var groups = [];
var currentGroup = { words: [], text: "" };

words.forEach(function (word) {
  var testText = (currentGroup.text + " " + word.text).trim().toUpperCase();
  var result = window.__hyperframes.fitTextFontSize(testText, {
    fontFamily: "Outfit",
    fontWeight: 900,
    maxWidth: MAX_WIDTH,
    baseFontSize: 72,
    minFontSize: 72,
    step: 2,
  });

  if (!result.fits && currentGroup.words.length > 0) {
    // Adding this word would overflow — start new group
    groups.push(currentGroup);
    currentGroup = { words: [word], text: word.text };
  } else {
    currentGroup.words.push(word);
    currentGroup.text = testText;
  }
});
if (currentGroup.words.length > 0) groups.push(currentGroup);
```

This replaces the fixed "3-5 words per group" heuristic with pixel-accurate measurement. "I" and "EXTRAORDINARY" take very different widths — pretext accounts for that.
