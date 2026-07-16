# Registry discovery

## Use the catalog command first

```bash
npx hyperframes catalog
npx hyperframes catalog --type block
npx hyperframes catalog --type component
npx hyperframes catalog --type block --tag social
npx hyperframes catalog --json
npx hyperframes catalog --human-friendly
```

- Default output is a readable table. It does not install anything.
- `--type` accepts `block` or `component`; `--tag` may narrow either result.
- `--json` is the deterministic agent and CI surface. Select a name, then run `npx hyperframes add <name>`.
- `--human-friendly` opens a picker and installs the selected item immediately.

## Read the registry manifest as a fallback

When the CLI is unavailable, the top-level `registry.json` lists all available items:

```bash
curl -s https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/registry.json
```

Each entry has `name` and `type` (`hyperframes:example`, `hyperframes:block`, or `hyperframes:component`).

## Reading an item's manifest

Each item has a `registry-item.json` with full metadata:

```
<base>/<type-dir>/<name>/registry-item.json
```

Where `<type-dir>` is `examples`, `blocks`, or `components`.

## Item manifest fields

| Field                  | Type     | Required | Description                                    |
| ---------------------- | -------- | -------- | ---------------------------------------------- |
| `name`                 | string   | yes      | Kebab-case identifier                          |
| `type`                 | string   | yes      | `hyperframes:block` or `hyperframes:component` |
| `title`                | string   | yes      | Human-readable title                           |
| `description`          | string   | yes      | One-line description                           |
| `tags`                 | string[] | no       | Filter tags (e.g., `["data", "chart"]`)        |
| `dimensions`           | object   | blocks   | `{ width, height }` — blocks only              |
| `duration`             | number   | blocks   | Duration in seconds — blocks only              |
| `files`                | array    | yes      | Files to install (`path`, `target`, `type`)    |
| `registryDependencies` | string[] | no       | Other registry items this depends on           |

## Available items

### Blocks

For an always-current list run `npx hyperframes catalog --type block`. The tables below group the 97 blocks by category. **Block name ≠ shader name**: shader-transition blocks (e.g. `domain-warp-dissolve`) wrap a HyperShader runtime whose internal name omits the `-dissolve`/`-warp` suffix — see the showcase HTML installed alongside the block for the canonical name.

#### Shader transitions (14)

Single-shader blocks; each installs one HyperShader runtime + a showcase composition. Use ≤2 per video.

| Name                     | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `chromatic-radial-split` | Chromatic aberration radial split                                        |
| `cinematic-zoom`         | Dramatic zoom blur                                                       |
| `cross-warp-morph`       | Cross-warped morphing                                                    |
| `domain-warp-dissolve`   | Fractal noise domain warping                                             |
| `flash-through-white`    | White flash crossfade (rarely a neutral default — see SKILL.md guidance) |
| `glitch`                 | Digital glitch artifacts                                                 |
| `gravitational-lens`     | Gravitational lensing distortion                                         |
| `light-leak`             | Cinematic light leak overlay                                             |
| `ridged-burn`            | Ridged turbulence burn                                                   |
| `ripple-waves`           | Concentric ripple wave distortion                                        |
| `sdf-iris`               | Signed-distance-field iris reveal                                        |
| `swirl-vortex`           | Swirling vortex distortion                                               |
| `thermal-distortion`     | Heat-haze thermal distortion                                             |
| `whip-pan`               | Fast camera whip-pan                                                     |

#### Transition galleries (13)

Showcase compositions grouping multiple CSS / GSAP transition styles by family. Use as reference for picking a CSS scene transition; not meant to embed as-is.

| Name                      | Description                         |
| ------------------------- | ----------------------------------- |
| `transitions-3d`          | 3D perspective flip and rotate      |
| `transitions-blur`        | Blur-based scene transitions        |
| `transitions-cover`       | Cover / uncover slide               |
| `transitions-destruction` | Destructive break-apart             |
| `transitions-dissolve`    | Dissolve and fade                   |
| `transitions-distortion`  | Warp and distortion                 |
| `transitions-grid`        | Grid-based tile                     |
| `transitions-light`       | Light-based glow and flash          |
| `transitions-mechanical`  | Mechanical shutter and iris         |
| `transitions-other`       | Misc creative (VHS, gravity, morph) |
| `transitions-push`        | Push and slide                      |
| `transitions-radial`      | Radial wipe and reveal              |
| `transitions-scale`       | Scale and zoom                      |

#### Liquid Glass (7)

