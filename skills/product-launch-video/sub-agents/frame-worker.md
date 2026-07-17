# Frame worker — product-launch delta

> The shared law is the core contract above (the packet builder prepends `../hyperframes-core/references/frame-worker-core.md` to this file as `_role.md`) — read the two as one role. This file carries only what's specific to a product-launch frame; you run N-up, **one frame each** — your dispatch carries exactly one packet. Tempted to add a generic GSAP / timeline rule here? Wrong home — it belongs in the core contract or `hyperframes-core`.

## Your `focal:` / `roles:` — real captured media

- `focal:` — which candidate is the hero.
- `roles:` — each candidate's role: `cutout` foreground / `background` full-bleed / supporting — plus the real media available (each `public/<basename> — description`; a **`[video]`** tag marks a `.mp4` motion source that cannot be mounted by this sub-composition worker).
- **Asset paths are project-root relative everywhere.** This includes HTML attributes and CSS `url(...)` values such as `@font-face src`: use `assets/...` (or the supplied `capture/assets/...` path), never `../` or `../../`. Shared fonts are staged before dispatch so every parallel frame resolves the same local files; never fall back to a network `@import`.

## Placing candidates (product-launch constraint)

**Place each candidate by its `roles`** (the `focal` is the hero): a `cutout` is a foreground subject — respect the 83% keep-out, lay text around it, not over its face; a `background` is full-bleed and dimmed ~30–50% so foreground content stays legible. Frame files are sub-compositions. Audio remains orchestrator-owned: never author `<audio>` in a frame. An approved `[video]` candidate may be declared as a frame-local `<video data-frame-video="approved" data-start="..." data-duration="..." data-track-index="...">`; `assemble-index.mjs` hoists it to the host root and translates its timing. Give every approved video explicit host geometry with numeric `data-frame-video-x`, `data-frame-video-y`, `data-frame-video-width`, and `data-frame-video-height`; optionally set `data-frame-video-fit="cover|contain|fill|none|scale-down"` (default `cover`). The assembler converts only those values to host CSS: frame-local classes and inline styles do not cross the hoist boundary. Do not use this declaration for audio, unapproved URLs, or videos without explicit timing and geometry. If no approved video is supplied, use an explicitly supplied static still/key art (`[video-still]` or another image candidate) as `<img>`; do not extract a frame, fabricate a URL, or silently embed an unapproved clip.

Brand text comes from your frame's `scene` / narrative — never from `frame.md` (a style spec, not the product's content). Place the named assets, and never invent new ones.
