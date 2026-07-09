# V-Take Visual Design Library

This directory is a **reference library** for the talking-head-recut skill. Style, layout,
and video frame are three **orthogonal** dimensions you can freely mix when
designing a takeaway video.

```
Style  ×  Layout  ×  VideoFrame
 (10)      (4)         (3)        = 120 possible combinations
```

Read a reference file when you decide to use that dimension. Each file is a
self-contained HTML fragment that follows the talking-head-recut card-HTML contract
(scoped `<style>`, no `<script>`, no external URLs, animations only via
`data-anim-*`).

## Layouts - how video and card share the canvas

| key       | file                                         | what it does                                            | best for                                |
| --------- | -------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `split`   | [layouts/split.html](layouts/split.html)     | 50/50 side-by-side (landscape) or top/bottom (portrait) | speaker + data equal weight             |
| `stack`   | [layouts/stack.html](layouts/stack.html)     | video on top (~52%), card below                         | talking-head with summary card          |
| `pip`     | [layouts/pip.html](layouts/pip.html)         | card fills canvas, video rounded PiP in corner          | content-heavy moment, speaker secondary |
| `overlay` | [layouts/overlay.html](layouts/overlay.html) | video full-bleed, glass card floats on bottom           | cinematic / dramatic moments            |

A layout is a **two-part recipe**: pick a `card.zone` value to put in
`storyboard.json` AND author an anime.js tween for `#video-wrap` to its
target rect in the composition's `<script>`. Open the layout file's
header for the recommended `zone` + the anime.js statement to paste.
(Earlier docs referenced a `card.layout` field - that field does NOT
exist in the real schema; the strict v3 schema only has `card.zone`.)

## Styles - the card's visual language

| key          | file                                             | character                                            | accent    | suggested font      |
| ------------ | ------------------------------------------------ | ---------------------------------------------------- | --------- | ------------------- |
| `academic`   | [styles/academic.html](styles/academic.html)     | warm paper · grid · serif · blue highlight           | `#2557a7` | serif               |
| `editorial`  | [styles/editorial.html](styles/editorial.html)   | cream · coral block · big italic quote               | `#ff3a2d` | Playfair-like serif |
| `minimal`    | [styles/minimal.html](styles/minimal.html)       | pure black/white · huge type · generous space        | `#000`    | Inter               |
| `spotlight`  | [styles/spotlight.html](styles/spotlight.html)   | dark purple gradient · glow · dramatic               | `#a78bfa` | sans                |
| `geom`       | [styles/geom.html](styles/geom.html)             | chartreuse + hot pink + black collision              | `#d4ff00` | Inter bold          |
| `whiteboard` | [styles/whiteboard.html](styles/whiteboard.html) | paper · Caveat handwriting · sketched borders        | `#ff6b35` | Caveat              |
| `audit`      | [styles/audit.html](styles/audit.html)           | manila paper · justified serif · APPROVED stamp      | `#8b1d1d` | serif               |
| `terminal`   | [styles/terminal.html](styles/terminal.html)     | dark · monospace · ASCII border · prompt cursor      | `#4ade80` | mono                |
| `swiss`      | [styles/swiss.html](styles/swiss.html)           | white · Helvetica · strict double rules · red accent | `#e8190f` | Helvetica/Inter     |
| `xhs`        | [styles/xhs.html](styles/xhs.html)               | cream + hot pink · chips · #hashtags · ❤️💬 row      | `#ff2e63` | sans                |

Choose by content tone, not by content type - `academic` works for finance
too if the tone is reflective; `terminal` works for non-tech if the tone is
"engineering rigor".

## Video Frames - decoration around the video element

| key        | file                                         | character                                                    | when to skip                                     |
| ---------- | -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `clean`    | [frames/clean.html](frames/clean.html)       | no decoration; raw video                                     | default; safest                                  |
| `hairline` | [frames/hairline.html](frames/hairline.html) | double-stroke + four-corner viewfinder ticks                 | over `overlay` layout (clashes with full-bleed)  |
| `polaroid` | [frames/polaroid.html](frames/polaroid.html) | white photo frame + Caveat label + blue washi tape (no tilt) | over `overlay` layout; portrait PiP gets cramped |

A frame is a decorative div that sits **next to** the `#video-wrap` inside
the composition's `#stage`. It is one-time HTML (not animated), but you can
fade it in/out across cards. See each frame file for the placement snippet
and the inline `<style>` it needs.

