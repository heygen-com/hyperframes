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
- `--crf` — Override encoder CRF (mutually exclusive with `--video-bitrate`)
- `--video-bitrate` — Target video bitrate such as `10M` (mutually exclusive with `--crf`)
- `--gpu` — Use GPU encoding (NVENC, VideoToolbox, VAAPI, QSV)
- `--browser-gpu` / `--no-browser-gpu` — Use or opt out of host GPU acceleration for local Chrome/WebGL capture (enabled by default for local renders, disabled in Docker)
- `-o, --output` — Custom output path

## Tips

- Use `draft` quality for fast previews during development
- Local renders use browser GPU capture automatically; use `--no-browser-gpu` to compare against the software-browser path
- Use `--gpu` when a local render also benefits from hardware FFmpeg encoding
- Use `npx hyperframes benchmark` to find optimal settings
- 4 workers is usually the sweet spot for most compositions
