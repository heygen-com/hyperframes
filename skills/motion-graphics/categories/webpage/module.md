# webpage — category module (search-driven)

**Animate a webpage / link** (the "website animation" use case). Search-driven: the user gives or names a URL → fetch/capture it → animate it (scroll-through, UI reveal, cursor demo, region callouts). Distinct from captioning an existing _video file_ (that's `/embedded-captions`) and from a narrated video _of_ a site (that's a `/product-launch-video` site-tour ask); here the source is a _web page_ and the output is a short, unnarrated highlight shot.

## Source (Step 2)

Fetch the page via `hyperframes capture` (DOM + screenshots) or a provided screenshot → frozen project-local image(s)/DOM. `asset_needs`: `{ kind: web, source: <url>, treatment: none }`.

## Vocabulary / leans on

- Rules: `hyperframes-animation/rules/{3d-page-scroll, demo-page-scroll-spotlight, cursor-click-ripple, coordinate-target-zoom, viewport-change}`.
- Primitives: scroll pan · spotlight/dim · cursor move + click-ripple · zoom-to-region · callout pin + label.

## Build (reuse-first)

Place the captured page as the base layer; animate a **scroll-through** (translateY over the page height), **spotlight** key regions (dim + highlight), a **cursor** that moves and clicks (ripple), **zoom** to a coordinate, and **callout** pins/labels anchored to page regions. Honor `builder-contract.md`.

**Two rules that match the news article-highlight (see `../news/module.md`):**

- **Highlights are swept/animated ON, never pre-applied** — a spotlight box wipes in (`scaleX 0→1`), a marker sweeps a region, a callout pops _after_ the zoom lands; the page never starts pre-annotated.
- **Anchor to REAL element positions** — `hyperframes capture` gives the page HTML/DOM, so measure the target element (`getBoundingClientRect` → stage-local) and zoom/highlight it exactly, step-by-step (the "highlight a real element" technique). Don't eyeball coords.
