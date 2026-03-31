---
name: hyperframes-cli
description: Use when the user mentions "hyperframes", wants to preview a composition in the studio, render to MP4/WebM, scaffold a new video project, lint or validate a composition, or troubleshoot rendering. Also use after finishing a composition with compose-video — lint and preview are the natural next steps.
---

# HyperFrames CLI

The CLI turns HTML compositions into previews and rendered video. Everything runs through `npx hyperframes`.

```bash
npx hyperframes <command>
```

Requires Node.js >= 22 and FFmpeg. Run `npx hyperframes doctor` if anything fails.

## Workflow

The natural sequence when building a composition:

1. **Scaffold** — `npx hyperframes init my-video` (new projects only)
2. **Write** — author HTML composition (see `compose-video` skill)
3. **Lint** — `npx hyperframes lint` to catch structural errors
4. **Preview** — `npx hyperframes preview` to see it live in the studio
5. **Render** — `npx hyperframes render` to export video

**Lint before preview.** It catches missing `data-composition-id`, overlapping tracks on the same `data-track-index`, unregistered timelines, and other structural issues that silently produce broken output. A 2-second lint saves minutes debugging a blank screen. Both `preview` and `render` auto-lint, but linting explicitly after editing gives you a chance to fix issues without waiting for the server or renderer to spin up.

## Scaffolding New Projects

```bash
npx hyperframes init my-video                        # interactive wizard
npx hyperframes init my-video --template warm-grain   # pick a template
npx hyperframes init my-video --video clip.mp4        # with video file
npx hyperframes init my-video --audio track.mp3       # with audio file
npx hyperframes init my-video --non-interactive       # skip prompts (CI/agents)
```

Templates: `blank`, `warm-grain`, `play-mode`, `swiss-grid`, `vignelli`, `decision-tree`, `kinetic-type`, `product-promo`, `nyt-graph`.

`init` creates the right file structure, copies media, transcribes audio with Whisper, and installs AI coding skills. Use it instead of creating files by hand — the template includes boilerplate that's easy to forget.

## Linting

```bash
npx hyperframes lint                  # current directory
npx hyperframes lint ./my-project     # specific project
npx hyperframes lint --verbose        # include info-level findings
npx hyperframes lint --json           # machine-readable output for scripting
```

Lints `index.html` and all files in `compositions/`. Reports errors (must fix), warnings (should fix), and info (with `--verbose`).

**When to lint:**

- After writing or editing any composition file — always
- Before rendering — `render` blocks on errors with `--strict`, but linting first is faster
- After timing changes — overlapping clips on the same track are a common mistake

## Previewing in the Studio

```bash
npx hyperframes preview                   # serve current directory
npx hyperframes preview ./my-project      # specific project
npx hyperframes preview --port 4567       # custom port (default 3002)
```

Opens the studio in your browser automatically. Hot-reloads on file changes. Run from the project root (directory containing `index.html`).

## Rendering to Video

```bash
npx hyperframes render                                        # standard MP4
npx hyperframes render --output final.mp4                     # named output
npx hyperframes render --quality draft                        # fast iteration
npx hyperframes render --fps 60 --quality high -o hd.mp4      # high quality
npx hyperframes render --format webm -o overlay.webm          # transparent WebM
npx hyperframes render --docker -o deterministic.mp4          # reproducible
```

| Flag           | Options               | Default                      | Notes                                 |
| -------------- | --------------------- | ---------------------------- | ------------------------------------- |
| `--output`     | path                  | renders/name_timestamp.mp4   | Output file path                      |
| `--fps`        | 24, 30, 60            | 30                           | 60fps doubles render time             |
| `--quality`    | draft, standard, high | standard                     | Use draft while iterating             |
| `--format`     | mp4, webm             | mp4                          | WebM supports transparency            |
| `--workers`    | 1-8 or auto           | auto (half CPU cores, max 4) | Each spawns a Chrome process          |
| `--docker`     | flag                  | off                          | Byte-identical output across machines |
| `--gpu`        | flag                  | off                          | GPU-accelerated encoding              |
| `--strict`     | flag                  | off                          | Fail on lint errors                   |
| `--strict-all` | flag                  | off                          | Fail on errors AND warnings           |

**Quality guidance:**

- `draft` while iterating on timing and layout — fast feedback
- `standard` for review and most deliverables
- `high` only for final delivery where render time doesn't matter

## Troubleshooting

```bash
npx hyperframes doctor       # check environment (Chrome, FFmpeg, Node, memory, disk)
npx hyperframes browser      # manage bundled Chrome installation
npx hyperframes info         # version and environment details
npx hyperframes upgrade      # check for updates
```

Run `doctor` first if rendering fails or produces unexpected results. Common issues:

- Missing FFmpeg → `brew install ffmpeg`
- Missing Chrome → `npx hyperframes browser ensure`
- Low memory → close other apps (each render worker uses ~256MB)

## Other Commands

```bash
npx hyperframes compositions   # list compositions in current project
npx hyperframes docs           # open documentation in browser
npx hyperframes benchmark .    # benchmark render performance
```
