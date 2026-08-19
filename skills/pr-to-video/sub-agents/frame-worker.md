# Frame worker — PR-to-video delta

> The shared law is the core contract above (the packet builder prepends `../hyperframes-core/references/frame-worker-core.md` to this file as `_role.md`) — read the two as one role. This file carries only what's specific to a PR-to-video frame.

## Batch dispatch — you build a small packet batch

At most three workers run; your dispatch assigns **one or more** bounded packet paths under `.hyperframes/frame-packets/`. Read this role and shared `frame.md` **once**, then process the packets in order — for each, use its exact frame block, inlined blueprint / rule excerpts, and (for a code beat) the selected code-block / source excerpts. Never open the full `STORYBOARD.md`, `capture/diff.patch`, or `capture/extracted/visible-text.txt`; the orchestrator already selected the exact source excerpt and put it in each code frame's packet. After the last assigned file passes the self-check, stop.

Extra inputs beyond the core contract:

- `code-vocabulary.md` — absolute path provided in your dispatch. For a **code beat**, read it for the named `code-*` block's exact inputs (`window.__TOKENS`, `window.__BLOCK`, line indexing); your packet carries the matching excerpt.
- `focal:` — for a concept/mechanism beat, which **invented** element is the hero; for a **code beat**, the named **`code-*` block** (+ the hunk); for the **credits** close, the avatar row.
- `roles:` — each element's role: `foreground subject` / `background` full-bleed / `supporting`. Most are invented elements you design; the only real assets are the credits `assets/<login>.png` avatars.

## Mostly invented — you build the visual (except code blocks + the credits avatars)

A PR video is **mostly invented**: there are **no screenshots and no captured UI**. For `hook` / `change` / `mechanism` / `impact` / `cta` frames the `focal` / `roles` name **invented** elements — a hero line, a coined-term card, a `number-lockup` stat, a coral callout, **a `mechanism` animated diagram of the behavior** — that **you design and build in HTML/CSS/SVG** from `frame.md`. Build the idea the narrative describes; never fall back to generic decorative bokeh or stock filler. Two beats are NOT invented from scratch — see the next section: **code beats** use a ready-made `code-*` block, and the **credits close** uses the real contributor avatars.

## PR code beats, mechanism beats + the credits close

- **Code beats (`diff` / `before_after` / a new-code reveal) — use the named `code-*` block, don't hand-build code motion.** Your `## Frame N` `scene` / `focal` names which block (e.g. `code-diff`, `code-morph`, `code-typing`); the orchestrator has already installed it (pre-install step). Read the `code-vocabulary.md` excerpt in your packet for that block's exact inputs, then:
  - Use only the packet's `### Source excerpt`. It is the real before/after hunk selected upstream. Never reopen the full diff or brief.
  - Fill the block's `window.__TOKENS` with that real code (the baked Shiki tokens) and set `window.__BLOCK` (effect, `line`, `duration`) **so the full block completes within the frame's `data-duration`** — a long snippet at the block's default per-character cadence overruns a short frame (the code never finishes typing). `code-diff` / `code-morph` need **2 states** (before, after); the others take one. **Line indexing differs — `code-highlight` is 0-based, `code-scroll` 1-based** — don't off-by-one.
  - Integrate the filled block as **this frame's composition** per the core sub-composition contract: its `data-composition-id` and its `window.__timelines[...]` key must both be your **`<frame_id>`** (the block ships its own id + paused timeline; rename both to match the frame contract). The block already renders an editor window (titlebar / filename) reading as code-editorial's navy **Code Surface** — set the filename + any `+N/−M` chrome from the `scene`.
  - **The block owns the code animation; your Scene windows choreograph the surrounding Code Surface** — the navy window seating in, the file header typing on, the camera settling onto the hunk, a coral underline on the landed line. **Do not re-specify the code motion** (the block is the development beat). A code beat is usually `blueprint: compose`.
  - **The block has no caption-safe band.** When `Captions: enabled`, inset/scale the code panel into the top ~83% so it clears the keep-out band; never let code run under the caption pill.
- **Mechanism beats (`mechanism`) — build an invented animated diagram of the behavior; the build _is_ the shot.** This is the "show what the change does at runtime" frame (the request retrying, the cache filling, serial→parallel, the race resolved) — read its `scene` for the behavior to animate. Unlike a code beat, **the motion is yours to author** (no block owns it):
  - If the `scene` names a `flowchart` / `flowchart-vertical` / `data-chart` block, the orchestrator pre-installed it — fill + mount it like a code block (its `data-composition-id` and `window.__timelines[...]` key both become your `<frame_id>`). Otherwise **hand-build the diagram in SVG / HTML / GSAP** from `frame.md`'s atoms.
  - **Code editorial register:** hairline-ink nodes / edges / lanes on the cream ground, **one coral marker** on the active / changed element, mono labels — **not** the navy code surface (that's for code), no heavy shapes / bokeh.
  - **Choreograph the Scene windows:** the nodes / lanes draw on (Scene 1); **the flow runs** as the VO names each step (middle Scenes — the request hops, the lane splits, the front advances, the bars race) — this _is_ the teaching, so it must play across the shot, never enter-then-freeze; the resolved state + the one coral emphasis lands (final Scene). Keep it in the top ~83% (caption keep-out).
- **The `credits` close — the one frame with real assets.** Its `asset_candidates` names 2–6 `assets/<login>.png` avatars (downloaded upstream). Render them as `<img>` in hairline-ringed chips — an avatar row with each contributor's name + role in mono (an "approved" mark if the close calls for it), staggered in across the Scene windows. Avatars appear **only** here, never decorating a code frame.

## PR-specific self-check additions

- The composition root also carries a **positive `data-duration` matching the packet**.
- **Code-block cadence fits `data-duration`** — for a code beat, the `code-*` block's internal cadence is set so the full block completes within the frame's `data-duration` (a long snippet at the default per-character speed overruns — the code never finishes and the chrome beats never play; see `code-vocabulary.md`).
- Fonts: copy the auto-generated `@font-face` block from `frame.md`; the Code editorial preset's EB Garamond, Inter, and JetBrains Mono faces live in `assets/fonts/`. Never link Google Fonts.
- Visible-text exception: real code inside a `code-*` block is the content, not narration.
