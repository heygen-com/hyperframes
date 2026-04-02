# Hyperframes

## Skills — USE THESE FIRST

This repo ships skills that are installed globally via `npx hyperframes skills` (runs automatically during `hyperframes init`). **Always use the appropriate skill instead of writing code from scratch or fetching external docs.**

### HyperFrames Skills (from this repo)

| Skill                    | Invoke with             | When to use                                                                                                                                                                           |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hyperframes-compose**  | `/hyperframes-compose`  | Creating ANY HTML composition — videos, animations, title cards, overlays. Contains required HTML structure, `class="clip"` rules, GSAP timeline patterns, and rendering constraints. |
| **hyperframes-captions** | `/hyperframes-captions` | Any task involving text synced to audio: captions, subtitles, lyrics, lyric videos, karaoke. Also covers transcription strategy (whisper model selection, transcript format).         |

### GSAP Skills (from [greensock/gsap-skills](https://github.com/greensock/gsap-skills))

| Skill                  | Invoke with           | When to use                                                                      |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------- |
| **gsap-core**          | `/gsap-core`          | `gsap.to()`, `from()`, `fromTo()`, easing, duration, stagger, defaults           |
| **gsap-timeline**      | `/gsap-timeline`      | Timeline sequencing, position parameter, labels, nesting, playback               |
| **gsap-performance**   | `/gsap-performance`   | Performance best practices — transforms over layout props, will-change, batching |
| **gsap-plugins**       | `/gsap-plugins`       | ScrollTrigger, Flip, Draggable, SplitText, and other GSAP plugins                |
| **gsap-scrolltrigger** | `/gsap-scrolltrigger` | Scroll-linked animations, pinning, scrub, triggers                               |
| **gsap-utils**         | `/gsap-utils`         | `gsap.utils` helpers — clamp, mapRange, snap, toArray, wrap, pipe                |

### Why this matters

The skills encode HyperFrames-specific patterns (e.g., required `class="clip"` on all timed elements, GSAP timeline registration via `window.__GSAP_TIMELINE`, `data-*` attribute semantics) that are NOT in generic web docs. Skipping the skills and writing from scratch will produce broken compositions.

### Rules

- When creating or modifying HTML compositions → invoke `/hyperframes-compose` BEFORE writing any code
- When adding captions, subtitles, lyrics, or any text synced to audio → invoke `/hyperframes-captions` BEFORE writing any code
- When transcribing audio or choosing a whisper model → invoke `/hyperframes-captions` BEFORE running any transcription tool
- When creating a video from audio (music video, lyric video, audio visualizer with text) → invoke BOTH `/hyperframes-compose` AND `/hyperframes-captions`
- When writing GSAP animations → invoke `/gsap-core` and `/gsap-timeline` BEFORE writing any code
- When optimizing animation performance → invoke `/gsap-performance` BEFORE making changes
- After creating or editing any `.html` composition → run `npx hyperframes lint` and `npx hyperframes validate` in parallel, fix all errors before opening the studio or considering the task complete. `lint` checks the HTML structure statically; `validate` loads the composition in headless Chrome and catches runtime JS errors, missing assets, and failed network requests. Always validate before `npx hyperframes preview`.

### Installing skills

```bash
npx skills add heygen-com/hyperframes   # HyperFrames skills
npx skills add greensock/gsap-skills     # GSAP skills
```

Uses [vercel-labs/skills](https://github.com/vercel-labs/skills). Installs to Claude Code, Gemini CLI, and Codex CLI by default. Pass `-a <agent>` for other targets.

## Project Overview

Open-source video rendering framework: write HTML, render video.

```
packages/
  cli/       → hyperframes CLI (create, preview, lint, render)
  core/      → Types, parsers, generators, linter, runtime, frame adapters
  engine/    → Seekable page-to-video capture engine (Puppeteer + FFmpeg)
  producer/  → Full rendering pipeline (capture + encode + audio mix)
  studio/    → Browser-based composition editor UI
```

## Development

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
```

### Linting & Formatting

This project uses **oxlint** and **oxfmt** (not biome, not eslint, not prettier).

```bash
bunx oxlint <files>        # Lint
bunx oxfmt <files>         # Format (write)
bunx oxfmt --check <files> # Format (check only, used by pre-commit hook)
```

Always run both on changed files before committing. The lefthook pre-commit hook runs `bunx oxlint` and `bunx oxfmt --check` automatically.

## Key Concepts

- **Compositions** are HTML files with `data-*` attributes defining timeline, tracks, and media
- **Frame Adapters** bridge animation runtimes (GSAP, Lottie, CSS) to the capture engine
- **Producer** orchestrates capture → encode → audio mix into final MP4
- **BeginFrame rendering** uses `HeadlessExperimental.beginFrame` for deterministic frame capture

## Transcription

HyperFrames uses word-level timestamps for captions. The `hyperframes transcribe` command handles both transcription and format conversion.

### Quick reference

```bash
# Transcribe audio/video (local whisper.cpp, no API key)
npx hyperframes transcribe audio.mp3
npx hyperframes transcribe video.mp4 --model medium.en --language en

# Import existing transcript from another tool
npx hyperframes transcribe subtitles.srt
npx hyperframes transcribe subtitles.vtt
npx hyperframes transcribe openai-response.json
```

### Whisper models

Default is `small.en`. Upgrade for better accuracy:

| Model      | Size   | Use case                       |
| ---------- | ------ | ------------------------------ |
| `tiny`     | 75 MB  | Quick testing                  |
| `base`     | 142 MB | Short clips, clear audio       |
| `small`    | 466 MB | **Default** — most content     |
| `medium`   | 1.5 GB | Important content, noisy audio |
| `large-v3` | 3.1 GB | Production quality             |

**Only use `.en` suffix when you know the audio is English.** `.en` models translate non-English audio into English instead of transcribing it.

### Supported transcript formats

The CLI auto-detects and normalizes: whisper.cpp JSON, OpenAI Whisper API JSON, SRT, VTT, and pre-normalized `[{text, start, end}]` arrays.

### Improving transcription quality

If captions are inaccurate (wrong words, bad timing):

1. **Upgrade the model**: `--model medium.en` or `--model large-v3`
2. **Set language**: `--language en` to filter non-target speech
3. **Use an external API**: Transcribe via OpenAI or Groq Whisper API, then import the JSON with `hyperframes transcribe response.json`

See the `/hyperframes-captions` skill for full details on model selection and API usage.
