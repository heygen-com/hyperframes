# Hyperframes

## Skills — USE THESE FIRST

This repo ships skills that are installed globally via `npx hyperframes skills` (runs automatically during `hyperframes init`). **Always use the appropriate skill instead of writing code from scratch or fetching external docs.**

### Skills

| Skill               | Invoke with        | When to use                                                                                                                                         |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hyperframes**     | `/hyperframes`     | Creating or editing HTML compositions, captions/subtitles, TTS narration, audio-reactive animation, marker highlights. Composition authoring rules. |
| **hyperframes-cli** | `/hyperframes-cli` | CLI commands: init, lint, preview, render, transcribe, tts, doctor. Use when scaffolding, validating, previewing, or rendering.                     |
| **gsap**            | `/gsap`            | GSAP animations — tweens, timelines, easing, ScrollTrigger, plugins (Flip, Draggable, SplitText, etc.), React/Vue/Svelte, performance optimization. |

### Why this matters

The skills encode HyperFrames-specific patterns (e.g., required `class="clip"` on all timed elements, GSAP timeline registration via `window.__timelines`, `data-*` attribute semantics) that are NOT in generic web docs. Skipping the skills and writing from scratch will produce broken compositions.

### Rules

- When creating or modifying HTML compositions, captions, TTS, audio-reactive, or marker highlights → invoke `/hyperframes` BEFORE writing any code
- When writing GSAP animations (tweens, timelines, ScrollTrigger, plugins) → invoke `/gsap` BEFORE writing any code
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

### Adding CLI Commands

When adding a new CLI command:

1. Define the command in `packages/cli/src/commands/<name>.ts` using `defineCommand` from citty
2. **Export `examples`** in the same file — `export const examples: Example[] = [...]` (import `Example` from `./_examples.js`). These are displayed by `--help`.
3. Register it in `packages/cli/src/cli.ts` under `subCommands` (lazy-loaded)
4. Validate by running `npx tsx packages/cli/src/cli.ts <name> --help` and verifying the examples section appears

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

See the `/hyperframes` skill (references/captions.md and references/transcript-guide.md) for full details on model selection and API usage.

## Text-to-Speech

Generate speech audio locally using Kokoro-82M (no API key, runs on CPU). Useful for adding voiceovers to compositions.

### Quick reference

```bash
# Generate speech from text
npx hyperframes tts "Welcome to HyperFrames"

# Choose a voice and output path
npx hyperframes tts "Hello world" --voice am_adam --output narration.wav

# Read text from a file
npx hyperframes tts script.txt --voice bf_emma

# Adjust speech speed
npx hyperframes tts "Fast narration" --speed 1.2

# List available voices
npx hyperframes tts --list
```

### Voices

Default voice is `af_heart`. The model ships with 54 voices across 8 languages:

| Voice ID     | Name    | Language | Gender |
| ------------ | ------- | -------- | ------ |
| `af_heart`   | Heart   | en-US    | Female |
| `af_nova`    | Nova    | en-US    | Female |
| `am_adam`    | Adam    | en-US    | Male   |
| `am_michael` | Michael | en-US    | Male   |
| `bf_emma`    | Emma    | en-GB    | Female |
| `bm_george`  | George  | en-GB    | Male   |

Use `npx hyperframes tts --list` for the full set, or pass any valid Kokoro voice ID.

### Requirements

- Python 3.8+ (auto-installs `kokoro-onnx` package on first run)
- Model downloads automatically on first use (~311 MB model + ~27 MB voices, cached in `~/.cache/hyperframes/tts/`)
