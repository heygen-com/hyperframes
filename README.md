<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo/light.svg">
    <img alt="HyperFrames" src="docs/logo/light.svg" width="300">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hyperframes"><img src="https://img.shields.io/npm/v/hyperframes.svg?style=flat" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/hyperframes"><img src="https://img.shields.io/npm/dm/hyperframes.svg?style=flat" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js"></a>
  <a href="https://discord.gg/EbK98HBPdk"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center"><b>Write HTML. Render video. Built for agents.</b></p>

<p align="center">
  <a href="https://hyperframes.heygen.com/quickstart">Quickstart</a> |
  <a href="https://hyperframes.heygen.com/showcase">Showcase</a> |
  <a href="https://www.hyperframes.dev/">Playground</a> |
  <a href="https://hyperframes.heygen.com/catalog/blocks/data-chart">Catalog</a> |
  <a href="https://hyperframes.heygen.com/introduction">Docs</a> |
  <a href="https://discord.gg/EbK98HBPdk">Discord</a>
</p>

<p align="center">
  <img src="docs/public/images/hyperframes-logo-motion-1280-trimmed.webp" alt="HyperFrames demo: HTML code on the left transforms into a rendered video on the right" width="800">
</p>

HyperFrames is an open-source framework for turning HTML, CSS, media, and seekable animations into deterministic MP4 videos. Use it locally with the CLI, from AI coding agents with skills, or as the rendering core behind hosted authoring workflows.

## Quick Start

### With an AI coding agent

Install the HyperFrames skills, then describe the video you want:

```bash
npx skills add heygen-com/hyperframes
```

> The picker opens with nothing pre-selected — the **Core Skills** group is all you need: the `/hyperframes` router installs each creation workflow on demand. Agents and non-interactive runs should use `npx hyperframes skills update` instead — it installs exactly the core set, whereas `skills add --all` installs every `SKILL.md` in the repo — the 20 published skills plus six repo-internal ones under `.claude/skills` / `.agents/skills`. For the full published set use `npx hyperframes skills`.
>
> `skills add` resolves the skills.sh registry blob, which can lag `main` by hours. `npx hyperframes skills update` installs from the current `main`, so reach for it when you need the newest copy of a skill.

Try a prompt like:

> Using `/hyperframes`, create a 10-second product intro with a fade-in title, a background video, and subtle background music.

The skills teach agents the HyperFrames production loop: plan the video, write valid HTML, wire seekable animations, add media, lint, preview, and render. They work with Claude Code, Cursor, Gemini CLI, Codex, and other coding agents that support skills.

## Skills

HyperFrames ships 20 skills agents load on demand. Read `/hyperframes` first — it's the router and capability map; it picks a workflow for any "make me a…" request — video, deck, or composition port — and points to the domain skills below.

Default to the **core set** — the router installs each creation workflow on demand. `npx hyperframes skills update` installs exactly that from anywhere; the interactive picker (`npx skills add heygen-com/hyperframes`) lists it as the "Core Skills" group, nothing pre-selected. The picker is interactive-only — a non-interactive or agent run without `--skill` installs all 20. Use `npx skills add heygen-com/hyperframes --all` to install all 20 deliberately (skips the picker), or `npx skills add heygen-com/hyperframes --skill <name>` for just one (bare name, no leading `/`).

Installs stay lean after that: `npx hyperframes init` keeps the **core set** fresh (the router, the `hyperframes-*` domain skills, and `media-use` — plus whatever is already installed; `/figma` stays on demand) and never expands a partial install; the creation workflows install **on demand** — the router runs `npx hyperframes skills update <workflow>` before entering one. Nothing re-pulls the full set behind your back.

### Upload to Codex

Build the upload-ready Codex plugin archive from the committed `HEAD` version of the manifest, brand assets, and skills:

```bash
bun run package:codex-plugin
```

This writes `dist/hyperframes-plugin.zip` with a `hyperframes/` root folder and fails if the archive exceeds Codex's 100 MB upload limit.

### Router

