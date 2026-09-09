# @hyperframes/core

Types, parsers, generators, compiler, linter, runtime, and frame adapters for the Hyperframes video framework.

## Install

```bash
npm install @hyperframes/core
```

> Most users don't need to install core directly — the [CLI](../cli), [producer](../producer), and [studio](../studio) packages depend on it internally.

## What's inside

| Module             | Description                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **Types**          | `TimelineElement`, `CompositionSpec`, `Asset`, canvas dimensions, defaults                           |
| **Parsers**        | `parseHtml` — extract timeline elements from HTML; `parseGsapScript` — parse GSAP animations         |
| **Generators**     | `generateHyperframesHtml` — produce valid Hyperframes HTML from a composition spec                   |
| **Compiler**       | `compileTimingAttrs` — resolve `data-start` / `data-duration` into absolute times                    |
| **Linter**         | `lintHyperframeHtml` — validate Hyperframes HTML (missing attributes, overlapping tracks, etc.)      |
| **Runtime**        | IIFE script injected into the browser — manages seek, media playback, and the `window.__hf` protocol |
| **Frame Adapters** | Pluggable animation drivers (GSAP, Lottie, CSS, or custom)                                           |

## Generated composition trust

Composition generators require trusted authors for code-bearing inputs. `styles` and
`generateHyperframesStyles` preserve authored CSS, which can load external resources.
`animations` may contain `__raw:` values that are emitted as JavaScript;
`includeScripts: true` includes executable timeline code. `serializeGsapAnimations`
also accepts raw `preamble`, `postamble`, and a code-bearing `timelineVar`. Never fill
these inputs with untrusted data. Attribute encoding and closing-tag containment
are not a sandbox; render untrusted compositions in an appropriately isolated
execution environment and never serve them on a privileged origin.

Text content retains the supported inline-formatting sanitizer contract. The clip
parser intentionally flattens inner formatting to text, so parse/generate is not
a lossless replacement for editing the source HTML.

## Frame Adapters

A frame adapter tells the engine how to seek your animation to a specific frame:

```typescript
import { createGSAPFrameAdapter } from "@hyperframes/core";

const adapter = createGSAPFrameAdapter({
  getTimeline: () => gsap.timeline(),
  compositionId: "my-video",
});
```

Implement `FrameAdapter` for custom animation runtimes:

```typescript
import type { FrameAdapter } from "@hyperframes/core";

const myAdapter: FrameAdapter = {
  id: "my-adapter",
  getDurationFrames: () => 300,
  seekFrame: (frame) => {
    /* seek your animation */
  },
};
```

## Parsing and generating HTML

```typescript
import { parseHtml, generateHyperframesHtml } from "@hyperframes/core";

const { elements, metadata } = parseHtml(htmlString);
const html = generateHyperframesHtml(spec);
```

## Linting

```typescript
import { lintHyperframeHtml } from "@hyperframes/core/lint";

const result = lintHyperframeHtml(htmlString);
// result.findings: { severity, message, elementId }[]
```

## Documentation

Full documentation: [hyperframes.heygen.com/packages/core](https://hyperframes.heygen.com/packages/core)

## Related packages

- [`@hyperframes/engine`](../engine) — rendering engine that drives the browser
- [`@hyperframes/producer`](../producer) — full render pipeline (capture + encode)
- [`hyperframes`](../cli) — CLI
