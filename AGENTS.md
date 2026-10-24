# Hyperframes

Open-source video rendering framework: write HTML, render video.

## Skills

This repo ships AI agent skills via [vercel-labs/skills](https://github.com/vercel-labs/skills). Install them before writing compositions — they encode framework-specific patterns that generic docs don't cover. **Default to the core set** (`/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry`, `/media-use`); install everything only when the user explicitly asks for the full set.

```bash
npx hyperframes skills update           # default: installs/refreshes the core set plus anything already installed
npx hyperframes skills                  # all 7 published skills at once
npx skills add heygen-com/hyperframes   # interactive picker (terminal only; repo-internal skills are excluded by default)
```

Make any video by asking for it; the `/hyperframes` skill carries the contract and the references (film, captions, overlays, motion, look). Read it first.

- `/hyperframes` — read first for any request to make, edit, animate or render a video, motion graphic, captions or overlays with HyperFrames (HTML rendered to video). Holds the render contract and the work loop, and points to the references for format, motion, look, captions, whole films and storyboards.
- `/hyperframes-cli` — the HyperFrames CLI by job: scaffold, check, look at frames, edit the timeline, preview, render locally or in the cloud, publish, project history; plus reading its JSON and recovering from build or render failures.
- `/hyperframes-registry` — about 450 ready-made blocks and components installed as editable source. Use before hand-building any named visual; also for `hyperframes add` and `catalog`.
- `/media-use` — get or make any media for a video (music, sound effects, images, voiceover, avatar and generated video, transcripts, cutouts, colour grades) with HeyGen or free local tools, and mix placed audio.
- `/figma` — bring Figma into a video: rendered assets, brand tokens, components, storyboard frames as reconstructed motion.
- `/slideshow` — a presentation, pitch deck or interactive deck. Output is a navigable deck, not a rendered MP4.
- `/remotion-to-hyperframes` — bring existing video code or footage into HyperFrames (Remotion first; also Motion Canvas, Lottie, Three.js, canvas, or renders from other tools) and verify it frame by frame against the original.

## Issue and PR triage

Read [TRIAGE.md](TRIAGE.md) before classifying issues, advertising contribution work, or triaging PRs. Check current source and overlapping PRs; keep difficulty, readiness, and ownership separate. Apply changes only within the task's authorization and verify the resulting GitHub state.

## Build & Test

```bash
bun install     # Install dependencies (NOT pnpm — do not create pnpm-lock.yaml)
bun run build   # Build all packages
bun run test    # Run all tests
```

Packages load each other through their `exports`. Under Node, core, parsers,
lint and studio-server resolve to `dist/`, and player always loads its built
bundle. Run `bun run build` once in a fresh worktree, before any package's
tests or typecheck. After editing a package that another package imports, run
that package's `build` again before the dependent package's tests. Core's
`src/generated/` is git-ignored build output: if you see
`Cannot find module '../generated/runtime-inline'`, run
`bun run build:hyperframes-runtime`.

One file: `bun run --cwd packages/<pkg> test <path>`. Each package's `test`
script picks its runner (vitest in most, `bun test` in aws-lambda and
gcp-cloud-run). Producer is the exception: a file that imports `bun:test` runs
with `bun test <file>`, any other with `bunx vitest run <file>`. Root `scripts/*.test.mjs` run through `bun run test:scripts`,
which is an explicit list in `package.json`. CI's test-reachability check fails
any test file that no runner reaches.

### Linting & Formatting

Uses **oxlint** and **oxfmt** (not eslint, not prettier, not biome).

```bash
node_modules/.bin/oxlint <files>        # Lint
node_modules/.bin/oxfmt <files>         # Format
node_modules/.bin/oxfmt --check <files> # Check formatting (CI / pre-commit)
```

Always lint and format changed files before committing. Lefthook pre-commit hooks enforce this automatically.

### Composition Validation

After creating or editing any `.html` composition:

```bash
npx hyperframes lint       # Static HTML structure check
npx hyperframes check      # Browser gate (headless Chrome — runtime errors, layout, motion, WCAG contrast)
```

Both must pass before previewing or considering work complete.

## Project Structure

```
packages/
  cli/                  → hyperframes CLI (create, preview, lint, render)
  core/                 → Types, parsers, generators, linter, runtime, frame adapters
  engine/               → Seekable page-to-video capture engine (Puppeteer + FFmpeg)
  player/               → Embeddable <hyperframes-player> web component
  producer/             → Full rendering pipeline (capture + encode + audio mix)
  shader-transitions/   → WebGL shader transitions for compositions
  studio/               → Browser-based composition editor UI (read packages/studio/AGENTS.md first)
registry/
  blocks/               → Installable sub-composition scenes (50+)
  components/           → Installable effects and snippets
  examples/             → Starter project templates
docs/                   → Mintlify documentation site (hyperframes.heygen.com)
skills/                 → AI agent skill definitions
```

## Key Conventions

- **Package manager**: bun (not pnpm, not npm for workspace operations)
- **Commit format**: Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
- **TypeScript**: Avoid `any` and `as T` assertions. Prefer type guards and narrowing.
- **Compositions**: HTML files with `data-*` attributes. Clips need `class="clip"`. Register one paused GSAP root timeline per composition on `window.__timelines`. Scene timelines manually added to that root must not be paused, or they will not advance when the root is seeked.
- **Frame Adapters**: Animation runtimes plug in via the seek-by-frame adapter pattern. GSAP is the primary adapter.
- **Deterministic rendering**: No `Date.now()`, no unseeded `Math.random()`, no render-time network fetches.
- **Docs ship with the change**: a PR that adds or changes a CLI command, flag, or user-visible behavior updates `docs/` in the same PR. A new command also goes in "Find your command" in `docs/packages/cli.mdx` (CI checks it).

## Documentation

- Docs: https://hyperframes.heygen.com/introduction
- Catalog (50+ blocks): https://hyperframes.heygen.com/catalog/blocks/data-chart
