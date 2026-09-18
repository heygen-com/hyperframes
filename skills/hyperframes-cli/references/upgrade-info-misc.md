# info, upgrade, compositions, timeline, docs, benchmark, telemetry, asset preprocessing

Catch-all reference for commands that don't fit the main dev loop.

## info

```bash
npx hyperframes info                   # project metadata
npx hyperframes info ./my-video        # specific project
npx hyperframes info --json
```

Prints **project** metadata: name, resolution, duration, element counts by type, track count, and total project size. Project-level — not environment. For environment health use `doctor`.

## upgrade

```bash
npx hyperframes upgrade                # check + interactive prompt
npx hyperframes upgrade --check        # check and exit, no prompt (agent-friendly)
npx hyperframes upgrade --check --json # machine-readable: current / latest / updateAvailable
npx hyperframes upgrade --yes          # print upgrade commands without prompting
```

Compares the installed CLI version against npm latest.

`--project [dir]` bumps a **project's** pinned scripts instead of the global install: it rewrites every `npx …hyperframes@<version>…` in `<dir>/package.json` (default cwd) to npm-latest. Always invoke it unpinned (`npx hyperframes@latest upgrade --project`) — a project scaffolded on an old CLI stays frozen otherwise. `--project . --check` reports the delta without writing; add `--json` for `{ changed, from, to, path }`. Pass the dir explicitly whenever another flag follows `--project` — on older releases a bare `--project` consumes the next flag as its directory value.

## timeline

```bash
npx hyperframes timeline [project-dir]          # tracks and clips as a table with bars
npx hyperframes timeline [project-dir] --json
```

Reach for `timeline` instead of opening `index.html` and each `data-composition-src` file when you need to know what is on the timeline: which clips exist, when they start and end, what they play, and how loud. It reads the project's files statically (no browser).

Text output is `timeline <N>s`, then one block per track kind (`video`, `graphics`, `captions`, `audio`) with a row per top-level element:

```
graphics (2)
  |██████                                  | sec-connector 0-6.7s src=compositions/connector-morph.html
    |██████████████                          | box 0-2.32s
audio (1)
  | █                                      | vo 1.6-3.6s src=vo.mp3 vol=0.5 group=vo volume[0:0.2 2:1]
```

- The bar is 40 columns over the whole timeline. Times are seconds.
- `src=`, `vol=`, `rate=` (playback rate, only when not 1), `group=` (audio group), and `<target>[t:v ...]` (automation lane points, `t` in seconds from the clip start) appear only when the clip has them.
- Clips of a sub-composition are indented one level, with times local to that sub-composition. Deeper nesting is not expanded.
- `duration=unauthored` (dotted bar) means the element has no `data-duration`/`data-end`, so its length is only known at render time (typically media). Add a `data-duration` if the length matters.
- `lanes unreadable: ...` means the clip's `data-automation` or `data-fx-chain` did not parse; fix the attribute.

`--json` prints `{ timeline: { duration, tracks: [{ kind, rows: [...] }] } }`. Each row has `id`, `kind` (tag), `trackKind`, `start`, `duration`, `end`, `trackIndex`, `src`, `sourceFile`, `volume`, `lanes`, `playbackRate`, `audioGroup`, `durationAuthored`, `laneError`, and `children` (the sub-composition's rows).

## compositions, docs

```bash
npx hyperframes compositions           # list compositions in project
npx hyperframes compositions --json
npx hyperframes docs                   # list available topics
npx hyperframes docs rendering         # print one topic inline in the terminal
```

`compositions` lists every `data-composition-id` in the project (including sub-comps) with duration, resolution, and element count.

`docs` prints inline documentation **in the terminal** — it does not open a browser. Topics: `data-attributes`, `examples`, `rendering`, `gsap`, `troubleshooting`, `compositions`. Run without a topic to see the list.

## benchmark

```bash
npx hyperframes benchmark              # run the preset matrix in current project
npx hyperframes benchmark ./my-video   # specific project
npx hyperframes benchmark --runs 5     # repeat each config N times (default 3)
npx hyperframes benchmark --json
```

Renders the project with 5 preset configurations — `30fps draft 2w`, `30fps standard 2w`, `30fps high 2w`, `30fps standard 4w`, `60fps standard 4w` — and prints a comparison of render speed and output file size. Use it to find the fastest acceptable preset for your machine. Not a single-render-with-stage-breakdown.

## telemetry

```bash
npx hyperframes telemetry status      # show telemetry state
npx hyperframes telemetry disable     # disable anonymous usage telemetry
npx hyperframes telemetry enable      # re-enable telemetry
```

Telemetry is anonymous usage counters only. Disable globally with `HYPERFRAMES_NO_TELEMETRY=1` if env-var control is preferred over the subcommand.

Events include two fingerprint properties used to distinguish managed-sandbox runs from real laptops — no PII, no env-var **values**, only existence checks:

- **`sandbox_runtime`**: `gvisor` / `firecracker` / `docker` / `kvm` / `wsl` / `null`. gVisor via kernel string + `/proc/version`. Firecracker via `/dev/vsock` + DMI sys_vendor. Docker via `/.dockerenv` + cgroup.
- **`agent_runtime`**: `claude_code` / `codex` / `cursor` / `copilot_agent` / `jules` / `replit` / `devin` / `aider` / `gemini_cli` / `hermes` / `openclaw` / `null`. Detected by the existence of well-known vendor env vars; the values themselves are never read.

## Asset Preprocessing

```bash
npx hyperframes tts
npx hyperframes transcribe
npx hyperframes remove-background
```

These produce assets (narration audio, word-level transcripts, transparent video) that get dropped into a composition. Each may download its own model on first run.

For voice selection, Whisper model rules, output format choice, and the TTS → transcript → captions chain, invoke the `media-use` skill. This skill stays focused on the dev loop.
