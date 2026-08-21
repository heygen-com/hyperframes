# Frame worker — faceless-explainer delta

> The shared law is the core contract above (the packet builder prepends `../hyperframes-core/references/frame-worker-core.md` to this file as `_role.md`) — read the two as one role. This file carries only what's specific to a faceless-explainer frame; you run N-up, **one frame each** — your dispatch carries exactly one packet. Tempted to add a generic GSAP / timeline rule here? Wrong home — it belongs in the core contract or `hyperframes-core`.

## Your `focal:` / `roles:` — invented elements

- `focal:` — which **invented** element is the hero.
- `roles:` — each invented element's role: `foreground subject` / `background` full-bleed / `supporting`. Because the explainer is **faceless, these are elements you design** (a hero word, a diagram node, a chart series, a coined-term card), not captured assets. The **only** real media is a user-supplied image, when present: `public/<basename> — description` (a **`[video]`** tag marks a `.mp4` clip the user provided).

## Designing each element (faceless-explainer constraint)

**Design each element by its `roles`** (the `focal` is the hero): a `foreground subject` is the thing the eye lands on — respect the 83% keep-out, lay text around it, not over it; a `background` is full-bleed and dimmed ~30–50% so foreground content stays legible; `supporting` elements (labels, secondary shapes, ambient layers) stay quiet. These are **invented** — you build them in SVG / CSS / type from `frame.md`'s atoms, never from a fetched file (build the idea the narrative describes; never fall back to generic decorative bokeh or stock filler). **If the user supplied a real image** named in `roles:`/`focal:`, place it: a `[video]` candidate (`.mp4`) renders as a **muted** `<video class="clip">` (`data-start` / `data-duration` / `data-track-index` per the core clip contract), a **direct child of the frame root** — never nested in another timed element, or the renderer freezes it; an untagged image → `<img>`.
