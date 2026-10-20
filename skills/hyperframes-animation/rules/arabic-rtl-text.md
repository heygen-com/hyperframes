---
name: arabic-rtl-text
description: Animate Arabic, Persian, Urdu and Hebrew text without reversing word order or breaking letter joins — base direction on the word/letter container, word-level splits by default, a joiner-aware split when letters must move, an embedded Arabic font.
metadata:
  tags: text, arabic, rtl, persian, urdu, hebrew, split, stagger, captions, typography, bidi
---

# Arabic and right-to-left text

Two failures show up the moment a text recipe meets Arabic. Both render without an error.

1. **Words in reverse order.** `inline-block` word or letter spans are neutral to the bidi algorithm, and a flex row follows `direction`. With no base direction the line is LTR, so the first Arabic word lands on the left and the sentence reads backwards. Captions, karaoke and `asr-keyword-glow` phrases hit this.
2. **Isolated letters.** Arabic letters take a different shape depending on their neighbours. A per-character split (`split("")`, `[...text]`, SplitText `type: "chars"`) puts each letter in its own `inline-block`, which is shaped alone, so the word falls apart.

## Recipe

Word-level is the default for Arabic. Set the direction on the container that holds the spans:

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="phrase" dir="rtl" lang="ar">
  <span class="word">{w1}</span> <span class="word">{w2}</span> <span class="word">{w3}</span>
</div>
```

```css
.phrase {
  font-family: "{arabicFont}"; /* embedded via @font-face — see Fonts */
}
.word {
  display: inline-block;
}
```

```js
tl.fromTo(
  ".phrase .word",
  { y: 40, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.4, stagger: 0.1, ease: "power3.out" },
  0,
);
```

For text whose language arrives as data, pick the direction by counting words (a Latin brand name at the start must not flip an Arabic line):

```js
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
el.dir = words.filter((w) => RTL.test(w)).length > words.length / 2 ? "rtl" : "ltr";
```

## When letters must move

Split into units the browser can still join, then stagger the units exactly like characters:

- harakat (vowel marks) stay in the unit of their letter;
- lam + alef (`لا` `لأ` `لإ` `لآ`) is one unit — it is a ligature;
- `الله` is one unit — many Arabic fonts (Cairo, Tajawal, Alexandria) draw it as a ligature that disappears when it is split;
- a run of digits or Latin is one unit, or the RTL line reverses it — a multi-word Latin phrase (`Hyper Frames`) stays one unit too;
- each side of a unit that connects to its neighbour gets a zero-width joiner (`\u200D`), so the unit is drawn in its connected form.

```js
const ZWJ = "\u200D";
const RIGHT_JOINING =
  /[\u0622-\u0625\u0627\u0629\u062F-\u0632\u0648\u0671-\u0673\u0675-\u0677\u0688-\u0699\u06C0\u06C3-\u06CB\u06CD\u06CF\u06D2\u06D3\u06D5]/;
const LETTER = /[\u0620-\u064A\u066E-\u06D3\u06D5\u06FA-\u06FC\u06FF]/;
const LTR_RUN = /^[0-9\u0660-\u0669\u06F0-\u06F9A-Za-z\u066B\u066C.,:%]+$/;
const LATIN = /^[A-Za-z]/;
const ALLAH = ["\u0627", "\u0644", "\u0644", "\u0647"];
const MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u200D]/g;
const first = (u) => u.replace(MARKS, "")[0] ?? "";
const last = (u) => u.replace(MARKS, "").slice(-1);
const joinsPrev = (u) => LETTER.test(first(u)) && first(u) !== "\u0621";
const joinsNext = (u) =>
  LETTER.test(last(u)) && last(u) !== "\u0621" && !RIGHT_JOINING.test(last(u));

function splitArabicLetters(text) {
  const g = [];
  for (const ch of text) {
    if (MARK.test(ch) && g.length > 0) g[g.length - 1] += ch;
    else g.push(ch);
  }
  const units = [];
  for (let i = 0; i < g.length; i++) {
    if (LTR_RUN.test(g[i])) {
      let run = g[i];
      const latinSpace = (k) =>
        g[k] === " " && LATIN.test(g[k - 1] ?? "") && LATIN.test(g[k + 1] ?? "");
      while (g[i + 1] && (LTR_RUN.test(g[i + 1]) || latinSpace(i + 1))) run += g[++i];
      units.push(run);
    } else if (
      ALLAH.every((c, k) => first(g[i + k] ?? "") === c) &&
      !LETTER.test(first(g[i + 4] ?? ""))
    ) {
      units.push(g.slice(i, i + 4).join(""));
      i += 3;
    } else if (
      first(g[i]) === "\u0644" &&
      /[\u0622\u0623\u0625\u0627]/.test(first(g[i + 1] ?? ""))
    ) {
      units.push(g[i] + g[++i]);
    } else {
      units.push(g[i]);
    }
  }
  return units.map((u, i) => {
    const before = i > 0 && joinsNext(units[i - 1]) && joinsPrev(u) ? ZWJ : "";
    const after = i < units.length - 1 && joinsNext(u) && joinsPrev(units[i + 1]) ? ZWJ : "";
    return before + u + after;
  });
}

const line = document.querySelector("#title"); // dir="rtl"
line.replaceChildren(
  ...splitArabicLetters(line.dataset.text).map((u) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = u === " " ? "\u00A0" : u; // textContent: data-driven text may contain < or &
    return span;
  }),
);
```

```css
.char {
  display: inline-block;
}
```

In the HyperFrames render (Chrome) every letter keeps its joined form. A split line can come out a few pixels wider than the unsplit text, because kerning and mark positioning do not cross `inline-block` boundaries.

## Fonts

None of the pre-bundled families covers Arabic script (see `hyperframes-creative/references/typography.md`), so embed one with `@font-face` — for example Noto Sans Arabic, IBM Plex Sans Arabic, Cairo or Tajawal. Otherwise the render picks whatever Arabic font the machine has, and cloud renders have no system fonts to capture. Hebrew is different: bundled Open Sans includes a Hebrew subset.

## Critical Constraints

- **`dir="rtl"` on the element that contains the animated spans** — scope it to the text, not `<html>`, so the rest of the scene layout does not mirror.
- **No `letter-spacing` or `text-transform` on Arabic** — tracking breaks joins in Safari/Firefox previews, and Arabic has no case.
- **Same HTML in Safari:** a ZWJ-padded letter is drawn in a fallback font when the font has no U+200D glyph (Alexandria as served by Google Fonts, IBM Plex Sans Arabic, Cairo, Tajawal), so a published page or Studio preview on an iPhone can mix two typefaces inside a word. MP4 renders are not affected. For pages, use word-level motion or a font that has U+200D (Noto Sans Arabic, Noto Naskh Arabic).

## Anti-patterns

| Don't                                                        | Instead                                           |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `text.split("")` / SplitText `chars` on Arabic               | Word-level split, or `splitArabicLetters()` above |
| Word spans or a flex row without a direction                 | `dir="rtl"` on the container                      |
| Deciding direction from the first letter of data-driven text | Count RTL words                                   |
| Relying on a bundled font for Arabic                         | Embed an Arabic font with `@font-face`            |

## See also

`asr-keyword-glow` and `kinetic-beat-slam` (apply the direction rule to their phrase rows) · `/embedded-captions` for caption tracks.
