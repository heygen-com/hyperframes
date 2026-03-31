# Hyperframes

[![npm version](https://img.shields.io/npm/v/hyperframes.svg?style=flat)](https://www.npmjs.com/package/hyperframes)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

**Write HTML. Render video. Built for agents.**

Hyperframes is an open-source video rendering framework that lets you create, preview, and render HTML-based video compositions — with first-class support for AI agents via MCP.

## Why Hyperframes?

- **HTML-native** — AI agents already speak HTML. No React required.
- **Frame Adapter pattern** — bring your own animation runtime (GSAP, Lottie, CSS, Three.js).
- **Deterministic rendering** — same input = identical output. Built for automated pipelines.
- **AI-first design** — not a bolted-on afterthought.

## Quick Start

```bash
npx hyperframes init my-video
cd my-video
```

Then open the project with your AI coding agent (Claude Code, Cursor, etc.) — it has HyperFrames skills installed and knows how to create and edit compositions.

```bash
npx hyperframes preview      # preview in browser (live reload)
npx hyperframes render   # render to MP4
```

**Requirements:** Node.js >= 22, FFmpeg

## Documentation

Full documentation at **[hyperframes.heygen.com](https://hyperframes.heygen.com)** — start with the [Quickstart](https://hyperframes.heygen.com/quickstart), then explore guides, concepts, API reference, and package docs.

## How It Works

Define your video as HTML with data attributes:

```html
<div id="stage" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080">
  <video
    id="clip-1"
    data-start="0"
    data-duration="5"
    data-track="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>
  <img id="overlay" data-start="2" data-duration="3" data-track="1" src="logo.png" />
  <audio
    id="bg-music"
    data-start="0"
    data-duration="9"
    data-track="2"
    data-volume="0.5"
    src="music.wav"
  ></audio>
</div>
```

Preview instantly in the browser. Render to MP4 locally. Let AI agents compose videos using tools they already understand.

## Packages

| Package                                      | Description                                                 |
| -------------------------------------------- | ----------------------------------------------------------- |
| [`hyperframes`](packages/cli)                | CLI — create, preview, lint, and render compositions        |
| [`@hyperframes/core`](packages/core)         | Types, parsers, generators, linter, runtime, frame adapters |
| [`@hyperframes/engine`](packages/engine)     | Seekable page-to-video capture engine (Puppeteer + FFmpeg)  |
| [`@hyperframes/producer`](packages/producer) | Full rendering pipeline (capture + encode + audio mix)      |
| [`@hyperframes/studio`](packages/studio)     | Browser-based composition editor UI                         |

## AI Agent Skills

HyperFrames ships skills that teach AI coding agents (Claude Code, Gemini CLI, Codex, Cursor) how to write correct compositions and GSAP animations. **Use these instead of writing from scratch — they encode framework-specific patterns that generic docs don't cover.**

### Install via CLI (recommended)

```bash
# Install all skills (HyperFrames + GSAP) — runs automatically during `hyperframes init`
npx hyperframes skills

# Or install to a specific agent
npx hyperframes skills --claude
npx hyperframes skills --cursor
```

### Or via `npx skills add`

```bash
# HyperFrames skills (hyperframes-compose, hyperframes-captions)
npx skills add heygen-com/hyperframes

# GSAP skills (gsap-core, gsap-timeline, gsap-scrolltrigger, gsap-plugins, gsap-performance, gsap-utils, gsap-react, gsap-frameworks)
npx skills add greensock/gsap-skills
```

### Installed Skills

| Source                                               | Skills                                                                                                                                | What they teach                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **HyperFrames**                                      | `hyperframes-compose`, `hyperframes-captions`                                                                                         | HTML composition structure, `class="clip"` rules, `data-*` attributes, timeline registration, rendering constraints |
| **[GSAP](https://github.com/greensock/gsap-skills)** | `gsap-core`, `gsap-timeline`, `gsap-performance`, `gsap-plugins`, `gsap-scrolltrigger`, `gsap-utils`, `gsap-react`, `gsap-frameworks` | Core API, timeline sequencing, ScrollTrigger, plugin usage, performance best practices                              |

In Claude Code, invoke with `/hyperframes-compose`, `/hyperframes-captions`, `/gsap-core`, etc.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

See [LICENSE](LICENSE) for details.