WebGPU + html-in-canvas frosted-glass surfaces. **Require Brave / Chrome canary** with WebGPU enabled — set `PRODUCER_HEADLESS_SHELL_PATH` to point at the browser; engine auto-passes `--enable-unsafe-webgpu`. See `/hyperframes-animation` → `adapters/typegpu.md`.

| Name                          | Description                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `ios26-liquid-glass`          | 3D iPhone (GLTF) + iOS 26 home screen, glass app icons, shader wallpaper, notifications |
| `macos-tahoe-liquid-glass`    | 3D MacBook (GLTF) + macOS Tahoe-style desktop, glass menu bar, Finder, dock             |
| `liquid-glass-widgets`        | Frosted stat cards, showcase panel, pill chips over aurora shader                       |
| `liquid-glass-notification`   | Frosted notification cards floating over aurora shader                                  |
| `liquid-glass-context-menu`   | Frosted context-menu panel drifting over aurora shader                                  |
| `liquid-glass-media-controls` | Frosted media-control panels spreading over aurora shader                               |
| `vfx-liquid-glass`            | Bare VFX composition shell for liquid-glass effects                                     |

#### VFX (6)

HTML-in-canvas + WebGL composition blocks. See `/hyperframes-animation` → `adapters/three.md` and `adapters/html-in-canvas-patterns.md` for the underlying APIs.

| Name                    | Description                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `vfx-iphone-device`     | GLTF iPhone 15 Pro Max + MacBook Pro with live HTML-in-canvas screens, glass-lens morph, 360° turntable |
| `vfx-liquid-background` | Organic liquid sim — vertex displacement on subdivided plane, HTML floats above                         |
| `vfx-magnetic`          | VFX shell (magnetic field-line treatment)                                                               |
| `vfx-portal`            | VFX shell (portal reveal)                                                                               |
| `vfx-shatter`           | VFX shell (shatter into fragments)                                                                      |
| `vfx-text-cursor`       | Cursor glow + chromatic shadow rays + spectral edges on a black stage                                   |

#### Showcases (6)

Story-driven showcase compositions — narrated YouTube-style inserts. Most include bundled SFX.

| Name                       | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `app-showcase`             | Three floating smartphone screens, fitness app product showcase   |
| `apple-money-count`        | Counter $0 → $10,000, green flash, money-icon burst, SFX          |
| `blue-sweater-intro-video` | Warm AI-creator intro resolving into an X follow card             |
| `north-korea-locked-down`  | Map zoom with red scribble circle, locked-down pop-up label       |
| `nyc-paris-flight`         | Map animation, plane NYC → Paris, marker circle, landing pop, SFX |
| `vpn-youtube-spot`         | App-store scroll, VPN install flow, SFX                           |

#### Maps + data viz (8)

D3 + GSAP animated geographies and charts.

| Name                               | Description                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `us-map`                           | US choropleth, staggered state reveals, value labels, gradient legend                              |
| `us-map-bubble`                    | US bubble map — proportional city markers, callouts, connection lines                              |
| `us-map-flow`                      | US flow map — animated origin-destination arcs                                                     |
| `us-map-hex`                       | US hex-grid map — each state as equal-weight hex with data fill                                    |
| `spain-map`                        | Spain choropleth by autonomous community — D3 conic conformal                                      |
| `world-map`                        | World choropleth + rotating globe inset, D3 Natural Earth                                          |
| `data-chart`                       | Animated bar + line chart, staggered reveal, NYT-style typography                                  |
| `flowchart` / `flowchart-vertical` | Decision tree, SVG connectors, sticky-note nodes, cursor + typing correction (vertical = portrait) |

#### Social overlays (7)

Platform-recognizable UI overlays. Stamp on top of a beat or use as a beat closer.

| Name                 | Description                                      |
| -------------------- | ------------------------------------------------ |
| `instagram-follow`   | Profile card + follow button                     |
| `tiktok-follow`      | Profile card + follow button                     |
| `yt-lower-third`     | YouTube subscribe lower third with avatar        |
| `x-post`             | X/Twitter post card with engagement metrics      |
| `reddit-post`        | Post card with upvotes and comments              |
| `spotify-card`       | Now-playing card with album art and progress bar |
| `macos-notification` | macOS-style banner with app icon and message     |

#### Branding + 3D UI (2)

| Name           | Description                                                         |
| -------------- | ------------------------------------------------------------------- |
| `logo-outro`   | Piece-by-piece logo assembly, glow bloom, tagline fade-in, URL pill |
| `ui-3d-reveal` | Perspective 3D reveal for UI elements                               |

#### Code snippets (24)

A code/terminal window that **types a code or shell session per-character**. Theme = visual chrome only; structure, wiring, and install are identical across all 24 — pick one by name, wire it like any block (`data-composition-id` + `data-start` + `data-track-index`, see `wiring-blocks.md`). Two chrome families:

