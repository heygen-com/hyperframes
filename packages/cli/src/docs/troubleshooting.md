# Troubleshooting

## "No composition found"
Your directory needs an `index.html`. Run `npx hyperframes init` to create one.

## "FFmpeg not found"
Local rendering requires FFmpeg. Install it:
- macOS: `brew install ffmpeg`
- Ubuntu: `sudo apt install ffmpeg`
- Windows: Download from https://ffmpeg.org/download.html

## Lint errors
Run `npx hyperframes lint` to check for common issues:
- Missing `data-composition-id` on root element
- Missing `class="clip"` on timed elements
- Overlapping timelines or invalid data attributes

## Preview not updating
Make sure you're editing the `index.html` in the project directory. The preview server watches for file changes and auto-reloads.

## Render looks different from preview
Use `--docker` mode for deterministic output. Local renders may differ due to font availability and Chrome version.
