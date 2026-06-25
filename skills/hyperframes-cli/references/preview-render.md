# preview, play, render, publish

Serve, render, and share commands.

## preview

```bash
npx hyperframes preview                   # serve current directory
npx hyperframes preview --port 4567       # custom port (default 3002)
```

Hot-reloads on file changes. Opens Studio in the browser automatically — the full timeline editor, where the user can play the video and edit anything by hand before rendering. This is the review surface, not just a viewer.

When handing a project back to the user, use the Studio project URL, not the source `index.html` path:

```text
http://localhost:<port>/#project/<project-name>
```

Use the actual port and project directory name; treat `index.html` as source-code context, not the preview surface. For example, after `npx hyperframes preview --port 3017` in `codex-openai-video`, report `http://localhost:3017/#project/codex-openai-video`.

## play (lightweight player)

```bash
npx hyperframes play                  # current project, port 3003
npx hyperframes play ./my-video       # specific project
npx hyperframes play --port 8080      # custom port
```

`play` serves the composition through the embeddable `<hyperframes-player>` web component instead of the full Studio UI. Use it when sharing a preview link or when Studio is heavier than needed (no editor, no panels). `play` reports the plain `http://localhost:<port>` URL — no `#project/<name>` fragment (that's a Studio routing convention only `preview` uses).

The player's `playback-rate` attribute (preview speed control, drives the timeline's `timeScale`) is clamped to `[0.1, 5]`; values `≤ 0` or non-finite fall back to `1`. This is a preview/playback knob, not a composition `data-*` attribute — authored motion still renders at `1×`.

### Launching with an external browser (preview + play)

Both `preview` and `play` can open inside an explicit Chromium-compatible browser instead of the OS default. Two use cases: isolated Chromium profile, or external CDP attach (DevTools / Playwright / Puppeteer / browser-MCP). **HyperFrames itself does not own CDP automation** — this only exposes the endpoint; whatever connects to it is your problem. Not to be confused with `--browser-gpu` (a `render` flag controlling Chrome GPU access during capture).

| Flag                      | Type            | Notes                                                                                                                                                                                           |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--browser-path`          | path            | Absolute path to a Chromium-compatible executable (`/usr/bin/chromium`, `/Applications/Brave Browser.app/...`).                                                                                 |
| `--user-data-dir`         | path            | Chromium-compatible profile directory. Requires `--browser-path`. Use a throwaway directory to keep state out of your main profile.                                                             |
| `--remote-debugging-port` | integer 1-65535 | Open a Chromium CDP endpoint on the given port. **Requires both** `--browser-path` and `--user-data-dir` — refused otherwise, so a CDP endpoint cannot leak into your main profile by accident. |

```bash
# Open preview in an isolated Chromium profile
npx hyperframes preview --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile

