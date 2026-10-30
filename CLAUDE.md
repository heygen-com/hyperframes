# Hyperframes

Open-source video rendering framework: write HTML, render video.

## Skills

This repo ships 7 AI agent skills via [vercel-labs/skills](https://github.com/vercel-labs/skills). Install them before writing compositions — they encode framework-specific patterns that generic docs don't cover. **Default to the core set** (`/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry`, `/media-use`); `/slideshow`, `/remotion-to-hyperframes` and `/figma` install on demand. Install all 7 only when the user explicitly asks for the full set.

```bash
npx hyperframes skills update                         # default: installs/refreshes the core set plus anything already installed
npx hyperframes skills                                # all 7 published skills at once — only on explicit request
npx skills add heygen-com/hyperframes                 # interactive picker; internal skills require INSTALL_INTERNAL_SKILLS=1 for discovery
npx skills add heygen-com/hyperframes --all           # excludes internal skills unless INSTALL_INTERNAL_SKILLS=1
npx skills add heygen-com/hyperframes --skill <name>  # a named match installs regardless of metadata.internal (bare name, no leading slash)
```

> **Warning:** Never run `npx skills add ... --all` from inside a HyperFrames checkout: it selects the OpenClaw target, whose `skills/` directory is the repo's own `skills/`, and removes each existing `skills/<name>` destination before linking. A fresh clone restores tracked source, but uncommitted work under `skills/` does not recover. Run it from an empty directory or from your own project root. This happens regardless of `metadata.internal`.

`skills add` resolves the skills.sh registry blob, which can lag `main` by hours, so a freshly added skill may be a little behind. `npx hyperframes skills update` installs from the current `main`; prefer it when freshness matters.

Make any video by asking for it; the `/hyperframes` skill carries the render contract and the references (format, runtimes, motion, look, captions, film, overlays, storyboards). The skills carry knowledge, not process. The README skills section mirrors this list; keep them in sync (see "Skill catalog maintenance" below).

- `/hyperframes` — read first for any request to make, edit, animate or render a video, motion graphic, captions or overlays with HyperFrames (HTML rendered to video). Holds the render contract and the work loop, and points to the references for format, motion, look, captions, whole films and storyboards.
- `/hyperframes-cli` — the HyperFrames CLI by job: scaffold, check, look at frames, edit the timeline, preview, render locally or in the cloud, publish, project history; plus reading its JSON and recovering from build or render failures.
- `/hyperframes-registry` — about 450 ready-made blocks and components installed as editable source: transitions, overlays, titles, kinetic type, captions, charts, maps, 3D, camera moves. Use before hand-building any named visual; also for `hyperframes add` and `catalog`.
- `/media-use` — get or make any media for a video (music, sound effects, images, icons, logos, voiceover, avatar and generated video, transcripts, cutouts, colour grades and looks) with HeyGen or free local tools, and mix placed audio. Also for footage that looks dark, flat or dull, or should be stylized or hidden.
- `/figma` — bring Figma into a video: rendered assets, brand tokens, components, storyboard frames as reconstructed motion, shaders and connector-assisted motion. Use when the person pastes a figma.com link or asks to use a Figma design, frame, logo or brand.
- `/slideshow` — a presentation, pitch deck or interactive deck with discrete slides, fragment reveals, branching, hotspot navigation and presenter mode with speaker notes; also converts an existing page into a deck. Output is a navigable deck, not a rendered MP4.
- `/remotion-to-hyperframes` — bring existing video code or footage into HyperFrames (Remotion first; also Motion Canvas, Lottie, Three.js, canvas, or renders from other tools) and verify it frame by frame against the original.

## Skill catalog maintenance

When adding a new skill, or substantially renaming / repurposing an existing one, update all agent-facing discoverability surfaces in lockstep:

1. The skill list above (CLAUDE.md) AND the skill list in the root `AGENTS.md` AND the `## Skills` section in `README.md` AND `docs/guides/skills.mdx` (rendered at [hyperframes.heygen.com/guides/skills](https://hyperframes.heygen.com/guides/skills)) AND the two setup pages that compress the same descriptions — `docs/prompting/overview.mdx` ("One-time setup") and `docs/quickstart.mdx`. Out-of-date entries silently kill discovery. This list is also the sync set for a **changed contract**, not just an added or renamed skill: a reworded `description:` has to be pushed to every surface or the compressed copies start asserting the opposite of the skill.
2. The scaffolded project template `packages/cli/src/templates/_shared/CLAUDE.md` + `AGENTS.md` — written into every `hyperframes init` project, so a stale entry there ships to users. The two template files must stay byte-identical.
3. The routing surface for "make a video" requests is the References table and closing line of `skills/hyperframes/SKILL.md`. A new reference or skill that a request should reach gets a row or a mention there.
4. Keep the same grouping on every surface: the core set (`/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry`, `/media-use`) first, then the on-demand skills (`/figma`, `/slideshow`, `/remotion-to-hyperframes`).
5. Skill count appears in the README and CLAUDE.md intro lines ("7 AI agent skills…") — update on add/remove. The `docs/guides/skills.mdx` page and the CLI templates deliberately omit a count to avoid drift; keep them count-free.

The skill's own `SKILL.md` frontmatter `description:` is the source of truth for the one-line "use when" blurb; copy from there into the catalog rather than paraphrasing.

## Build & Test

```bash
bun install     # Install dependencies (NOT pnpm — do not create pnpm-lock.yaml)
bun run build   # Build all packages
bun run test    # Run all tests
```

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
