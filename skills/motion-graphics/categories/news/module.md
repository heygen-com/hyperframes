# news - category module (search-driven)

Search a real news article → animate it as an **article-highlight** - a faithful HF port of the centered-emphasis technique. Signature motion: the article text is laid out at a **readable size (NOT zoomed)**, slides + fades up, then the **keyword is highlighted in place** - a marker band grows left→right behind it. No blow-up zoom. ~5–7s.

Two layouts share that one highlight core - pick by aspect + whether there's a logo / person to feature:

| Layout                    | Aspect     | Use when                                                        | Has                                                                        |
| ------------------------- | ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **A · centered-emphasis** | 9:16 / 1:1 | text-only, social vertical                                      | kicker + one centered sentence + keyword highlight                         |
| **B · full article**      | 16:9       | there's a real **outlet logo** and/or a **person** in the story | logo + date + multi-line headline highlight + dek + outlet + person cutout |

## Source (Step 2)

RWA / web search (or `hyperframes capture`) → a real article. The Director extracts the **keyword** (1–2 words / a number / a name - the hook) and, for Layout B, also a **brand logo**, a **date**, and a **person photo**. `asset_needs: { kind: news|web|image, query }` - request the logo (Wikimedia / simple-icons) and the person photo (Wikimedia) as separate asset queries. Run the person photo through `hyperframes remove-background <in> -o <out>.png` to get a transparent cutout.

## The highlight core (shared by both layouts) - the marker-band technique

The keyword highlight is a marker band grown L→R via `background-size` (NOT a `transform:scaleX` bar):

```css
.hl {
  --hlw: 0%;
  background-image: linear-gradient(var(--hl), var(--hl)); /* --hl: rgba(250,222,99,.6) */
  background-repeat: no-repeat;
  background-position: 0 72%;
  background-size: var(--hlw) 64%;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
```

`box-decoration-break:clone` makes the band **wrap across line breaks** seamlessly, a multi-word keyword spanning 2-3 lines still highlights continuously (the old `scaleX` bar could not). Anime.js tweens the CSS var `--hlw` 0% -> 100%, **swept on AFTER the text settles, never pre-applied**. Optionally scale the duration with keyword length ~0.5-1.5s.

## Layout A - centered-emphasis (9:16, text-only) - Builder

1. **Lay out the key SENTENCE at a readable size - do NOT zoom.** Paper-light stage; an outlet `#kicker` (e.g. "BBC NEWS · TECHNOLOGY", brand accent) at top; the key sentence centered, serif, **~70–76px / 700 / line-height ~1.4**, `max-width ≈ 900`. The whole sentence stays legible; the keyword is emphasized _within_ it.
2. Wrap the keyword inline: `… raised <span class="hl" id="kw">$750M</span> at …`.
3. **Timeline** (seek-safe, paused): kicker fades+slides in -> **sentence slides+fades up** (`tl.add(..., { opacity:[0,1], translateY:[52,0], duration:800, ease:"outQuart" }, ...)`, no zoom) -> **keyword highlight grows** (`--hlw` 0% -> 100%, after the sentence settles) -> gentle hold (`scale 1.012`).

**Reference:** `samples/news/_ref-centered-emphasis.html` (+ `news/v2-*`).

## Layout B - full article (16:9, logo + person) - Builder

The editorial article-card layout (logo top-left + date + big serif headline with a multi-line keyword highlight + dek + outlet bottom-left + a background-removed **person cutout** bottom-right). 1920×1080, paper-light gradient stage, Georgia serif.

1. **Logo** top-left (`#logo`, ~64px) - inline the outlet/brand SVG, `fill:currentColor`, set `color` to the mark's own hue (or near-black for a monochrome mark). **Date** below it (`#date`, ~30px, muted).
2. **Headline** (`#headline`, Georgia **96px / 700**, `width≈1080`, `line-height 1.16`) with the keyword wrapped in `<span class="hl" id="kw">` - the highlight band sweeps across **all wrapped lines** of the phrase.
3. **Dek** (`#dek`, Helvetica ~38px gray) under the headline; **outlet** (`#outlet`, Georgia bold ~50px) bottom-left.
4. **Person cutout** (`#subject`, the bg-removed PNG, `height≈860`, `right:40; bottom:0`, `drop-shadow`) - **slides up from bottom-right** as the hero beat.
5. **Timeline** (seek-safe, paused): logo `outBack` @150ms -> date @400ms -> **subject slides up** (`tl.add(..., { opacity:[0,1], translateX:[90,0], translateY:[60,0], duration:850, ease:"outQuart" }, 450)`) -> headline @700ms -> dek @1500ms -> outlet @1900ms -> **keyword highlight** (`--hlw` 0% -> 100%, `duration:800`) @2200ms. duration ~6.5s.

**Reference:** `samples/news/_ref-article-layout.html` (a real article rendered with a real outlet logo + a background-removed person + a real story).

## Critical

Highlight is **grown in place, swept on AFTER the text, never pre-applied**. The text **stays readable, do NOT zoom the keyword to fill the frame** (team feedback 2026-06-09: zoom loses context and reads wrong; the technique never zooms, it presents the text and highlights the word). For Layout B, the person MUST be a `remove-background` cutout (no rectangular photo box). Deterministic; honor `references/builder-contract.md`.
