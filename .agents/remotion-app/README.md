# Remotion alongside HyperFrames

An independent Bun project: dependencies and lockfile stay here, outside the monorepo workspaces. Node 22+ and Bun are required.

```sh
cd .agents/remotion-app
bun install --frozen-lockfile
bun run studio
bun run typecheck
bun run build --text "Quarterly market update"
bun run build --props '{"text":"Quarterly update","bgVideo":"../../shared-data/hyperframes-layer.mp4"}' --output ../../shared-data/final-combined-video.mp4
```

The default composition is 1920×1080, 30 fps, eight seconds, with a minimal finance frame. Background video is optional; its audio is preserved. Use an eight-second background for a matching duration; longer inputs are trimmed. Text appears over the background. Edit `src/Root.tsx` to change layout or duration.

Generate `shared-data/hyperframes-layer.mp4` with the existing HyperFrames command before using `/combine-video`. The renderer copies the local input into a temporary public directory so Remotion can serve it; no absolute filesystem paths are passed to the browser. Temporary assets are removed after success or failure. Caller-supplied paths resolve from the current working directory. Output defaults to `out/video.mp4`.

For a quick render check, append `--frames 3`. Set `REMOTION_BROWSER_EXECUTABLE` to use an existing Chromium/Chrome executable; Linux `/usr/bin/chromium` is detected automatically. Otherwise Remotion downloads its browser. Studio previews the default composition; local background files are staged by the build script.

The `.openai/skills.json` commands run from the repository root and install locked dependencies before rendering. That file is the repository's command registry; its consumer must substitute `{{prompt}}` as a safely escaped shell argument. Do not interpolate untrusted text into shell commands; for arbitrary text, invoke `scripts/render.mjs` with an argument array or a JSON props argument directly.
