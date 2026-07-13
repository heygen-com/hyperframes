# Hyperframes

Open-source video rendering framework: write HTML, render video.

## Skills

This repo ships AI agent skills via [vercel-labs/skills](https://github.com/vercel-labs/skills). Install them before writing compositions — they encode framework-specific patterns that generic docs don't cover.

```bash
npx skills add heygen-com/hyperframes
```

**Creation workflows** route through one entry skill — read `/hyperframes` first: it orients you to the whole surface and maps "make me a…" intent — usually a video, but also a navigable deck (`/slideshow`) or a composition port (`/remotion-to-hyperframes`) — to a concrete workflow. Consult it before invoking a specific workflow:

- `/product-launch-video` — a **product** URL (or a pre-written script / text brief in no-capture mode) → product launch / promo video, up to ~3 min (sweet spot ~30-90s).
- `/website-to-video` — a **general** website / URL → a video _of_ the site (tour / showcase / social clip from captured screenshots + assets); for a product **launch / promo**, use `/product-launch-video`.
- `/faceless-explainer` — arbitrary text, **no URL and no website capture** → faceless explainer, up to ~3 min (sweet spot ~30-90s); every visual is LLM-invented (typography / abstract graphics / diagram / data-viz).
- `/embedded-captions` — an existing talking-head video (MP4) → the same footage with captions / subtitles added (verbatim rail + embedded climax, or pure-cinematic embed); the footage itself is untouched (no NLE-style editing).
- `/talking-head-recut` — an existing talking-head / interview / podcast video (MP4) → the same footage packaged with designed **graphic overlays** (kinetic titles, lower-thirds, data callouts, pull-quotes, side panels, pip) synced to the transcript; the clip plays unchanged underneath, footage untouched. For plain captions/subtitles → `/embedded-captions`.
- `/pr-to-video` — a GitHub PR (URL / `owner/repo#N` / "this PR") → code-change explainer, up to ~3 min (changelog / feature reveal / fix / refactor). A PR link, not a product website.
- `/motion-graphics` — a short (typically under 10s) design-led **motion graphic**, motion-is-the-message, no narration: kinetic type, a stat / number count-up, a chart, a logo sting, a lower-third / overlay, or an animated tweet / headline / captured-page highlight; rendered to MP4 or a transparent overlay. Longer / narrated / custom → `/general-video`.
- `/music-to-video` — a **music track** (audio file, or video to pull audio from) → beat-synced video (lyric / slideshow / kinetic promo). Music drives pacing; user-supplied images / videos are cut onto the same beat grid.
- `/slideshow` — a **presentation / pitch deck / interactive deck** — discrete slides, fragment reveals, branching, hotspot navigation, presenter mode. Output is a navigable deck, not a rendered video.
- `/general-video` — fallback for any other video creation (title card, longer brand / sizzle reel, multi-scene montage, static loop, custom composition); the original hyperframes flow — design → plan → layout → build → validate, any length.

**Porting an existing composition?** `/remotion-to-hyperframes` translates a Remotion (React) video composition into HyperFrames HTML — a source migration, separate from the creation workflows above.

## Build & Test

```bash
bun install     # Install dependencies (NOT pnpm — do not create pnpm-lock.yaml)
bun run build   # Build all packages
bun run test    # Run all tests
```

### Linting & Formatting

Uses **oxlint** and **oxfmt** (not eslint, not prettier, not biome).

```bash
bunx oxlint <files>        # Lint
bunx oxfmt <files>         # Format
bunx oxfmt --check <files> # Check formatting (CI / pre-commit)
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
  studio/               → Browser-based composition editor UI
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
- **Compositions**: HTML files with `data-*` attributes. Clips need `class="clip"`. GSAP timelines must be paused and registered on `window.__timelines`.
- **Frame Adapters**: Animation runtimes plug in via the seek-by-frame adapter pattern. GSAP is the primary adapter.
- **Deterministic rendering**: No `Date.now()`, no unseeded `Math.random()`, no render-time network fetches.

## Documentation

- Docs: https://hyperframes.heygen.com/introduction
- Catalog (50+ blocks): https://hyperframes.heygen.com/catalog/blocks/data-chart