# Same plus a CDP endpoint on :9222 (attach DevTools / Playwright / etc.)
npx hyperframes play --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile --remote-debugging-port 9222
```

Validation runs before any server boots, so an invalid value exits cleanly without leaving a listening socket behind.

## render

> Render only after the user has reviewed in `preview` and approved. Don't auto-render when the checks pass.

```bash
npx hyperframes render                                # standard MP4 from cwd
npx hyperframes render ./my-video --output ./out.mp4  # render from outside the project dir
npx hyperframes render --output final.mp4             # named output (no timestamp)
npx hyperframes render -c compositions/intro.html -o intro.mp4  # render a specific sub-composition file
npx hyperframes render --quality draft                # fast iteration
npx hyperframes render --fps 60 --quality high        # final delivery
npx hyperframes render --format webm                  # transparent WebM
npx hyperframes render --docker                       # byte-identical
```

> Default `--output` is `renders/<project-name>_<YYYY-MM-DD>_<HH-MM-SS>.<ext>` — timestamped per render so successive runs don't clobber each other. Pass `--output` to get a stable name.

| Flag                                 | Options                                                                                            | Default                        | Notes                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir` (positional)                   | path                                                                                               | cwd                            | Project directory. Omit to use current working directory.                                                                                                                                                                                                                                |
| `--composition`, `-c`                | path to composition file                                                                           | `index.html`                   | Render a specific composition file (e.g. `compositions/intro.html`) instead of the project's `index.html`.                                                                                                                                                                               |
| `--output`, `-o`                     | path                                                                                               | `renders/<project>_<ts>.<ext>` | Output path. Default is timestamped (`<project-name>_YYYY-MM-DD_HH-MM-SS.<ext>`).                                                                                                                                                                                                        |
| `--fps`                              | 24, 30, 60                                                                                         | 30                             | 60fps doubles render time                                                                                                                                                                                                                                                                |
| `--quality`                          | draft, standard, high                                                                              | standard                       | draft for iterating                                                                                                                                                                                                                                                                      |
| `--format`                           | mp4, webm, mov, gif, png-sequence                                                                  | mp4                            | WebM/MOV render with transparency; gif for inline autoplay in GitHub PRs/READMEs/docs (two-pass palette encode, fps capped at 30 — prefer `--fps 15` — no audio, 1-bit transparency only, HDR falls back to SDR); png-sequence writes RGBA frames to a directory (AE/Nuke/Fusion ingest) |
| `--gif-loop`                         | 0-65535                                                                                            | 0                              | GIF loop count; `0` loops forever. Only with `--format gif`.                                                                                                                                                                                                                             |
| `--resolution`                       | landscape, portrait, landscape-4k, portrait-4k, square, square-4k (+ aliases `1080p`, `4k`, `uhd`) | —                              | Supersample via Chrome `deviceScaleFactor`. Aspect ratio must match composition; scale must be an integer. Not with `--hdr`.                                                                                                                                                             |
| `--crf`                              | 0-51                                                                                               | —                              | Encoder CRF (lower = higher quality). Mutually exclusive with `--video-bitrate`.                                                                                                                                                                                                         |
| `--video-bitrate`                    | e.g. `10M`, `5000k`                                                                                | —                              | Target bitrate. Mutually exclusive with `--crf`.                                                                                                                                                                                                                                         |
| `--hdr`                              | flag                                                                                               | off                            | Force HDR output even with SDR sources. MP4 only.                                                                                                                                                                                                                                        |
| `--sdr`                              | flag                                                                                               | off                            | Force SDR even with HDR sources.                                                                                                                                                                                                                                                         |
| `--workers`                          | number or `auto`                                                                                   | auto                           | Each worker spawns Chrome (~256 MB)                                                                                                                                                                                                                                                      |
| `--docker`                           | flag                                                                                               | off                            | Reproducible output across hosts                                                                                                                                                                                                                                                         |
| `--gpu`                              | flag                                                                                               | off                            | GPU-accelerated FFmpeg encoding (NVENC / VideoToolbox / VAAPI / QSV)                                                                                                                                                                                                                     |
| `--browser-gpu` / `--no-browser-gpu` | flag                                                                                               | auto (local), off (docker)     | Host GPU for Chrome/WebGL capture                                                                                                                                                                                                                                                        |
| `--browser-timeout`                  | seconds (0.001–86400)                                                                              | 60                             | Puppeteer page-navigation timeout for the entry HTML. Raise when heavy compositions (many videos / fonts / remote assets) can't reach `domcontentloaded` within the 60s default.                                                                                                         |
| `--quiet`                            | flag                                                                                               | off                            | Suppress verbose output                                                                                                                                                                                                                                                                  |
| `--strict`                           | flag                                                                                               | off                            | Fail on lint errors                                                                                                                                                                                                                                                                      |
| `--strict-all`                       | flag                                                                                               | off                            | Fail on lint errors AND warnings                                                                                                                                                                                                                                                         |
| `--variables`                        | JSON object                                                                                        | —                              | Override values declared in `data-composition-variables`                                                                                                                                                                                                                                 |
| `--variables-file`                   | path                                                                                               | —                              | JSON file with variable values (alternative to `--variables`)                                                                                                                                                                                                                            |
| `--strict-variables`                 | flag                                                                                               | off                            | Fail render on undeclared keys or type mismatches in `--variables`                                                                                                                                                                                                                       |

**Quality guidance:** `draft` while iterating, `standard` for review, `high` for final delivery.

**Parametrized renders:** the composition declares its variables on the `<html>` root with **`data-composition-variables`** — a JSON **array of declarations** (`{id, type, label, default}` per entry) that defines the schema. Scripts inside read the resolved values via `window.__hyperframes.getVariables()`. The CLI `--variables '{"title":"Q4 Report"}'` is a JSON **object keyed by id** that overrides those declared defaults for one render; missing keys fall through, so the same composition runs unchanged in dev preview and in production. Sub-comp hosts can also override per-instance with `data-variable-values`. See the `hyperframes-core` skill for the full pattern.

## publish

```bash
npx hyperframes publish              # upload current project, return public URL
npx hyperframes publish ./my-video   # specific project
npx hyperframes publish --yes        # skip the confirmation prompt (scripts/CI)
```

Uploads the project's source (HTML + assets) and returns a stable public URL that renders in the browser. Use this for sharing a draft for review before rendering MP4, or for embedding the composition elsewhere. Lint findings are surfaced before upload but do not block.