| Skill          | Use when                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/hyperframes` | **Read first** for any request to make / create / edit / animate / render a video, animation, or motion graphic. Capability map for the domain skills, the intent layer that confirms every creation brief up front, and intent router for the creation workflows below. |

### Creation workflows

| Skill                      | Use when                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/product-launch-video`    | Any **website** — marketing / launching / promoting a product (from its URL, a brief, or a script), or a site tour / showcase / social clip featuring the site's own visuals. Up to ~3 min (sweet spot 30-90s).              |
| `/faceless-explainer`      | **Explaining a topic / concept** from arbitrary text — no product, no URL, no website capture; every visual is LLM-invented (typography / abstract / diagram / data-viz).                                                    |
| `/pr-to-video`             | A **GitHub pull request** (PR URL, `owner/repo#N` ref, or "this PR") → changelog / feature-reveal / fix / refactor explainer, read via the `gh` CLI.                                                                         |
| `/embedded-captions`       | Adding **captions / subtitles** to an existing talking-head video (footage untouched) — verbatim rail, embedded climax behind the subject, or pure-cinematic embed.                                                          |
| `/talking-head-recut`      | Packaging an existing talking-head / interview / podcast video with **designed graphic overlays** — lower-thirds, data callouts, kinetic titles, pull-quotes, side panels, PiP.                                              |
| `/motion-graphics`         | A short, **unnarrated, design-led motion graphic** (~under 10s) — kinetic type, stat / chart hit, logo sting, lower-third, animated tweet / headline. MP4 or transparent overlay.                                            |
| `/music-to-video`          | A **music track** (audio file, video to pull audio from, or one generated from a mood brief) → a **beat-synced** video — lyric, slideshow, or kinetic promo; music drives pacing.                                            |
| `/slideshow`               | A **presentation / pitch deck / interactive deck** — discrete slides, fragment reveals, branching, hotspot navigation, presenter mode. Output is a navigable deck, not a rendered video.                                     |
| `/general-video`           | **Anything else** — longer or multi-scene pieces, brand / sizzle reel, title card, static loop, freeform composition. Input- and length-agnostic fallback, and the home of companion mode (co-create with the full toolbox). |
| `/remotion-to-hyperframes` | **Porting an existing Remotion** (React) composition's source to HyperFrames HTML. One-way migration, not creation.                                                                                                          |

### Domain skills (loaded on demand)

Atomic capabilities the creation workflows compose against — pull one when you need that specific layer.

| Skill                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/hyperframes-core`      | The composition contract — `data-*` timing attributes, `class="clip"`, tracks, sub-compositions, variables, framework-owned media playback, determinism rules.                                                                                                                                                                                                                                                                                                                       |
| `/hyperframes-animation` | All animation knowledge — atomic motion rules, scene blueprints, transitions, runtime adapters (GSAP / Lottie / Three.js / Anime.js / CSS / WAAPI / TypeGPU).                                                                                                                                                                                                                                                                                                                        |
| `/hyperframes-keyframes` | Seek-safe keyframe authoring across runtimes — GSAP timelines, CSS keyframes, Anime.js, WAAPI, FLIP, paths, masks, SVG morph/draw, 3D depth — plus `hyperframes keyframes` diagnostics for rendered motion.                                                                                                                                                                                                                                                                          |
| `/hyperframes-creative`  | Non-animation creative direction — `frame.md` / `design.md`, palettes, typography, narration, beat planning, audio-reactive visuals, composition patterns.                                                                                                                                                                                                                                                                                                                           |
| `/media-use`             | The media OS — resolve any media need (BGM, SFX, image, icon, logo, voice, color grade, LUT) into a frozen local file or paste-ready block + ledger record, generate via TTS/music/image models when the catalog misses, transcribe, caption, remove backgrounds, and reuse assets across projects. One shared audio engine + manifest tracking.                                                                                                                                     |
| `/hyperframes-cli`       | CLI dev loop — `init`, `lint`, `check`, `snapshot`, `preview`, `render`, `publish`, `doctor`, plus HeyGen-hosted cloud rendering (`cloud render`) and AWS Lambda rendering (`lambda deploy / render / progress`).                                                                                                                                                                                                                                                                    |
| `/hyperframes-audio`     | Mix the audio already placed in a composition — voiceover carve (dip a music bed only in the bands the voice occupies, static or dynamic, level match included), the effect chain (EQ, compressor, limiter, gate, saturation, delay, reverb, chorus, phaser, bitcrush), automation envelopes on volume or any effect parameter, and submix buses (`<hf-audio-group>`) carrying one chain, fader and automation clock for several tracks at once. Sourcing the audio is `/media-use`. |
| `/hyperframes-registry`  | Install and wire registry blocks and components into compositions via `hyperframes add`. Authoring a new block or component to contribute upstream.                                                                                                                                                                                                                                                                                                                                  |
| `/figma`                 | Import Figma assets, tokens, components, and storyboard sections → reconstructed motion (frames read as states, not slides) (REST/CLI) plus Motion animations (MCP) and shaders (MCP source / native export) into a composition.                                                                                                                                                                                                                                                     |

For visual design handoff workflows, see the [Claude Design guide](https://hyperframes.heygen.com/guides/claude-design) and [Open Design guide](https://hyperframes.heygen.com/guides/open-design).

### Manually with the CLI

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview      # preview in browser with live reload
npx hyperframes render       # render to MP4
```

