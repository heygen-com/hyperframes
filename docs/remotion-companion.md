# Combine a HyperFrames background with Remotion

This repository includes a lightweight companion app in `.agents/remotion-app`. It places a frame, an animated illustrative bar chart, and a title over an existing HyperFrames video.

First generate `shared-data/hyperframes-layer.mp4` using the existing HyperFrames skill. Then, from the repository root:

```sh
cd .agents/remotion-app
bun install --frozen-lockfile
bun run build --bg-video ../../shared-data/hyperframes-layer.mp4 --output ../../shared-data/final-combined-video.mp4
```

The output is an eight-second 1920×1080 H.264 video at 30 fps. The input audio is preserved. `/combine-video` in `.openai/skills.json` runs this same command. Pass `--text "Quarterly update"` to customize the title. Chart bars are decorative, not financial data.

If the input is missing, generate it before rendering. To choose a browser, set `REMOTION_BROWSER_EXECUTABLE`; otherwise the script detects Linux Chromium or lets Remotion download Chrome. Local input files are copied to a temporary serving directory and removed after rendering.

See `.agents/remotion-app/README.md` for Studio preview, JSON props, and short verification renders.
