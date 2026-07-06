---
name: figma
description: Import Figma content into a HyperFrames composition — rendered assets, brand tokens, components, storyboard sections → animatics (REST/CLI), and Figma Motion animations + shaders (MCP). Use when the user pastes a figma.com link or asks to bring a Figma design, frame, logo, brand, or animation into a video/composition.
---

# Figma → HyperFrames

Bring the user's Figma work into a composition. **Split by capability** (design spec §2):

| Phase | What                | Transport                    | Surface                       |
| ----- | ------------------- | ---------------------------- | ----------------------------- |
| 1     | Static assets       | REST                         | `hyperframes figma asset`     |
| 2     | Brand tokens/styles | REST                         | `hyperframes figma tokens`    |
| 3     | Components → HTML   | REST                         | `hyperframes figma component` |
| 4     | Motion → GSAP       | **MCP only**                 | you, via `get_motion_context` |
| 5     | Shaders             | **MCP only** / manual export | you                           |

REST is used wherever it can be (usable at volume, headless); MCP only where Figma exposes no REST equivalent (motion, shaders). Every path freezes assets locally so renders stay deterministic. Storyboard animatics compose Phase-1 asset exports (REST) with agent-driven timeline assembly — no MCP needed. Existing frozen assets, manifest records, and bindings are unaffected by routing changes — the split only changes which credential the next import uses.

## Auth — two credentials, scoped

**Preflight — before the first CLI call, check a token exists**: shell env (`[ -n "$FIGMA_TOKEN" ]`) **or** the project `.env` (the CLI auto-loads it — a `.env` entry counts as configured). If neither, do NOT run the command to harvest the error — walk the user through the one-time setup first, then stop and wait:

1. figma.com/settings → **Security** → **Personal access tokens** → Generate new token.
2. Scopes — read-only is all this integration ever needs (it never writes to Figma): **File content: Read-only** + **File metadata: Read-only**. Optionally **Variables: Read-only** for brand variables — that scope only works on Figma Enterprise; without it `tokens` degrades to published styles automatically (expected behavior, not an error — say so).
3. `export FIGMA_TOKEN="figd_…"` — and suggest persisting it (shell profile or project `.env`) so no future session repeats this.

While onboarding, also set expectations in one breath: every import lands as a **local frozen file with recorded provenance** — renders never call Figma, re-running a command re-imports only what changed in Figma, and one token works for assets, brand tokens, and components across every file their Figma account can view.

- **Phases 4–5 (motion/shaders):** the Figma MCP connector (one-click OAuth), a separate credential from the token. If MCP tools error unauthenticated, tell the user to connect the Figma connector and stop.
- Say exactly which credential a failing phase needs — never present the split as broken.
- `BAD_TOKEN` (401) mid-flow → the token is expired/revoked; re-mint. `FORBIDDEN` (403) → missing read scope or no access to that file — check scopes + file visibility. `REQUIRES_ENTERPRISE` (403 on variables) → not a failure: styles fallback already ran.

