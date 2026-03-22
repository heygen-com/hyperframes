# HyperFrames Core

> Create videos by writing HTML. The HTML is the source of truth - timing, layout, content. Scripts define how clips animate.

HyperFrames Core is the foundational library for video composition. It defines the data attributes and HTML structure that represent video timelines, with GSAP animations to bring clips to life.

Frame adapter direction:

- [`../FRAME.md`](../FRAME.md) - repository-level frame model and deterministic renderer direction
- [`adapters/README.md`](adapters/README.md) - adapter contract and contribution guide

## Philosophy

```
HTML = Scene description (content, timing, layout)
CSS  = Styling
JS   = GSAP animations (motion)
```

Every element in the video timeline is represented as an HTML element with data attributes that define its position in time.

---

## Documentation

### Schema

The specification for valid HyperFrames HTML:

- **[schema.md](docs/schema.md)** - Element types, data attributes, HTML patterns

### Guides

For AI agents and developers working with HyperFrames:

| Document                                                  | Description                            |
| --------------------------------------------------------- | -------------------------------------- |
| [Cheat Sheet](docs/guides/cheat-sheet.md)                 | Quick reference for common actions     |
| [Position Guide](docs/guides/position.md)                 | Natural language → position mappings   |
| [Text Style Guide](docs/guides/text-style.md)             | Natural language → text style mappings |
| [Motion Design Guide](docs/guides/motion-design/guide.md) | Creating and editing motion designs    |
| [Caption Guide](docs/guides/motion-design/captions.md)    | Adding captions to videos              |

---

## Quick Start

### Using the Editor (Recommended)

```bash
pnpm install
pnpm dev
```

This starts the studio dev server.

### Writing Compositions Manually

```html
<!DOCTYPE html>
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
      }
      #stage {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="stage">
      <video id="el-1" data-start="0" data-end="10" src="video.mp4" muted playsinline></video>
      <div id="el-2" data-start="2" data-end="6" data-type="text">
        <div>Hello World</div>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      // Add animations...
    </script>
  </body>
</html>
```

---

## Element Types

| Type        | HTML Tag                        | Purpose              |
| ----------- | ------------------------------- | -------------------- |
| video       | `<video>`                       | Video clips          |
| image       | `<img>`                         | Static images        |
| text        | `<div data-type="text">`        | Text overlays        |
| audio       | `<audio>`                       | Music, sound effects |
| composition | `<div data-type="composition">` | Motion designs       |

## Data Attributes

| Attribute    | Purpose                           | Required |
| ------------ | --------------------------------- | -------- |
| `data-start` | When element appears (seconds)    | Yes      |
| `data-end`   | When element disappears (seconds) | No       |
| `data-name`  | Display name in UI                | No       |
| `data-layer` | Z-index for stacking              | No       |

See [schema.md](docs/schema.md) for the complete reference.

---

**Remember:** HTML is the storyboard. CSS is the art direction. JS is just for motion.
