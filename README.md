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

<!-- TODO: Add packages table, AI agent integration section, comparison table, requirements, and docs link once packages are ported -->

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

[MIT](LICENSE)