**VS Code workbench (12)** — full editor chrome (activity bar, sidebar, tabs, integrated terminal, status bar). Theme variants: `code-snippet-dark-2026`, `code-snippet-dark-modern`, `code-snippet-dark-plus`, `code-snippet-light-2026`, `code-snippet-light-modern`, `code-snippet-light-plus`, `code-snippet-high-contrast`, `code-snippet-high-contrast-light`, `code-snippet-monokai`, `code-snippet-solarized-light`, `code-snippet-visual-studio-dark`, `code-snippet-visual-studio-light`.

**Apple Terminal (12)** — macOS Terminal.app window typing a shell session. Profile = window colors:

| Name                                         | Look                                     |
| -------------------------------------------- | ---------------------------------------- |
| `code-snippet-apple-terminal-basic`          | White bg, black text                     |
| `code-snippet-apple-terminal-clear-dark`     | Semi-transparent dark bg                 |
| `code-snippet-apple-terminal-clear-light`    | Semi-transparent light bg                |
| `code-snippet-apple-terminal-grass`          | Black bg, green text                     |
| `code-snippet-apple-terminal-homebrew`       | Black bg, bright green text, lime cursor |
| `code-snippet-apple-terminal-man-page`       | Pale yellow bg, black text               |
| `code-snippet-apple-terminal-novel`          | Warm parchment bg, dark brown text       |
| `code-snippet-apple-terminal-ocean`          | Deep blue bg, white text                 |
| `code-snippet-apple-terminal-pro`            | Black bg, grey text, lime cursor         |
| `code-snippet-apple-terminal-red-sands`      | Deep red bg, sandy text                  |
| `code-snippet-apple-terminal-silver-aerogel` | Dark grey bg, white text                 |
| `code-snippet-apple-terminal-solid-colors`   | Deep purple bg, white text               |

#### Code Animations (9)

The richer, motion-first counterpart to the static `code-snippet-*` window themes above: each is a self-contained 1920×1080 block (~5–8s) with a paused, deterministic GSAP timeline that _animates_ code — typing, diffing, morphing, spotlighting, or GPU hero reveals — rather than typing a fixed snippet inside editor/terminal chrome. **Reuse-first**: `npx hyperframes add <name>`, then customize the baked code/diff content in place; hand-author only when no block covers the motion you need.

**DOM / text reveal (6):**

| Name                  | Description                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `code-typing`         | Token-streamed typing reveal, caret tracks the frontier (no CSS animation) — live-coding on screen                         |
| `code-diff`           | An edit shown as a colored diff: removed lines collapse red, added expand green — before/after at line level               |
| `code-morph`          | One snippet transforms into another, tokens glide between positions (Shiki Magic Move) — a refactor / one state to another |
| `code-highlight`      | A highlight band sweeps a target line while surrounding context dims — spotlight one line                                  |
| `code-scroll`         | Camera scrolls a long file to center + spotlight a target line — walk through a real module                                |
| `code-snippet-flight` | Discrete snippets fly in from the side and assemble into a stacked program (block-level FLIP)                              |

**GPU / WebGL hero reveals (3):** heavier, for a title-card / hero code moment.

| Name                     | Description                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `code-3d-extrude`        | Syntax-highlighted code on a lit beveled 3D slab that rotates through real space and settles (true WebGL depth) |
| `code-shader-dissolve`   | Code resolves out of seeded noise with a chromatic dissolve front + edge glow, then holds crisp                 |
| `code-particle-assemble` | Thousands of GPU points fly to the exact glyph pixels and resolve into readable syntax-highlighted code         |

### Components

| Name                 | Description                                                                                               | Tags                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `grain-overlay`      | Animated film grain texture overlay                                                                       | texture, grain, overlay, film                    |
| `shimmer-sweep`      | CSS gradient light sweep for AI accents                                                                   | text, shimmer, highlight, effect                 |
| `morph-text`         | Gooey text morph cycling an editable word list (SVG threshold + GSAP blur)                                | text, text-effect, typography, morph, gooey      |
| `grid-pixelate-wipe` | Grid dissolve transition between scenes                                                                   | transition, wipe, grid, pixelate                 |
| `parallax-zoom`      | Center card scales up to fill the frame while siblings parallax outward (single `--pz-progress` 0→1)      | transition, zoom, parallax, grid, hero           |
| `parallax-unzoom`    | Reverse of `parallax-zoom` — focus card shrinks from full frame as siblings parallax in (`--pu-progress`) | transition, reveal, unzoom, parallax, grid, hero |
