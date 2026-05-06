# @hyperframes/shader-transitions

WebGL shader transitions for HyperFrames compositions. Renders GPU-accelerated scene-to-scene transitions using fragment shaders, driven by GSAP timelines.

## Install

```bash
npm install @hyperframes/shader-transitions
```

Or load directly via CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
```

## Usage

```typescript
import { init } from "@hyperframes/shader-transitions";

const tl = init({
  bgColor: "#0a0a0a",
  accentColor: "#ff6b2b",
  scenes: ["scene-1", "scene-2", "scene-3"],
  transitions: [
    { time: 3, shader: "domain-warp", duration: 0.8 },
    { time: 8, shader: "light-leak", duration: 0.7 },
  ],
});
```

The `init()` function pre-captures animated scene samples for every transition, composites cached samples with the selected shader during playback, and returns a GSAP timeline. Scene animations keep advancing through shader transitions without running DOM captures in the playback loop. If WebGL is unavailable, it falls back to normal timeline playback without shader compositing.

### With an existing timeline

Pass your own GSAP timeline to layer transitions onto it:

```typescript
const tl = gsap.timeline({ paused: true });
// ... add your scene animations ...

init({
  bgColor: "#000",
  scenes: ["intro", "demo", "outro"],
  transitions: [
    { time: 5, shader: "cinematic-zoom" },
    { time: 12, shader: "glitch", duration: 0.5 },
  ],
  timeline: tl,
});
```

## Available shaders

| Shader                | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `domain-warp`         | Organic noise-based warp with glowing edge           |
| `ridged-burn`         | Ridged noise burn with sparks and heat glow          |
| `whip-pan`            | Horizontal motion blur simulating a fast camera pan  |
| `sdf-iris`            | Circular iris wipe with glowing ring edge            |
| `ripple-waves`        | Concentric ripple distortion radiating from center   |
| `gravitational-lens`  | Warping gravity well with chromatic aberration       |
| `cinematic-zoom`      | Radial zoom blur with chromatic fringing             |
| `chromatic-split`     | RGB channel separation expanding from center         |
| `glitch`              | Digital glitch with block displacement and scanlines |
| `swirl-vortex`        | Spiral rotation with noise-based warping             |
| `thermal-distortion`  | Heat shimmer rising from the bottom                  |
| `flash-through-white` | Flash to white then reveal the next scene            |
| `cross-warp-morph`    | Noise-driven morph blending both scenes              |
| `light-leak`          | Warm cinematic light leak with lens flare            |

## API

### `init(config): GsapTimeline`

| Option              | Type                 | Required | Description                                                                                                                                                   |
| ------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bgColor`           | `string`             | yes      | Fallback background color (hex) for scene capture. Use the composition's body/canvas background — individual scenes set their own `background-color` via CSS. |
| `accentColor`       | `string`             | no       | Accent color (hex) for shader glow effects                                                                                                                    |
| `scenes`            | `string[]`           | yes      | Element IDs of each scene, in order                                                                                                                           |
| `transitions`       | `TransitionConfig[]` | yes      | Transition definitions (see below)                                                                                                                            |
| `timeline`          | `GsapTimeline`       | no       | Existing timeline to attach transitions to                                                                                                                    |
| `compositionId`     | `string`             | no       | Override the `data-composition-id` for timeline registration                                                                                                  |
| `previewCaptureFps` | `number`             | no       | Browser preview pre-capture samples per transition second. Defaults to `30`; rendering uses deterministic per-frame compositing instead.                      |

Browser preview capture scale and transition-prep loading UI ownership are controlled by `<hyperframes-player>` (`shader-capture-scale`, `shader-loading`) instead of composition code. Direct non-player previews keep the built-in full-fidelity loading fallback.

Browser previews store captured transition snapshots in IndexedDB using a key derived from composition ID, scene DOM/style signatures, transition timing, capture FPS, scale, and dimensions. On refresh, matching snapshots are reloaded into WebGL textures instead of being captured again. Runtime scene or stylesheet edits mark only adjacent transition caches dirty; recapture is deferred until playback so editing stays responsive.

### `TransitionConfig`

| Option     | Type         | Default          | Description                      |
| ---------- | ------------ | ---------------- | -------------------------------- |
| `time`     | `number`     | —                | Start time in seconds            |
| `shader`   | `ShaderName` | —                | Shader name from the table above |
| `duration` | `number`     | `0.7`            | Transition duration in seconds   |
| `ease`     | `string`     | `"power2.inOut"` | GSAP easing function             |

### `SHADER_NAMES`

Array of all available shader name strings, useful for validation or building UIs.

```typescript
import { SHADER_NAMES } from "@hyperframes/shader-transitions";
// ["domain-warp", "ridged-burn", "whip-pan", ...]
```

## Distribution

| Format | File                   | Use case                                    |
| ------ | ---------------------- | ------------------------------------------- |
| ESM    | `dist/index.js`        | Bundlers (Vite, webpack, etc.)              |
| CJS    | `dist/index.cjs`       | Node.js / require()                         |
| IIFE   | `dist/index.global.js` | `<script>` tag, CDN (global: `HyperShader`) |

All formats include source maps. TypeScript definitions included.

## Related packages

- [`@hyperframes/core`](../core) -- types, parsers, runtime
- [`@hyperframes/engine`](../engine) -- rendering engine
- [`hyperframes`](../cli) -- CLI

## License

MIT