**Requirements:** Node.js 22+, FFmpeg

## What You Can Build

Need ideas? Browse the [Showcase](https://hyperframes.heygen.com/showcase) for finished videos you can watch, read, run, and remix.

- Product launch videos and feature announcements
- PR walkthroughs with animated code diffs, narration, and captions
- Data visualizations, chart races, and map animations
- Social videos with kinetic captions, overlays, and music
- Docs-to-video, PDF-to-video, and site-tour explainers
- Reusable motion graphics for automated content pipelines

## Frame.md

**frame.md — your design system, ready for video.**

Every brand has a `design.md`. None of them were written for a camera. `frame.md` is the missing translation layer: it takes your web-context design spec and inverts it for the frame — the same tokens, the same rules, but rewritten so an AI agent can compose a promo video without guessing at scale or reaching for web chrome.

The output is a `DESIGN.md` superset your whole toolchain can read. Atoms stay sacred. Composition stays free. Numbers come from the script.

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/biennale-yellow"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/biennale-yellow.png" alt="Biennale Yellow" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/biennale-yellow">Biennale Yellow</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/blockframe"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/blockframe.png" alt="BlockFrame" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/blockframe">BlockFrame</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/blue-professional"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/blue-professional.png" alt="Blue Professional" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/blue-professional">Blue Professional</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/bold-poster"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/bold-poster.png" alt="Bold Poster" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/bold-poster">Bold Poster</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/broadside"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/broadside.png" alt="Broadside" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/broadside">Broadside</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/capsule"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/capsule.png" alt="Capsule" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/capsule">Capsule</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/cartesian"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/cartesian.png" alt="Cartesian" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/cartesian">Cartesian</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/cobalt-grid"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/cobalt-grid.png" alt="Cobalt Grid" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/cobalt-grid">Cobalt Grid</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/coral"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/coral.png" alt="Coral" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/coral">Coral</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/creative-mode"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/creative-mode.png" alt="Creative Mode" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/creative-mode">Creative Mode</a></b>
    </td>
  </tr>
</table>

Browse and remix them all at [hyperframes.dev/design](https://www.hyperframes.dev/design).

## How It Works

Define a video as HTML. Add data attributes for timing and tracks. Use GSAP, CSS, Lottie, Three.js, Anime.js, WAAPI, or your own frame adapter for seekable animation.

```html
<div id="stage" data-composition-id="launch" data-start="0" data-width="1920" data-height="1080">
  <video
    class="clip"
    data-start="0"
    data-duration="6"
    data-track-index="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>

  <h1 id="title" class="clip" data-start="1" data-duration="4" data-track-index="1">Launch day</h1>

  <audio
    data-start="0"
    data-duration="6"
    data-track-index="2"
    data-volume="0.5"
    src="music.wav"
  ></audio>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 1);
    window.__timelines = window.__timelines || {};
    window.__timelines.launch = tl;
  </script>
</div>
```

Preview instantly in the browser. Render locally or in Docker. The renderer seeks each frame in headless Chrome and encodes the result with FFmpeg, so the same input produces the same video.

## HyperFrames Stack

HyperFrames is the open-source rendering engine, plus a growing set of tools around HTML-native video creation.

| Piece                                           | Status              | What it does                                                                                      |
| ----------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| CLI                                             | Available           | Scaffold, preview, lint, inspect, and render local video projects                                 |
| Core / Engine / Producer                        | Available           | Parse compositions, drive headless Chrome, encode video, and mix audio                            |
| Catalog                                         | Available           | Reusable blocks and components for transitions, overlays, captions, charts, maps, and effects     |
| Agent skills                                    | Available           | Teach coding agents the video-production patterns that generic web docs miss                      |
| Studio                                          | Available, evolving | Browser surface for previewing and editing compositions                                           |
| AWS Lambda rendering                            | Available           | Deploy a distributed render stack and drive renders from your laptop or CI                        |
| [hyperframes.dev](https://www.hyperframes.dev/) | Available           | Community playground for previewing, iterating, sharing, and rendering HTML-native video projects |
| [frame.md](https://www.hyperframes.dev/design)  | Available           | Invert your design system for the camera — a DESIGN.md superset an agent can compose video from   |

## Catalog

Install ready-to-use blocks and components:

```bash
npx hyperframes add flash-through-white   # shader transition
npx hyperframes add instagram-follow      # social overlay
npx hyperframes add data-chart            # animated chart
```

Browse the catalog at [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart).

## Why HyperFrames?

- **HTML-native:** compositions are HTML files with data attributes. No React requirement, no proprietary timeline format.
- **Agent-friendly:** agents already write HTML, and the CLI is non-interactive by default.
- **Deterministic:** same input, same frames, same output. Built for CI, regression tests, and automated rendering.
- **No build step:** an `index.html` composition plays as-is and can be previewed directly in the browser.
- **Adapter-based animation:** bring GSAP, CSS animations, Lottie, Three.js, Anime.js, WAAPI, or a custom runtime.
- **Open source:** Apache 2.0 license, with no per-render fees or commercial-use thresholds.

## HyperFrames vs Remotion

HyperFrames is inspired by [Remotion](https://www.remotion.dev). Both tools render video with headless Chrome and FFmpeg. The main difference is the authoring model: Remotion's bet is React components; HyperFrames' bet is plain HTML that humans and agents can both write easily.

|                          | **HyperFrames**                       | **Remotion**                            |
| ------------------------ | ------------------------------------- | --------------------------------------- |
| Authoring                | HTML + CSS + seekable animation       | React components                        |
| Build step               | None; `index.html` plays as-is        | Bundler required                        |
| Agent handoff            | Plain HTML files                      | JSX / React project                     |
| Library-clock animations | Seekable, frame-accurate via adapters | Wall-clock animation patterns need care |
| Distributed rendering    | Local and AWS Lambda render paths     | Remotion Lambda, mature cloud renderer  |
| License                  | Apache 2.0                            | Source-available Remotion License       |

Read the full comparison in the [HyperFrames vs Remotion guide](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion).

## Documentation

Full documentation: [hyperframes.heygen.com/introduction](https://hyperframes.heygen.com/introduction)

- [Quickstart](https://hyperframes.heygen.com/quickstart)
- [Showcase](https://hyperframes.heygen.com/showcase)
- [Guides](https://hyperframes.heygen.com/guides/gsap-animation)
- [API Reference](https://hyperframes.heygen.com/packages/core)
- [Catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)
- [Examples](https://hyperframes.heygen.com/examples)
- [AWS Lambda rendering](https://hyperframes.heygen.com/deploy/aws-lambda)

## Packages

| Package                                                          | Description                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`hyperframes`](packages/cli)                                    | CLI for creating, previewing, linting, and rendering compositions |
| [`@hyperframes/core`](packages/core)                             | Types, parsers, generators, linter, runtime, and frame adapters   |
| [`@hyperframes/engine`](packages/engine)                         | Seekable page-to-video capture engine using Puppeteer and FFmpeg  |
| [`@hyperframes/producer`](packages/producer)                     | Full rendering pipeline for capture, encode, and audio mix        |
| [`@hyperframes/studio`](packages/studio)                         | Browser-based composition editor UI                               |
| [`@hyperframes/player`](packages/player)                         | Embeddable `<hyperframes-player>` web component                   |
| [`@hyperframes/shader-transitions`](packages/shader-transitions) | WebGL shader transitions for compositions                         |
| [`@hyperframes/aws-lambda`](packages/aws-lambda)                 | AWS Lambda SDK and deployment surface for distributed renders     |

## Community

HyperFrames is used in production at [HeyGen](https://www.heygen.com), with community examples from teams like [tldraw](https://tldraw.com), [TanStack](https://tanstack.com), and others in [ADOPTERS.md](ADOPTERS.md). Open a PR if your team is using HyperFrames.

- Questions and ideas: [Discord](https://discord.gg/EbK98HBPdk)
- Bugs and feature requests: [GitHub Issues](https://github.com/heygen-com/hyperframes/issues)
- User research: [Book a casual 30-minute conversation with the HyperFrames team](https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ2cSpKoDgmcmRrgekrnrgqmvPT8W6F2Zg6e7MY7IJqaZKwpn_I0NdTHkN390iguMepE_NVg8ezb?gv=true) — no preparation or sales pitch
- Security reports: [SECURITY.md](SECURITY.md)
- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md)

## Development Note

The repo uses [Git LFS](https://git-lfs.com) for golden regression-test baselines under `packages/producer/tests/**/output.mp4` (about 240 MB of `.mp4` files). If you're cloning the full repo for development, install Git LFS first:

```bash
# macOS
brew install git-lfs

# Ubuntu / Debian
sudo apt install git-lfs

# Windows
winget install GitHub.GitLFS

# Then, once per machine
git lfs install
```

If you only need source files, you can skip LFS content:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/heygen-com/hyperframes.git
```

## License

[Apache 2.0](LICENSE)


## 🌐 Web Resources & Interactive Index
- [CATEGORY SOLITAIRE27](https://frskillcrafts.pages.dev/category-solitaire27.html)
- [PRETTY SHEEP RUN](https://studyquests.github.io/pretty-sheep-run.html)
- [FIND RESTORE HIDDEN PUZZLE](https://studyquests.github.io/find-restore-hidden-puzzle.html)
- [HUNGRY NOOB CAFE SIMULATOR](https://quizverses.github.io/hungry-noob-cafe-simulator.html)
- [CRAZY TUNNEL](https://studyquests.github.io/crazy-tunnel.html)
- [PIXEL BLAST](https://studyplayings.web.app/pixel-blast.html)
- [MERGE CUBE CHALLENGE](https://quizverses.pages.dev/merge-cube-challenge.html)
- [JUMPER](https://themindzone.pages.dev/jumper.html)
- [TAPE SORT 3D](https://thequizzone.pages.dev/tape-sort-3d.html)
- [CHAIN PUZZLE](https://learnquester.github.io/chain-puzzle.html)
- [WORDS WITH PROF WISELY](https://studyquests.pages.dev/words-with-prof-wisely.html)
- [EASY OBBY JUMP AND RUN CHALLENGE ONLINE](https://quizverses.github.io/easy-obby-jump-and-run-challenge-online.html)
- [WHATS GRANDMA HIDING](https://studyplayings.web.app/whats-grandma-hiding.html)
- [CATEGORY BOARDGAMES](https://studyquests.pages.dev/category-boardgames.html)
- [CATEGORY INCREMENTAL388](https://studyquesthub.web.app/category-incremental388.html)
- [MY TINY LAND](https://iskillquest.pages.dev/my-tiny-land.html)
- [STICKMAN GUYS DEFENSE](https://thequizzone.pages.dev/stickman-guys-defense.html)
- [BASKETBALL STARS 2026](https://theskillquest.pages.dev/basketball-stars-2026.html)
- [CASTLE CRAFT](https://iskillquest.pages.dev/castle-craft.html)
- [CATEGORY SNAKE GAMES](https://quizverses.github.io/category-snake-games.html)
- [SUPER ONION BOY 2](https://thequizzone.pages.dev/super-onion-boy-2.html)
- [INDEX19](https://quizverses.github.io/index19.html)
- [NUTS STACK SORT NUTS BOLTS](https://studyplayings.web.app/nuts-stack-sort-nuts-bolts.html)
- [EGG DASH](https://studyquesthub.web.app/egg-dash.html)
- [HAPPY FARM THE CROP](https://quizverses.pages.dev/happy-farm-the-crop.html)
- [CONTACT](https://studyplayings.web.app/contact.html)
- [ZOMBIE EEASTER BUNNIES](https://iskillquest.pages.dev/zombie-eeaster-bunnies.html)
- [BLOCK PIXELS](https://thequizzone.pages.dev/block-pixels.html)
- [CATEGORY STRATEGY 2](https://quizverses.github.io/category-strategy-2.html)
- [CUBICA](https://studyquests.github.io/cubica.html)
- [ITALIAN BRAINROT QUIZ](https://themindzone.pages.dev/italian-brainrot-quiz.html)
- [MR LONG HAND](https://thequizzone.pages.dev/mr-long-hand.html)
- [CATEGORY CARTOON76](https://quizverses.github.io/category-cartoon76.html)
- [SORTSTORE](https://studyplaying.github.io/sortstore.html)
- [CATEGORY IDLE](https://quizverses.github.io/category-idle.html)
- [CATEGORY AGILITY](https://iskillquest.pages.dev/category-agility.html)
- [MERGE GUN FPS SHOOTING ZOMBIE](https://thequizzone.pages.dev/merge-gun-fps-shooting-zombie.html)
- [CATEGORY PROXIES](https://thequizzone.pages.dev/category-proxies.html)
- [SCOOP TOWER](https://studyplayings.web.app/scoop-tower.html)
- [OBBY ESCAPE PRISON RAT DANCE](https://studyplayings.web.app/obby-escape-prison-rat-dance.html)
- [GARDEN BLOCK PUZZLE](https://quizverses.pages.dev/garden-block-puzzle.html)
- [MERGE HERO SURVIVAL TOWER DEFENSE](https://themindzone.pages.dev/merge-hero-survival-tower-defense.html)
- [BARBIECORE AESTHETICS](https://theskillquest.pages.dev/barbiecore-aesthetics.html)
- [BRAINROT MEMORY](https://thequizzone.pages.dev/brainrot-memory.html)
- [INDEX13](https://studyplayings.web.app/index13.html)
- [DREAM PET HOTEL](https://theskillquest.pages.dev/dream-pet-hotel.html)
- [SHIP CONTROL 3D](https://themindzone.pages.dev/ship-control-3d.html)
- [BOLTS AND NUTS SORTING](https://studyplaying.github.io/bolts-and-nuts-sorting.html)
- [ASTRO KITTY RUSH](https://studyquests.github.io/astro-kitty-rush.html)
- [FNF 2 PLAYER](https://theskillquest.pages.dev/fnf-2-player.html)
- [HIDE AND ESCAPE FROM ANGRY TEACHER](https://theskillquest.pages.dev/hide-and-escape-from-angry-teacher.html)
- [SITEMAP](https://brainquests.pages.dev/sitemap.html)
- [CATEGORY SPOT THE DIFFERENCE6](https://iskillquest.pages.dev/category-spot-the-difference6.html)
- [CATEGORY PUZZLE 2](https://thequizzone.pages.dev/category-puzzle-2.html)
- [INDEX7](https://studyplayings.web.app/index7.html)
- [SNAKEMAXX](https://studyplaying.github.io/snakemaxx.html)
- [CATEGORY QUIZ](https://themindzone.pages.dev/category-quiz.html)
- [FORMULA TRAFFIC RACER](https://thequizzone.pages.dev/formula-traffic-racer.html)
- [SITEMAP](https://brainquests.onrender.com/sitemap.html)
- [LOL SURPRISE OMG BB DRIVER](https://thequizzone.pages.dev/lol-surprise-omg-bb-driver.html)
- [CATEGORY GITHUB IO](https://studyplayings.pages.dev/category-github-io.html)
- [GOLF MINI](https://thequizzone.pages.dev/golf-mini.html)
- [PEW PEW DOSE](https://thequizzone.pages.dev/pew-pew-dose.html)
- [WHATS IN MY BAG](https://theskillquest.pages.dev/whats-in-my-bag.html)
- [TERMS](https://brainquests.netlify.app/terms.html)
- [SUM SHUFFLE](https://thequizzone.pages.dev/sum-shuffle.html)
- [CATEGORY IDLE448](https://thequizzone.pages.dev/category-idle448.html)
- [HEXA SORT TRICK OR TREAT](https://thequizzone.pages.dev/hexa-sort-trick-or-treat.html)
- [MAGIC TOWERS SOLITAIRE](https://thelearnquesters.pages.dev/magic-towers-solitaire.html)
- [OBBY DRAW TO ESCAPE](https://quizverses.pages.dev/obby-draw-to-escape.html)
- [CATEGORY TOWER DEFENSE 3](https://quizverses.github.io/category-tower-defense-3.html)
- [CATEGORY HERO72](https://iskillquest.pages.dev/category-hero72.html)
- [GET READY WITH ME CONCERT DAY](https://studyquests.github.io/get-ready-with-me-concert-day.html)
- [SAVE LITTLE RED HOOD](https://themindzone.pages.dev/save-little-red-hood.html)
- [IDLE PET](https://thelearnquesters.pages.dev/idle-pet.html)
- [RADICAL RAPPELLING](https://thelearnquesters.pages.dev/radical-rappelling.html)
- [VAMPIRIC ROULETTE ROMANCE](https://thelearnquesters.pages.dev/vampiric-roulette-romance.html)
- [GEOMETRY STARS](https://themindzone.pages.dev/geometry-stars.html)
- [PUZZLE SOLITAIRE PICTURE MATCH](https://thelearnquesters.pages.dev/puzzle-solitaire-picture-match.html)
- [ANTISTRESS SIMULATOR OF SEQUINS DIY](https://thelearnquesters.pages.dev/antistress-simulator-of-sequins-diy.html)
- [LAST STANDING](https://thequizzone.pages.dev/last-standing.html)
- [STICKMAN DISMOUNT SIMULATOR](https://studyquests.github.io/stickman-dismount-simulator.html)
- [DOMINO WORLD](https://thelearnquesters.pages.dev/domino-world.html)
- [CATEGORY UNBLOCKEDGAMES](https://studyquests.github.io/category-unblockedgames.html)
- [BUNNYHOP AND SURF MAPS](https://studyquesthub.web.app/bunnyhop-and-surf-maps.html)
- [DRAGON EGG](https://theskillquest.pages.dev/dragon-egg.html)
- [TEARDOWN DESTRUCTION SANDBOX](https://theskillquest.pages.dev/teardown-destruction-sandbox.html)
- [ASMR BEAUTY HOMELESS](https://studyquests.github.io/asmr-beauty-homeless.html)
- [UNPUZZLE MASTER](https://themindzone.pages.dev/unpuzzle-master.html)
- [WITCH FAIRY BFF](https://theskillquest.pages.dev/witch-fairy-bff.html)
- [JUMP MAN](https://studyplaying.github.io/jump-man.html)
- [SPOT DIFFERENCES BIRD ADVENTURE](https://thequizzone.pages.dev/spot-differences-bird-adventure.html)
- [CATEGORY OBSTACLE299](https://quizverses.github.io/category-obstacle299.html)
- [PANDA RUNNING](https://thelearnquesters.pages.dev/panda-running.html)
- [CATEGORY BATTLE 2](https://themindzone.pages.dev/category-battle-2.html)
- [TANK SNIPER 3D](https://thequizzone.pages.dev/tank-sniper-3d.html)
- [CATEGORY WEBGAME](https://iskillquest.pages.dev/category-webgame.html)
- [INDEX8](https://studyquests.pages.dev/index8.html)
- [CATEGORY TOWER DEFENSE118](https://quizverses.github.io/category-tower-defense118.html)
- [OBBY RAINBOW TOWER](https://studyplaying.github.io/obby-rainbow-tower.html)
- [CATEGORY LOGIC536](https://iskillquest.pages.dev/category-logic536.html)
- [HIDDEN OBJECT FARM ADVENTURE](https://studyquests.github.io/hidden-object-farm-adventure.html)
- [TAILOR STYLIST FASHION DIARY](https://thelearnquesters.pages.dev/tailor-stylist-fashion-diary.html)
- [FIDGET TOYS POP IT](https://studyplayings.web.app/fidget-toys-pop-it.html)
- [FASHION MAKEOVER DASH](https://quizverses.github.io/fashion-makeover-dash.html)
- [ZENITH RUSH](https://themindzone.pages.dev/zenith-rush.html)
- [COLOR DOTS CHALLENGE](https://studyplayings.pages.dev/color-dots-challenge.html)
- [ROBLOX HALLOWEEN COSTUME PARTY](https://studyplaying.github.io/roblox-halloween-costume-party.html)
- [TWO STUNT RACERS](https://quizverses.pages.dev/two-stunt-racers.html)
- [CATEGORY AGILITY](https://studyquests.pages.dev/category-agility.html)
- [LINK COLOR PICTURES](https://iskillquest.pages.dev/link-color-pictures.html)
- [MAHJONG STACK](https://quizverses.github.io/mahjong-stack.html)
- [MERGE PLANETS](https://studyplayings.pages.dev/merge-planets.html)
- [CATEGORY SURVIVAL365](https://quizverses.github.io/category-survival365.html)
- [TAIL GUN CHARLIE](https://studyplayings.web.app/tail-gun-charlie.html)
- [INDEX4](https://themindzone.pages.dev/index4.html)
- [DOWNHILL CAR RIDE CRASH TEST](https://studyquests.github.io/downhill-car-ride-crash-test.html)
- [HIDDEN OBJECT MY HOTEL](https://studyplayings.web.app/hidden-object-my-hotel.html)
- [CANNON SHOOTER](https://theskillquest.pages.dev/cannon-shooter.html)
- [CATEGORY RUNNING](https://thequizzone.pages.dev/category-running.html)
- [CATEGORY SANDBOX40](https://iskillquest.pages.dev/category-sandbox40.html)
- [FLOW BLOCK](https://studyplaying.github.io/flow-block.html)
- [CATEGORY MAHJONG](https://iskillquest.pages.dev/category-mahjong.html)
- [SNIPER VS SNIPER](https://studyplaying.github.io/sniper-vs-sniper.html)
- [MOTO ATTACK](https://themindzone.pages.dev/moto-attack.html)
- [PEG SOLITAIRE](https://studyplaying.github.io/peg-solitaire.html)
- [STRONGBLADE](https://quizverses.github.io/strongblade.html)
- [VSCO GIRL AESTHETIC](https://theskillquest.pages.dev/vsco-girl-aesthetic.html)
- [CATEGORY BOOKMARKLETS](https://thelearnquester.web.app/category-bookmarklets.html)
- [PENTAWORD](https://themindzone.pages.dev/pentaword.html)
