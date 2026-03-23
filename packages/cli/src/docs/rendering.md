# Rendering

Render compositions to MP4 with `npx hyperframes render`.

## Local Mode (default)

Uses Puppeteer (bundled Chromium) + system FFmpeg. Fast for iteration.
Requires: FFmpeg installed (`brew install ffmpeg` or `apt install ffmpeg`).

## Docker Mode (--docker)

Deterministic output with exact Chrome version and fonts. For production.
Requires: Docker installed and running.

## Options

- `-f, --fps` — 24, 30, or 60 (default: 30)
- `-q, --quality` — draft, standard, high (default: standard)
- `-w, --workers` — Parallel workers 1-8 (default: auto)
- `--gpu` — Use GPU encoding (NVENC, VideoToolbox, VAAPI)
- `-o, --output` — Custom output path

## Tips

- Use `draft` quality for fast previews during development
- Use `npx hyperframes benchmark` to find optimal settings
- 4 workers is usually the sweet spot for most compositions
