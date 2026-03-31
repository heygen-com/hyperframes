# Typewriter Effect

Reveal text character by character with an optional blinking cursor. Uses GSAP's `TextPlugin` to animate the `text` property of an element.

## Required Plugin

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/TextPlugin.min.js"></script>
<script>
  gsap.registerPlugin(TextPlugin);
</script>
```

## Basic Typewriter

Type a sentence into an empty element at a steady pace.

```html
<div id="typed-text" style="font-size:48px; font-family:monospace; color:#fff; opacity:1;"></div>
```

```js
// Characters per second controls the feel:
//   3-5 cps = deliberate, dramatic
//   8-12 cps = conversational
//   15-20 cps = fast, energetic
const text = "Hello, world!";
const cps = 10;
const duration = text.length / cps;

tl.to(
  "#typed-text",
  {
    text: { value: text },
    duration: duration,
    ease: "none", // "none" gives even spacing — use "power2.in" for acceleration
  },
  startTime,
);
```

`ease: "none"` produces evenly-spaced characters. Any other ease changes the typing rhythm — `"power2.in"` starts slow and speeds up, `"power4.out"` types fast then slows to a stop.

## With Blinking Cursor

Add a cursor element that blinks while idle and holds steady while typing. Three rules:

1. **Only one cursor visible at a time.** Multiple visible cursors on screen looks broken. Every line gets its own cursor element, but only the active line's cursor is visible — all others must be `cursor-hide`. When a line finishes and the next line starts, hide the previous cursor before showing the next one.
2. **The cursor must always blink when idle** — after typing finishes, after clearing, during hold pauses. A cursor that just sits there solid looks broken.
3. **No gap between text and cursor** — the cursor element must be immediately adjacent to the text element in the HTML (no whitespace, no flex gap). Any space between the last character and `|` looks wrong.

```html
<!-- No whitespace between spans — cursor must sit flush against text -->
<span id="typed-text" style="font-size:48px; font-family:monospace; color:#fff;"></span
><span id="cursor" style="font-size:48px; font-family:monospace; color:#fff;">|</span>
```

```css
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
.cursor-blink {
  animation: blink 0.8s step-end infinite;
}
.cursor-solid {
  animation: none;
  opacity: 1;
}
.cursor-hide {
  animation: none;
  opacity: 0;
}
```

Three states: `cursor-blink` (idle), `cursor-solid` (actively typing), `cursor-hide` (cursor belongs to a different line). The pattern is always: blink → solid → type → solid → blink.

```js
const text = "Hello, world!";
const cps = 10;
const duration = text.length / cps;
const cursor = document.querySelector("#cursor");

// Cursor blinks before typing starts
cursor.classList.add("cursor-blink");

// Solid while typing
tl.call(
  () => {
    cursor.classList.replace("cursor-blink", "cursor-solid");
  },
  [],
  startTime,
);

// Type the text
tl.to(
  "#typed-text",
  {
    text: { value: text },
    duration: duration,
    ease: "none",
  },
  startTime,
);

// Back to blinking when done — never leave it solid
tl.call(
  () => {
    cursor.classList.replace("cursor-solid", "cursor-blink");
  },
  [],
  startTime + duration,
);
```

When handing off between multiple typewriter lines, the new cursor must blink before it starts typing. Going straight from hidden to solid skips the idle state and looks like the cursor just appeared mid-keystroke. Always: hide previous → blink new → pause → then solid when typing begins.

```js
// Step 1: hand off — new cursor appears blinking
tl.call(
  () => {
    prevCursor.classList.replace("cursor-blink", "cursor-hide");
    nextCursor.classList.replace("cursor-hide", "cursor-blink");
  },
  [],
  handoffTime,
);

// Step 2: after a brief blink pause (0.4-0.6s), go solid and start typing
const typeStart = handoffTime + 0.5;
tl.call(
  () => {
    nextCursor.classList.replace("cursor-blink", "cursor-solid");
  },
  [],
  typeStart,
);
tl.to("#next-text", { text: { value: text }, duration: dur, ease: "none" }, typeStart);
tl.call(
  () => {
    nextCursor.classList.replace("cursor-solid", "cursor-blink");
  },
  [],
  typeStart + dur,
);
```

## Spacing with Static Text

When a typewriter word sits next to static text (e.g. "Ship something **bold.**"), use `margin-left` on a wrapper span around the dynamic text + cursor. Do not use flex gap (it spaces the cursor away from the text) or a trailing space in the static text (it collapses when the dynamic text is empty).

```html
<div style="display:flex; align-items:baseline;">
  <span style="font-size:40px; color:#555;">Ship something</span>
  <span style="margin-left:14px;"><span id="word"></span><span id="cursor">|</span></span>