**Rate-limit awareness (spec §2.1):** MCP on a Starter plan is 6 tool calls/**month** (figma plan matrix as of 2026-07 — re-verify if quotas look off) — batch with `recursive:true` on the parent node, skip verification screenshots unless asked, and cache raw MCP responses so re-derivation never spends a second call. REST is per-minute (10+/min, per-endpoint buckets) — fine at volume, back off on 429.

## Routing

Parse the user's figma link with `parseFigmaRef` (URL, `fileKey:nodeId`, bare `fileKey`). Then by intent:

- "use this layer / logo / image" → **Asset** (CLI)
- "pull my brand / colors / tokens" → **Tokens** (CLI)
- "build a scene from this frame" → **Component** (CLI)
- "import this animation / motion" → **Motion** (MCP, below)
- a storyboard section / filmstrip of scene frames → **Storyboard** (below)
- shader fill/effect → **Shaders** (below)

**Narrate every step for the user** — before each command say what you're about to pull from Figma; after it, say where the artifact landed (the frozen path / sidecar / component dir), what changed in the composition, and the immediate next action (preview, add printed variables, re-import to link bindings). The user should never have to ask "did it work?" or "now what?".

## Assets (Phase 1 — CLI)

```bash
hyperframes figma asset '<url-or-fileKey:nodeId>' [--format svg|png|jpg|pdf] [--scale 2] [--description "..."] [--entity "..."]
```

Renders over REST, sanitizes SVG, freezes under `.media/images/`, appends the manifest with provenance, regenerates `.media/index.md` (the shared media-use inventory), prints an `<img>` snippet. Idempotent per `fileKey:nodeId:format:scale:version`. Prefer SVG for vectors/logos (scalable, animatable), PNG `--scale 2` for raster fidelity. **Always pass `--description "<what it is>"`** (it becomes the index row + `<img alt>`); add `--entity "<name>"` for named brand marks so media-use `resolve --entity` finds them later (entity hits match across image/icon).

## Tokens (Phase 2 — CLI)

```bash
hyperframes figma tokens <fileKey>
```

Imports variables as composition brand-variable entries + `figma-tokens.json` sidecar + binding-index records (`.media/figma-bindings.jsonl`). Variables are Enterprise-gated upstream: on other plans the command degrades to published-style metadata (values resolve at component-import time). Add the printed entries to the composition's `data-composition-variables`.

**Import tokens before components** when both are wanted — that's what lets component colors link to brand variables instead of baking duplicates.

## Components (Phase 3 — CLI)

```bash
hyperframes figma component '<url-or-fileKey:nodeId>'
```

Node tree → editable HTML at exact figma geometry, packaged as a registry item under `compositions/components/<name>/`. Vectors/boolean-ops auto-rasterize via Phase-1 export. Binding pass (spec §7.1, exact-ID only — never value matching):

- Fill bound to an **imported** token → `var(--slug, #literal)` — brand refresh propagates.
- Bound to an **unknown** token → literal + `data-figma-unresolved` flag. The command tells you; offer the user: run `tokens` on the source (or library) file, then re-import the component to link them. Ask **once** per unknown library which file it is — never guess, never match by hex.

## Motion (Phase 4 — MCP, the headline)

**Usage beacon:** MCP phases have no CLI touchpoint, so fire the skill beacon at start and finish (anonymous, consent-gated, never fails): `npx hyperframes events --skill=figma-motion` when you begin, `npx hyperframes events --skill=figma-motion --event=skill_completed --outcome=success|error` when done. Same for shaders (`figma-shaders`) and storyboards (`figma-storyboard`).

No REST equivalent exists. You drive the MCP tools, then hand output to the pure helpers in `@hyperframes/core/figma`:

1. `get_motion_context(fileKey, nodeId)` — use `recursive:true` on the parent frame (one call for the whole scene, not one per element). Save the raw JSON next to the project (`.media/figma-cache/`) so retranslation is free.
2. Normalize into a `MotionDoc`: per animated property a `MotionTrack` { property (motion.dev name), values, times (0..1), ease[] (named or `[x1,y1,x2,y2]` bezier), duration, repeat }. Selector = the element's stable id (`#<id>` from Phase-3 output or the authored scene).
3. `motionToGsap(doc)` → `emitTimelineScript(spec)` → inject as a `<script>` after the GSAP + CustomEase CDN tags. Paused, finite, registered on `window.__timelines` with a literal key.
4. Untranslatable track (shader-driven, unsupported prop, complex masks) → bake: `export_video` → freeze MP4 → embed as `<video class="clip">`. Exception: shader-driven tracks — figma's export path flattens shaders to the base color (see Shaders below), so a bake there silently loses the shader; ask the user for a native figma export instead. Always say which path you used and why. Named eases outside the mapped set fall back to linear — the mapping table lives in `motionEase.ts`; flag the fallback to the user when it fires.
5. Run `npx hyperframes lint && npx hyperframes validate` before calling it done.

## Shaders (Phase 5 — mostly manual)

Figma's MCP render path does not execute shaders (they flatten to the base color), and shader source is only reachable for **library-published** styles (paid Full seat). Default path: ask the user to export the shader frame natively in Figma (PNG or Motion MP4), then import it as a Phase-1 asset / clip. Don't attempt MCP pixel capture of a shader — it will silently produce the wrong thing.

## Storyboards (a SECTION of scene frames → animation)

**The cardinal rule: storyboard frames are KEYFRAMES, not slides.** Two frames containing the same element describe that element's state through time — animate the ELEMENT between the states; never play the frames as a sequence of stills. A logo drawn in four consecutive frames at descending y is ONE element rising through four keyframes. Playing storyboard frames back-to-back is the failure mode; reconstructing the element timelines they imply is the job.

Storyboard files follow a grammar you can parse mechanically — don't eyeball, decode:

1. **Scene units**: inside the SECTION, every frame-sized node is a scene — both named FRAMEs _and_ loose full-frame RECTANGLEs (designers paste stills straight into the section). Filter by size (≈ composition aspect, e.g. >1400×900), not by node type or name.
2. **Order = x-position** (row-major if the strip wraps). Sort scenes by `absoluteBoundingBox.x`.
3. **Diff adjacent frames into element chains** — this is where the animation lives. Match children across consecutive frames: first by **name** (same name = same element → tween its relative x/y/w/h between states), then by **geometry similarity** (similar size + nearby center = same logical element whose pixels changed → crossfade the two exports in place while tweening geometry; covers typed-text progressions and morph states). Unmatched children enter/exit at their scene's beat. Frame background fills tween as a color track. Export ONE asset per chain (one per state only when pixels genuinely differ) — never one still per frame.
4. **Stills are the fallback, not the default** — only for frames that don't decompose (flat full-frame screenshots with no shared elements); those get the animatic treatment below.
5. **Director notes**: TEXT nodes below the strip are motion intent, paired to the scene whose x-range they overlap. They describe _how_ to animate — they are not on-screen copy.
6. **Batch exports** (elements or stills): `GET /v1/images` accepts comma-separated ids, but big scene frames hit "Render timeout" past ~12 ids — chunk to ~4 per call with a retry. (One call per scene wastes the rate budget; 26 scenes ≈ 52 calls via the single-asset path.)
7. **Note verbs → transitions** (starter vocabulary, extend as encountered):

| Note says                       | Do                                                                |
| ------------------------------- | ----------------------------------------------------------------- |
| EXPLOSION / BURST               | incoming scale ~1.5→1 + fade, `power3.out`                        |
| SLIDES / SLIDE TO THE… / SCROLL | directional slide in from that edge                               |
| MORPH / REVEALS                 | crossfade — or Phase-3 import if the motion is inside one scene   |
| CYCLE THROUGH / EACH ONE        | longer hold — or Phase-3 import if items animate within the scene |
| (no note)                       | crossfade + slow Ken-Burns drift                                  |

8. **Stills vs. components routing**: a note describing motion _between_ scenes → transition on the still (above). A note describing motion _inside_ a scene ("TEXT LINES REVEAL ONE AFTER THE OTHER", "PILLS ANIMATE IN") → that frame deserves a Phase-3 component import (real elements) animated per the note, not a flat PNG. Do the animatic pass first with stills, then upgrade the scenes the notes single out.
9. One `main` timeline sequences everything (opacity/x/y per scene at absolute times) — no per-scene sub-compositions needed for an animatic.

## Determinism

Never leave a Figma URL in the composition — freeze first. Never emit `repeat: -1`. Timelines paused, finite, literal `window.__timelines` keys. All Figma I/O at import time; render sees local files only.
