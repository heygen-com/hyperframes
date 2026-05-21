# Amplifier Composition Constraints

These constraints are non-negotiable. The Amplifier worker will reject and retry any
composition that violates them.

## Required structure

- The composition root element MUST have:
  - `data-composition-id="amplifier-explainer"`
  - `data-width` and `data-height` MUST match the aspect ratio in the user prompt header.
    Use these pixel dimensions:
    - 16:9 → `data-width="1920" data-height="1080"`
    - 1:1 → `data-width="1080" data-height="1080"`
    - 9:16 → `data-width="1080" data-height="1920"`
  - `data-duration="<targetDurationSeconds>"` — matches the brief's target duration in seconds.
- The composition MUST register a paused GSAP master timeline as:
  ```js
  window.__timelines = window.__timelines || {};
  window.__timelines["amplifier-explainer"] = tl; // tl = gsap.timeline({ paused: true })
  ```
- Every scene clip MUST have `data-start` and `data-duration` attributes.
- Scene clips MUST NOT carry inline `visibility:hidden` or `opacity:0` styles. The
  Hyperframes runtime drives visibility from `data-start`/`data-duration`. Animate inner
  elements (text, cards) with opacity if you want fade-ins.

## Audio

- If the brief has voiceover enabled, the composition MUST include
  `<audio id="narration-track" src="./narration.mp3" data-start="0" data-duration="<targetDurationSeconds>" data-track-index="8"></audio>`.
  The worker writes `narration.mp3` next to `index.html`.
- If voiceover is disabled, do not include an `<audio>` track.

## Aspect-ratio safe zones

The user prompt header tells you the target aspect ratio and exact pixel dimensions.
Lay out the composition so:

- 16:9: keep focal content inside the central 92% of the frame; captions in the lower third.
- 1:1: SQUARE — keep focal content inside the central 80%; captions in the bottom 20%, well clear of edges; do NOT assume landscape width for typography or image placement.
- 9:16: PORTRAIT — vertical stack; captions in the lower 25%; never use a landscape-only layout.

## Author attribution

When the user prompt header specifies an "Author reference style" line, follow it for ALL narration text and any on-screen author credit:

- `first_name` — refer to the author by first name throughout (casual, conversational).
- `formal_third` — refer to the author formally in the third person (e.g., "the author argues…"). Avoid first names.
- `full_attribution` — use the author's full name on first mention, then first or last name as natural thereafter.

When no style is specified, default to `full_attribution`.

## Connector lines and arrows between elements

Do NOT draw connector arrows between absolutely-positioned elements (boxes,
nodes, cards) using `position:absolute` divs with hardcoded pixel offsets and
`transform:rotate(...)`. The coordinates depend on the rendered width of the
parent container — they look right in the LLM's imagined viewport and end up
crossing through the boxes or missing them entirely in the actual render.

Instead, do one of:

- **Inline SVG with viewBox.** Wrap the diagram in `<svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">` and draw `<line>`, `<polyline>`, or `<path>` between coordinates that match the same viewBox. The SVG scales with its container and connectors stay attached.
- **Text arrows in a flexbox row.** Use `display:flex` with `→`, `↓`, `↔`, or `—` characters as separators between boxes. Trivial to align, never drifts.
- **Skip the connector.** Spatial proximity + a kicker label often communicates the relationship more clearly than a line ever does.

If you absolutely must use absolutely-positioned boxes, also draw the connectors as `<svg>` overlaying the same container with `position:absolute;inset:0` and a `viewBox` that matches the container's pixel size.

## Images

The user prompt header may include a `Cover image URL:` line. If present:

- The value will be a **relative local path** beginning with `./` (e.g. `./cover.png`). The worker has already downloaded the cover image to the project directory.
- Reference it as `<img src="./cover.png" ...>` — do NOT add `crossorigin="anonymous"` on relative-path images.
- If the value is a remote URL (legacy fallback), you may still use it, but be aware Substack-hosted images may fail to load in Chromium due to missing CORS headers.

Author and publication images: do NOT reference any remote image URLs not provided in the prompt. Use typography, color blocks, or initials instead of fetching head-shots.

## Close-scene QR code mount

The composition's final scene MUST include an empty mount element where the worker will inject a QR code for the CTA URL:

```html
<div class="qr-mount" style="width:200px;height:200px;background:#fff;padding:12px;"></div>
```

Place it next to the CTA URL/booklet text so viewers can scan it as the video ends. The worker replaces the mount's contents with an inline SVG QR code post-render. If you omit the mount entirely, the worker will append a fallback QR card to the close scene at the bottom-right, which is uglier than placing it intentionally.

Do NOT attempt to generate the QR code yourself; you cannot. Just include the empty mount.

## Remote scripts

- Allowed: `cdnjs.cloudflare.com/ajax/libs/gsap/...` only.
- No other remote scripts.

## Output format

You return JSON via structured output. The `indexHtml` field is the complete
`<!doctype html>` document. The `narration` array is per-scene narration text the
worker will pass to ElevenLabs (include only when voice is enabled).