</div>
```

## Backspacing (Clearing Text)

TextPlugin's `text: { value: "" }` removes characters from the front of the word, which looks wrong — real backspacing deletes from the end. Do not use TextPlugin to clear text. Instead, use `tl.call()` to step through substrings, removing one character at a time from the end.

```js
// Backspace a word one character at a time from the end
function backspace(tl, selector, word, startTime, cps) {
  const el = document.querySelector(selector);
  const interval = 1 / cps;
  for (let i = word.length - 1; i >= 0; i--) {
    tl.call(
      () => {
        el.textContent = word.slice(0, i);
      },
      [],
      startTime + (word.length - i) * interval,
    );
  }
  return word.length * interval; // total duration
}

// Usage:
const clearDur = backspace(tl, "#typed-text", "hello", 5.0, 20);
```

This produces the correct visual: characters disappear from right to left, just like pressing backspace.

## Word Rotation

Type a word, hold, backspace it, type the next. The cursor must blink during every idle moment — hold pauses and after each backspace.

```js
const words = ["creative", "powerful", "simple"];
const cursor = document.querySelector("#cursor");
const el = document.querySelector("#typed-text");
let offset = startTime;

function backspace(tl, el, word, start, cps) {
  const interval = 1 / cps;
  for (let i = word.length - 1; i >= 0; i--) {
    tl.call(
      () => {
        el.textContent = word.slice(0, i);
      },
      [],
      start + (word.length - i) * interval,
    );
  }
  return word.length * interval;
}

words.forEach((word, i) => {
  const typeDuration = word.length / 10;
  const holdDuration = 1.5;

  // Solid while typing
  tl.call(
    () => {
      cursor.classList.replace("cursor-blink", "cursor-solid");
    },
    [],
    offset,
  );
  tl.to(
    "#typed-text",
    {
      text: { value: word },
      duration: typeDuration,
      ease: "none",
    },
    offset,
  );
  // Blink during hold
  tl.call(
    () => {
      cursor.classList.replace("cursor-solid", "cursor-blink");
    },
    [],
    offset + typeDuration,
  );

  offset += typeDuration + holdDuration;

  // Backspace the word (skip on the last word)
  if (i < words.length - 1) {
    tl.call(
      () => {
        cursor.classList.replace("cursor-blink", "cursor-solid");
      },
      [],
      offset,
    );
    const clearDur = backspace(tl, el, word, offset, 20);
    tl.call(
      () => {
        cursor.classList.replace("cursor-solid", "cursor-blink");
      },
      [],
      offset + clearDur,
    );
    offset += clearDur + 0.3;
  }
});
```

## Appending Words

Type words one after another into the same element, building a sentence over time.

```js
const words = ["We", "build", "the", "future."];
let offset = startTime;
let accumulated = "";

words.forEach((word) => {
  const target = accumulated + (accumulated ? " " : "") + word;
  const newChars = target.length - accumulated.length;
  const typeDuration = newChars / 10;

  tl.to(
    "#typed-text",
    {
      text: { value: target },
      duration: typeDuration,
      ease: "none",
    },
    offset,
  );

  accumulated = target;
  offset += typeDuration + 0.3;
});
```

## Timing Guide

| Characters per second | Feel             | Good for                            |
| --------------------- | ---------------- | ----------------------------------- |
| 3-5                   | Slow, deliberate | Dramatic reveals, horror, suspense  |
| 8-12                  | Natural typing   | Dialogue, narration, conversational |
| 15-20                 | Fast, energetic  | Tech demos, code, rapid-fire        |
| 30+                   | Near-instant     | Filling long blocks of text quickly |

## HyperFrames Integration Notes

- `TextPlugin` must be registered with `gsap.registerPlugin(TextPlugin)` in each composition that uses it
- The `text` tween is deterministic — same input produces same output on every render
- Do not use `tl.call()` to set `textContent` directly — always use the `text` plugin so the timeline can seek correctly
- For sub-compositions, include the TextPlugin script tag in the sub-composition HTML, not just the root
