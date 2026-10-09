# doctor, browser

Environment diagnosis and bundled-Chrome management. Run these first when a render or preview fails.

## doctor

```bash
npx hyperframes doctor
npx hyperframes doctor --json     # CI / agent output (always exit 0; gate on payload `ok`)
```

Runs independent checks and reports each as ok/warn/fail:

- **Version** — installed CLI vs latest on npm (hints upgrade when stale)
- **Node.js** — ≥ 22 required
- **CPU**, **Memory**, **Disk** — host resources
- **Environment** — env vars that affect the renderer
- **FFmpeg** / **FFprobe** — found, version, codecs
- **Chrome** — bundled or system, version, path
- **Docker** / **Docker running** — required only for `render --docker`
- **/dev/shm** — inside containers only

Run `doctor` first when:

- `render` fails with a Chrome or FFmpeg error.
- `preview` opens but the composition fails to load.
- A fresh machine has never run HyperFrames.

Common issues:

- **Missing FFmpeg** — install via `brew install ffmpeg` (macOS) or your package manager, or [configure existing binaries](#configure-ffmpeg-without-a-package-manager).
- **Missing bundled Chrome** — run `npx hyperframes browser ensure`.
- **Low memory** — close other Chromes, reduce `--workers`, or use `--quality draft`.
- **Chrome exits instantly inside an agent sandbox (macOS)** — seatbelt-style sandboxes
  (e.g. codex `workspace-write`) block Chromium's Mach port bootstrap
  (`MachPortRendezvous`; openai/codex#21292), so every Chrome — bundled, system, or
  headless shell — dies at startup. This is a host-level block, not a HyperFrames or
  Chrome install problem: compile checks and audio still pass, only rendering is
  unavailable. State the blocker and deliver the checked composition; render outside the
  sandbox or via `render --docker` / cloud rendering where available. **Do not build a
  substitute rasterizer** (magick/PIL/SVG frame pipelines) — on a blocked-browser host
  the deliverable IS the checked composition plus this blocker note, and rendering is
  handed to `--docker`, cloud, or the user. Write your final summary the moment the
  blocker is identified, BEFORE any optional fallback work: a later session failure must
  not erase the report of work already done.

### Configure FFmpeg without a package manager

Get FFmpeg and FFprobe binaries for your operating system and architecture from the [FFmpeg download page](https://ffmpeg.org/download.html). Both must be executable. You can use them without Homebrew or a system-wide installation:

```bash
export HYPERFRAMES_FFMPEG_PATH="/absolute/path/to/ffmpeg"
export HYPERFRAMES_FFPROBE_PATH="/absolute/path/to/ffprobe"
npx hyperframes doctor --json
```

Set both variables in the environment that launches HyperFrames. On Windows, point them at `ffmpeg.exe` and `ffprobe.exe` using your shell's environment-variable syntax. A configured path takes precedence over automatic discovery; a missing configured file is reported as missing.

Alternatively, put the binaries in `.hyperframes/bin/ffmpeg` and `.hyperframes/bin/ffprobe` (`.exe` on Windows), then run HyperFrames from that project's directory. Discovery checks `PATH` before this project-local directory, so use the environment variables when you need a particular build.

Verify the **FFmpeg** and **FFprobe** entries in `doctor --json` report `ok: true` and the expected paths. To gate only these encoding dependencies with `jq`:

```bash
npx hyperframes doctor --json | jq -e \
  '[.checks[] | select(.name == "FFmpeg" or .name == "FFprobe")] | length == 2 and all(.ok)'
```

The report's top-level `ok` also includes optional tools such as Docker and local voice providers; those failures do not require installing them for a local video render. Check Chrome separately with the browser commands below.

## browser

```bash
npx hyperframes browser ensure    # find or download the pinned Chrome
npx hyperframes browser path      # print the browser executable path (for scripting)
npx hyperframes browser clear     # remove the cached Chrome download
```

Manage the Chrome build HyperFrames uses for rendering. The pinned version exists because pixel output drifts across Chrome versions — using the bundled build keeps rendered output reproducible across machines.

Use `path` to embed the binary in scripts: `$(npx hyperframes browser path)`.
