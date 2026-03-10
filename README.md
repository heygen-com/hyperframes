# Hyperframes

**Write HTML. Render video. Built for agents.**

Hyperframes is an open-source video rendering framework that lets you create, preview, and render HTML-based video compositions — with first-class support for AI agents via MCP.

## Why Hyperframes?

- **HTML-native** — AI agents already speak HTML. No React required.
- **Frame Adapter pattern** — bring your own animation runtime (GSAP, Lottie, CSS, Three.js).
- **Deterministic rendering** — same input = identical output. Built for automated pipelines.
- **AI-first design** — not a bolted-on afterthought.

## Quick Start

```bash
npx create-hyperframe my-video
cd my-video
npx hyperframes dev      # preview in browser
npx hyperframes render   # render to MP4
```

## How It Works

Define your video as HTML with data attributes:

```html
<div id="stage" data-composition-id="my-video"
     data-start="0" data-width="1920" data-height="1080">
  <video id="clip-1" data-start="0" data-duration="5"
         data-track="0" src="intro.mp4" muted playsinline></video>
  <img id="overlay" data-start="2" data-duration="3"
       data-track="1" src="logo.png" />
  <audio id="bg-music" data-start="0" data-duration="9"
         data-track="2" data-volume="0.5" src="music.wav"></audio>
</div>
```

Preview instantly in the browser. Render to MP4 locally. Let AI agents compose videos using tools they already understand.

## Packages

| Package | Description |
|---------|-------------|
| `@hyperframes/core` | Types, schema, parsers, compiler, runtime, frame adapters |
| `@hyperframes/cli` | `npx hyperframes dev \| render \| validate \| init` |
| `@hyperframes/producer` | Local rendering engine (Node.js + Puppeteer + FFmpeg) |
| `@hyperframes/studio` | Browser-based preview/editor |
| `@hyperframes/mcp` | MCP server for AI agent integration |
| `create-hyperframe` | Project scaffolding (`npx create-hyperframe`) |

## AI Agent Integration

Hyperframes ships with an MCP server that gives AI agents direct access to video composition tools:

```bash
npx @hyperframes/mcp
```

Works with Claude Code, Cursor, Windsurf, and any MCP-compatible client. Agents can create projects, add elements, set animations, preview frames, and render videos — all through natural language.

## Comparison with Remotion

| | Remotion | Hyperframes |
|---|---|---|
| **Composition model** | React components | HTML + data attributes |
| **Animation runtime** | React only | Any (GSAP, Lottie, CSS, Three.js) |
| **AI story** | Added retroactively | AI-native from day 1 |
| **License** | Custom source-available | MIT |
| **Rendering** | Puppeteer + FFmpeg + Lambda | Puppeteer + FFmpeg (Docker-optional) |

## Requirements

- Node.js 22+
- FFmpeg (system install)
- Chromium (auto-downloaded by Puppeteer)

## Documentation

Visit [hyperframes.dev](https://hyperframes.dev) for full documentation, guides, and API reference.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

[MIT](LICENSE)
