# Boy Meets Girl Symbols

A 12-second Hyperframes scene built from generated SF Symbol assets.

## Source

- Composition: `index.html`
- Generated SF Symbol assets: `assets/sf/`
- Output target: 4K landscape, 60fps, high-quality MP4.
- Main walk cycle: 60-frame, 30fps, 2x source-density sprite sheet.

## Preview

From the repo root:

```bash
npx hyperframes preview --port 3017
```

Open:

```text
http://localhost:3017/#project/boy-meets-girl-symbols
```

## Verify

```bash
npx hyperframes lint examples/boy-meets-girl-symbols
npx hyperframes validate examples/boy-meets-girl-symbols
npx hyperframes inspect examples/boy-meets-girl-symbols --samples 15
```

## Render

From the repo root:

```bash
npx hyperframes render examples/boy-meets-girl-symbols \
  --quality high \
  --fps 60 \
  --resolution landscape-4k \
  --output examples/boy-meets-girl-symbols/renders/boy-meets-girl-symbols-4k60.mp4
```

Confirm the encoded file:

```bash
ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=width,height,r_frame_rate,codec_name \
  -of json \
  examples/boy-meets-girl-symbols/renders/boy-meets-girl-symbols-4k60.mp4
```