## Decision guide (loose, not prescriptive)

| video content                    | suggested combos                                         |
| -------------------------------- | -------------------------------------------------------- |
| interview / dialogue             | `academic` × `stack`, `audit` × `split`                  |
| product launch / announcement    | `editorial` × `overlay`, `geom` × `pip`                  |
| data analysis / financial report | `audit` × `split`, `swiss` × `stack`, `terminal` × `pip` |
| social clip (9:16)               | `xhs` × `overlay`, `editorial` × `stack`                 |
| technical tutorial               | `terminal` × `split`, `whiteboard` × `pip`               |
| emotional story / narration      | `spotlight` × `overlay`, `whiteboard` × `overlay`        |
| minimalist presentation          | `minimal` × `split`, `swiss` × `overlay`                 |

These are starting points only. Look at the transcript, pick the tone, then
pick the visual.

## Portrait sizing - bigger type for mobile

Every `references/styles/*.html` is sized for a **1920×1080 landscape**
preview. When the final composition is **portrait (1080×1920)** - the
default for social / mobile - scale every visual size up so it reads on a
phone held close.

| token                 | landscape | **portrait** | scale |
| --------------------- | --------- | ------------ | ----- |
| hero title (h1/h2)    | 64–96px   | **88–132px** | ×1.35 |
| detail / body         | 24–30px   | **30–40px**  | ×1.30 |
| kicker / chip / meta  | 14–18px   | **18–22px**  | ×1.25 |
| primary number / stat | 48–60px   | **64–88px**  | ×1.40 |
| horizontal padding    | 40–64px   | **24–36px**  | ÷1.5  |

`portraitPx ≈ round(landscapePx × 1.3)`. Hero headlines can go ×1.4;
small meta stays at ×1.2. Padding **shrinks** in portrait since the card
is narrower.

For a card that must work in both, use a container query on the card
root: `container-type: inline-size` + `font-size: clamp(64px, 8.5cqi, 132px)`.

## Source aspect ratio independence

Output canvas is independent of source video aspect. Three supported
output ratios (selected by the user in Step 7.0 of SKILL.md):

| ratio  | canvas    | `storyboard.layout`                                    | best for                                                   |
| ------ | --------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `16:9` | 1920×1080 | `"landscape"`                                          | YouTube / TV / desktop playback                            |
| `9:16` | 1080×1920 | `"portrait"`                                           | TikTok / Reels / short-form mobile                         |
| `4:5`  | 1080×1350 | `"portrait"` (schema treats 4:5 as portrait since h>w) | Instagram feed / WeChat Moments / works for both platforms |

The layout reference files in `layouts/` document **landscape** and
**portrait** bounds only. For **4:5** derive bounds by proportional
vertical scaling from portrait: `4:5 y/h = round(portrait y/h × 0.703)`,
keep `x/w` identical. The composer doesn't care about the named layout
value; it just uses `composition.width × height`.

- Landscape video on landscape canvas → `videoBounds` matches video aspect, no letterbox
- Portrait video on landscape canvas → `videoBounds` is a narrower box (e.g. `pip` becomes 248×440); empty side filled by card or background
- Landscape video on portrait canvas → `videoBounds` becomes a wide-but-short band; `stack` and `overlay` work best
- Portrait video on portrait canvas → most natural; any layout

The layout reference files show landscape values; for portrait you usually
flip the long axis: `split` becomes top/bottom, `pip` video bubble shrinks
~20%, `overlay` card slot widens to full width.

## Constraints you must obey when copying from these references

1. **No `<script>`** - animations only via `data-anim-*` attributes
2. **No external URLs** - no Google Fonts CDN, no remote images; the
   skill provides Caveat / LXGW WenKai TC / Inter / Virgil locally
3. **All `<style>` rules must be prefixed with `.card[data-card-id="..."]`** -
   the hyperframes sanitizer auto-scopes them, but write them already-scoped to
   stay readable
4. **No `on*=` inline handlers**
5. **CSS variables for colors** when you want a card to switch theme cleanly;
   inline hex when you want this specific style's signature look

If a reference uses a font you don't have, fall back:

- Playfair Display / Noto Serif SC → `ui-serif, "Songti SC", "Times New Roman", serif`
- Noto Sans SC → `ui-sans-serif, system-ui, sans-serif`
- JetBrains Mono → `ui-monospace, "SF Mono", Menlo, monospace`
- Kalam → `'Caveat', cursive`
