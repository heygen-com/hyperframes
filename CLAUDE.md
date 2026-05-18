# Hyperframes

Open-source video rendering framework: write HTML, render video.

```
packages/
  cli/       → hyperframes CLI (create, preview, lint, render)
  core/      → Types, parsers, generators, linter, runtime, frame adapters
  engine/    → Seekable page-to-video capture engine (Puppeteer + FFmpeg)
  player/    → Embeddable <hyperframes-player> web component
  producer/  → Full rendering pipeline (capture + encode + audio mix)
  studio/    → Browser-based composition editor UI
```

## Development

```bash
bun install     # Install dependencies
bun run build   # Build all packages
bun run test    # Run tests
```

**This repo uses bun**, not pnpm. Do NOT run `pnpm install` — it creates a `pnpm-lock.yaml` that should not exist. Workspace linking relies on bun's resolution from `"workspaces"` in root `package.json`.

### Linting & Formatting

This project uses **oxlint** and **oxfmt** (not biome, not eslint, not prettier).

```bash
bunx oxlint <files>        # Lint
bunx oxfmt <files>         # Format (write)
bunx oxfmt --check <files> # Format (check only, used by pre-commit hook)
```

Always run both on changed files before committing. The lefthook pre-commit hook runs `bunx oxlint` and `bunx oxfmt --check` automatically.

### Adding CLI Commands

When adding a new CLI command:

1. Define the command in `packages/cli/src/commands/<name>.ts` using `defineCommand` from citty
2. **Export `examples`** in the same file — `export const examples: Example[] = [...]` (import `Example` from `./_examples.js`). These are displayed by `--help`.
3. Register it in `packages/cli/src/cli.ts` under `subCommands` (lazy-loaded)
4. **Add to help groups** in `packages/cli/src/help.ts` — add the command name and description to the appropriate `GROUPS` entry. Without this, the command won't appear in `hyperframes --help` even though it works.
5. **Document it** in `docs/packages/cli.mdx` — add a section with usage examples and flags.
6. Validate by running `npx tsx packages/cli/src/cli.ts --help` (command appears in the list) and `npx tsx packages/cli/src/cli.ts <name> --help` (examples appear).

### Regression Test Golden Baselines (producer)

`packages/producer/tests/<name>/output/output.mp4` baselines MUST be generated
inside `Dockerfile.test`, not on your host. CI renders inside that Docker image
with a specific Chrome + ffmpeg build; pixel-level output drifts across
different host Chrome/ffmpeg versions and will fail PSNR at dozens of
checkpoints even when the code is correct.

```bash
# Build the test image once:
docker build -t hyperframes-producer:test -f Dockerfile.test .

# Generate or update a baseline (runs the harness with --update inside Docker):
bun run --cwd packages/producer docker:test:update <test-name>
```

Never run `bun run --cwd packages/producer test:update` directly from the
host to capture a baseline that will be committed — the resulting output.mp4
will not match CI. Use it only for local-only experimentation.

## Skills

Composition authoring (not repo development) is guided by skills installed via `npx skills add heygen-com/hyperframes`. See `skills/` for source. The active skills are:

- `/hyperframes-core` — HTML composition contract: data attributes, clips, tracks, sub-compositions, variables, media playback, deterministic render rules, and validation of minimal renderable projects.
- `/hyperframes-creative` — Creative direction: `design.md` handling, palettes, typography, motion principles, scene transitions, beat planning, narration, audio-reactive visuals, title cards, data-in-motion, and advanced recipes.
- `/hyperframes-captions` — Subtitles, lyrics, karaoke, per-word styling, transcript JSON/SRT/VTT import, and caption timing from audio. Consumes transcripts produced by `/hyperframes-media`.
- `/hyperframes-cli` — CLI dev loop: `init`, `lint`, `validate`, `inspect`, `preview`, `render`, `doctor`, `browser`, `info`, `upgrade`, `compositions`, `docs`, `benchmark`, and environment troubleshooting.
- `/hyperframes-registry` — Installing registry blocks and components via `hyperframes add`, wiring them into `index.html`, and working with `hyperframes.json`.
- `/hyperframes-tailwind` — Use for projects created with `hyperframes init --tailwind`. Pinned Tailwind v4 browser-runtime contract (distinct from Studio's Tailwind v3 setup).
- `/hyperframes-media` — Asset preprocessing: `npx hyperframes tts`, `transcribe`, `remove-background`. Has its own skill so the CLI skill stays focused on the dev loop.
- `/hyperframes-gsap` — GSAP timeline API reference for writing seekable GSAP animations registered on `window.__timelines`, scoped to the HyperFrames runtime contract.
- `/hyperframes-lottie` — Lottie / dotLottie adapter: embedding lottie-web JSON, .lottie players, `window.__hfLottie` registration, making After Effects exports deterministic.
- `/hyperframes-three` — Three.js / WebGL adapter: deterministic scenes, `AnimationMixer`, camera motion, shader-driven visuals, `hf-seek` event handling.
- `/hyperframes-animejs` — Anime.js adapter: timelines registered on `window.__hfAnime`, seek-driven and deterministic.
- `/hyperframes-css-animations` — Native CSS keyframes adapter: `animation-delay` / `animation-play-state` / `animation-fill-mode` patterns that HyperFrames can seek.
- `/hyperframes-waapi` — Web Animations API adapter: `element.animate()`, `Animation.currentTime` seeking, `KeyframeEffect` timing, native browser animations.
- `/hyperframes-typegpu` — TypeGPU / raw WebGPU / WGSL adapter: GPU-rendered canvases driven by `navigator.gpu`, responding to `hf-seek` events.
