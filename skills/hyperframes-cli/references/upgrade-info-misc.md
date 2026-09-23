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

Text output is `timeline <N>s`, then one block per track kind (`video`, `graphics`, `captions`, `audio`) with one row per clip of that kind, ordered by absolute start:

```
graphics (2: 1 top-level, 1 nested)
  |██████                                  | sec-connector 0-6.7s src=compositions/connector-morph.html
  |██████████████                          | box 15.67-17.99s (local 0-2.32s) nested in sec-connector compositions/connector-morph.html
audio (1)
  | █                                      | vo 1.6-3.6s src=vo.mp3 vol=0.5 group=vo volume[0:0.2 2:1]
```

- The bar is 40 columns over the whole timeline. Times are seconds.
- `src=`, `vol=`, `rate=` (playback rate, only when not 1), `group=` (audio group), and `<target>[t:v ...]` (automation lane points, `t` in seconds from the clip start) appear only when the clip has them.
- The header counts every clip of that kind, nested ones included: `video (6: 2 top-level, 4 nested)`. The list is in absolute order, so the Nth row is the Nth clip of that kind on the main timeline. A clip inside a sub-composition prints its absolute start-end, then `(local <start>-<end>s)` (time inside that sub-composition), then `nested in <host row id> <file that declares it>`. Only one level of nesting is read: a sub-composition inside a sub-composition is listed as a row saying `children=unread`, and the clips inside it are not counted.
- With no `data-duration`/`data-end`, a media row still gets a resolved length and says where it came from: `duration=media` means ffprobe measured the source (with playback start and rate applied); `duration=default` means an `img` got the 3s default; `duration=inferred` means a composition host summed its children; `pending: <reason>` (dotted bar, `duration` 0) means the source could not be probed (missing file, remote `src`, ffprobe error). A non-media leaf with nothing to resolve prints no source.
- `lanes unreadable: ...` means the clip's `data-automation` or `data-fx-chain` did not parse; fix the attribute.

`--json` prints `{ timeline: { duration, tracks: [{ kind, rows: [...] }] } }`. A track's `rows` are every clip of that kind, nested ones included, by `absStart`; read them, never only the top level. Each row has `id`, `kind` (tag), `trackKind`, `start`, `duration`, `end` (local to the row's own file), **`absStart`, `absEnd`, `file`** (main-timeline time and the project-relative file that declares the clip — use these, not `start`/`end`, to compare clips across nesting), `trackIndex`, `src`, `sourceFile`, `volume`, `lanes`, `playbackRate`, `audioGroup`, `durationAuthored`, **`durationSource`** (`"authored" | "media" | "default" | "inner" | "pending"`, or `null` for a non-media leaf with nothing to resolve), **`pendingReason`** (why nothing resolved; `null` unless `durationSource` is `"pending"`), `laneError`, **`index`** (the row's position in its kind's `rows`; a position, not an id), **`nested`** (declared inside a sub-composition), **`host`** (plain id of the row that hosts a nested clip, else `null`), **`hostRow`** (`{kind, index}` of that host row), and `children` (`{kind, index}` pointers to the sub-composition's clips, one level; every clip is already a full row in its kind's `rows`, so nothing needs following).

### Query one-liners (jq, node fallback if jq is absent)

```bash
TL=$(npx hyperframes timeline --json)
# 1. what plays at absolute time T=12.5
jq --argjson t 12.5 '[.timeline.tracks[].rows[] | select(.absStart<=$t and .absEnd>$t)]' <<<"$TL"
node -e 'const t=12.5,j=JSON.parse(require("fs").readFileSync(0,"utf8"));j.timeline.tracks.forEach(tr=>tr.rows.forEach(x=>{if(x.absStart<=t&&x.absEnd>t)console.log(x.id,x.file)}))' <<<"$TL"
# 2. find a clip by id or src -> file, track, absStart, absEnd
jq --arg q tsfx-pet2 '[.timeline.tracks[].rows[] | select(.id==$q or .src==$q)] | .[] | {file,trackKind,absStart,absEnd}' <<<"$TL"
node -e 'const q="tsfx-pet2",j=JSON.parse(require("fs").readFileSync(0,"utf8"));j.timeline.tracks.forEach(tr=>tr.rows.forEach(x=>{if(x.id===q||x.src===q)console.log(x.file,x.trackKind,x.absStart,x.absEnd)}))' <<<"$TL"
# 3. every clip of one kind, nested included, in absolute order
jq --arg k video '.timeline.tracks[] | select(.kind==$k).rows[] | {id,absStart,absEnd}' <<<"$TL"
node -e 'const k="video",j=JSON.parse(require("fs").readFileSync(0,"utf8"));j.timeline.tracks.find(t=>t.kind===k).rows.forEach(r=>console.log(r.id,r.absStart,r.absEnd))' <<<"$TL"
# 4. gaps and overlaps within a kind (positive = gap, negative = overlap)
jq --arg k video '(.timeline.tracks[] | select(.kind==$k).rows) as $r|[range(0;($r|length)-1)|{a:$r[.].id,b:$r[.+1].id,delta:($r[.+1].absStart-$r[.].absEnd)}]' <<<"$TL"
node -e 'const k="video",j=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=j.timeline.tracks.find(t=>t.kind===k).rows;for(let i=0;i<r.length-1;i++)console.log(r[i].id,r[i+1].id,r[i+1].absStart-r[i].absEnd)' <<<"$TL"
# 5. the Nth clip of a kind by absolute start (N=2)
jq --arg k video --argjson n 2 '.timeline.tracks[] | select(.kind==$k).rows[$n-1] | {index,id,absStart,file,nested}' <<<"$TL"
node -e 'const k="video",n=2,j=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=j.timeline.tracks.find(t=>t.kind===k).rows[n-1];console.log(r.index,r.id,r.absStart,r.file)' <<<"$TL"
```

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
