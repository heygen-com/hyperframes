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
</p>

<p align="center"><b>Write HTML. Render video. Built for agents.</b></p>

<p align="center">
  <img src="https://static.heygen.ai/hyperframes-oss/docs/images/readme-demo.gif" alt="HyperFrames demo — HTML code on the left transforms into a rendered video on the right" width="800">
</p>

Hyperframes is an open-source video rendering framework that lets you create, preview, and render HTML-based video compositions — with first-class support for AI agents.

## Quick Start

### Option 1: With an AI coding agent (recommended)

Install the HyperFrames skills, then describe the video you want:

```bash
npx skills add heygen-com/hyperframes
```

This teaches your agent (Claude Code, Cursor, Gemini CLI, Codex) how to write correct compositions and GSAP animations. In Claude Code, the skills register as slash commands — invoke `/hyperframes` to author compositions, `/hyperframes-cli` for CLI commands, and `/gsap` for animation help.

#### Try it: example prompts

Copy any of these into your agent to get started. The `/hyperframes` prefix loads the skill context explicitly so you get correct output the first time.

**Cold start — describe what you want:**

> Using `/hyperframes`, create a 10-second product intro with a fade-in title, a background video, and background music.

**Warm start — turn existing context into a video:**

> Take a look at this GitHub repo https://github.com/heygen-com/hyperframes and explain its uses and architecture to me using `/hyperframes`.

> Summarize the attached PDF into a 45-second pitch video using `/hyperframes`.

> Turn this CSV into an animated bar chart race using `/hyperframes`.

**Format-specific:**

> Make a 9:16 TikTok-style hook video about [topic] using `/hyperframes`, with bouncy captions synced to a TTS narration.

**Iterate — talk to the agent like a video editor:**

> Make the title 2x bigger, swap to dark mode, and add a fade-out at the end.

> Add a lower third at 0:03 with my name and title.

The agent handles scaffolding, animation, and rendering. See the [prompting guide](https://hyperframes.heygen.com/guides/prompting) for more patterns.

### Option 2: Start a project manually

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview      # preview in browser (live reload)
npx hyperframes render       # render to MP4
```

`hyperframes init` installs skills automatically, so you can hand off to your AI agent at any point.

**Requirements:** Node.js >= 22, FFmpeg

## Why Hyperframes?

- **HTML-native** — compositions are HTML files with data attributes. No React, no proprietary DSL.
- **AI-first** — agents already speak HTML. The CLI is non-interactive by default, designed for agent-driven workflows.
- **Deterministic rendering** — same input = identical output. Built for automated pipelines.
- **Frame Adapter pattern** — bring your own animation runtime (GSAP, Lottie, CSS, Three.js).

## How It Works

Define your video as HTML with data attributes:

```html
<div id="stage" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080">
  <video
    id="clip-1"
    data-start="0"
    data-duration="5"
    data-track-index="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>
  <img
    id="overlay"
    class="clip"
    data-start="2"
    data-duration="3"
    data-track-index="1"
    src="logo.png"
  />
  <audio
    id="bg-music"
    data-start="0"
    data-duration="9"
    data-track-index="2"
    data-volume="0.5"
    src="music.wav"
  ></audio>
</div>
```

Preview instantly in the browser. Render to MP4 locally or in Docker.

## Catalog

50+ ready-to-use blocks and components — social overlays, shader transitions, data visualizations, and cinematic effects:

```bash
npx hyperframes add flash-through-white   # shader transition
npx hyperframes add instagram-follow      # social overlay
npx hyperframes add data-chart            # animated chart
```

Browse the full catalog at **[hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)**.

## Documentation

Full documentation at **[hyperframes.heygen.com/introduction](https://hyperframes.heygen.com/introduction)** — [Quickstart](https://hyperframes.heygen.com/quickstart) | [Guides](https://hyperframes.heygen.com/guides/gsap-animation) | [API Reference](https://hyperframes.heygen.com/packages/core) | [Catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)

## Packages

| Package                                                          | Description                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| [`hyperframes`](packages/cli)                                    | CLI — create, preview, lint, and render compositions        |
| [`@hyperframes/core`](packages/core)                             | Types, parsers, generators, linter, runtime, frame adapters |
| [`@hyperframes/engine`](packages/engine)                         | Seekable page-to-video capture engine (Puppeteer + FFmpeg)  |
| [`@hyperframes/producer`](packages/producer)                     | Full rendering pipeline (capture + encode + audio mix)      |
| [`@hyperframes/studio`](packages/studio)                         | Browser-based composition editor UI                         |
| [`@hyperframes/player`](packages/player)                         | Embeddable `<hyperframes-player>` web component             |
| [`@hyperframes/shader-transitions`](packages/shader-transitions) | WebGL shader transitions for compositions                   |

## Skills

HyperFrames ships [skills](https://github.com/vercel-labs/skills) that teach AI agents framework-specific patterns that generic docs don't cover.

```bash
npx skills add heygen-com/hyperframes
```

| Skill                    | What it teaches                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `hyperframes`            | HTML composition authoring, captions, TTS, audio-reactive animation, transitions             |
| `hyperframes-cli`        | CLI commands: init, lint, preview, render, transcribe, tts, doctor                           |
| `hyperframes-registry`   | Block and component installation via `hyperframes add`                                       |
| `website-to-hyperframes` | Capture a URL and turn it into a video — full website-to-video pipeline                      |
| `gsap`                   | GSAP animation API, timelines, easing, ScrollTrigger, plugins, React/Vue/Svelte, performance |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Apache 2.0](LICENSE)
