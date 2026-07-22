# hyperframes-py

Python SDK for [HyperFrames](https://hyperframes.heygen.com) — write HTML, render video.

HyperFrames turns an HTML page into a deterministic MP4. Its engine is a Node
CLI. This package is a thin, dependency-free wrapper so Python code can drive
it: scaffold a project, generate a composition from your data, render it, get a
`Path` back.

It does **not** reimplement rendering. It discovers the CLI, builds an argv,
runs it as a subprocess, and turns a non-zero exit into an exception carrying
stderr. No network calls, no telemetry — in fact it switches the CLI's own
telemetry *off* on every invocation.

## Install

```bash
pip install hyperframes-py          # imports as `hyperframes`
npm install -g hyperframes          # the renderer itself — Node >= 22
```

The SDK finds the CLI in this order:

1. an explicit `Project(path, cli=...)` argument,
2. `$HYPERFRAMES_CLI` (shell-split, so `export HYPERFRAMES_CLI='npx --yes hyperframes'` works),
3. `hyperframes` on `PATH`,
4. `node_modules/.bin/hyperframes`, walking up from the project directory.

If none resolve you get a `CLINotFoundError` that says how to fix it — and
tells you whether Node is missing too.

## Quickstart

```python
from hyperframes import Project

project = Project.init("promo", example="blank")     # hyperframes init
project.index.write_text("<!doctype html>...")       # your composition
project.run("lint")                                  # optional gate
mp4 = project.render("promo.mp4", fps=30, quality="high")
print(mp4)                                           # /abs/path/promo/promo.mp4
```

Already have a project? Skip `init`:

```python
Project("./my-video").render()      # -> my-video/renders/my-video.mp4
```

## API

### `Project(path, *, cli=None, env=None)`

A composition directory — a folder containing `index.html`. `env` is layered
over the SDK's defaults for every call.

| Attribute | |
|---|---|
| `.path` | absolute `Path` to the directory |
| `.name` | directory basename (what the CLI calls the project name) |
| `.index` | `Path` to `index.html` |
| `.exists()` | whether `index.html` is there |

### `Project.init(path, *, example="blank", cli=None, env=None, timeout=None, **opts) -> Project`

Scaffolds via `hyperframes init` and returns the handle. `"blank"` ships with
the CLI; any other example is downloaded from the registry. Extra flags pass
through: `resolution="portrait"`, `tailwind=True`, `video="clip.mp4"`.

Non-interactive mode is forced — see [Quirks](#cli-quirks-worth-knowing).

### `.render(output=None, *, format="mp4", timeout=None, **opts) -> Path`

Renders and returns the artifact path. Raises if the CLI fails, or if it exits
0 without producing a file.

- `output` — relative paths resolve against the **project directory**. Default
  is `renders/<name>.<ext>`.
- `format` — `mp4` | `webm` | `mov` | `gif` | `png-sequence` (a directory).
- `**opts` — any other `hyperframes render` flag, in snake_case:

  | Python | CLI |
  |---|---|
  | `fps=60` | `--fps 60` |
  | `quality="high"` | `--quality high` |
  | `composition="scenes/intro.html"` | `--composition scenes/intro.html` |
  | `resolution="portrait"` | `--resolution portrait` |
  | `variables={"title": "Hi"}` | `--variables '{"title":"Hi"}'` |
  | `strict=True` | `--strict` |
  | `page_side_compositing=False` | `--no-page-side-compositing` |
  | `anything=None` | *(omitted)* |

  The mapping is generic, so every current and future render flag is reachable
  without an SDK release. `quiet=True` is the default; pass `quiet=False` to
  see progress.

### `.preview(*, port=3002, open_browser=False, background=False, timeout=None) -> str | None`

Starts the studio preview server. Blocking by default (streams to your
terminal, returns `None` on exit). With `background=True` it returns
immediately with the server URL.

### `.stop_preview(*, port=3002)`

Stops the background server for this project.

### `.run(*args, timeout=None, check=True) -> subprocess.CompletedProcess`

Escape hatch to any subcommand, run with the project as cwd:

```python
project.run("lint")
project.run("check")
project.run("compositions", "--json")
project.run("lint", check=False).returncode    # inspect instead of raise
```

### Errors

```python
from hyperframes import HyperframesError, CLINotFoundError   # CLINotFoundError subclasses it

try:
    project.render(quality="maximum")
except HyperframesError as error:
    error.command      # ['/usr/bin/hyperframes', 'render', ...]
    error.returncode   # 1
    error.stderr       # 'Invalid quality ...'
```

### `cli_version() -> str`

Version of the resolved CLI. Cheap enough to use as a health probe — the CLI
short-circuits `--version` before loading anything.

## CLI quirks worth knowing

Four behaviours the SDK papers over. They're the reason some of this code
exists.

1. **Output paths resolve against the process cwd, not the project dir.** The
   CLI does `resolve(args.output)` and `resolve("renders")` against
   `process.cwd()`. The SDK always passes an absolute `--output` and runs with
   the project as cwd, so a relative `output=` means what you'd expect.
2. **The default filename is timestamped** (`renders/<name>_<ts>.mp4`), so it
   can't be predicted. The SDK therefore *always* passes `--output` — which is
   why `render()` can return a `Path` at all.
3. **`hyperframes init` prompts only when stdout is a TTY.** From a subprocess
   it never is, and in non-interactive mode it *requires* one of `--example` /
   `--video` / `--audio`. `Project.init` passes `--example blank` and
   `--non-interactive` so it can't hang or fail on that.
4. **`--json` on `render` is batch-only.** A single render has no
   machine-readable output, so the SDK relies on the exit code plus the path it
   supplied, and checks the artifact landed.

## Limitations

- **Not a binding.** Every call is a process spawn. Fine for batch jobs and web
  backends; don't put it in a hot loop.
- **No streaming progress.** `render()` returns when the process exits. Pass
  `quiet=False` and capture the CLI's own output if you need progress.
- **Renders are synchronous and can be slow.** `timeout=` defaults to none;
  set one if you're rendering untrusted input.
- **Blocking `preview()` owns the terminal** until interrupted. Use
  `background=True` from a script.
- **No composition authoring helpers.** Compositions are HTML; build them with
  whatever templating you already use (see `examples/02_render_from_data.py`).
- **Node >= 22 required** by the CLI, enforced before it loads. On older Node
  every call fails with that message on `.stderr`.

## Examples

```bash
python examples/01_render_example.py     # render an example composition
python examples/02_render_from_data.py   # data dict -> composition -> MP4
```

## Development

```bash
pip install -e ".[dev]"
pytest                # unit tests — fully mocked, no CLI or Node needed
pytest -m integration # one real render; auto-skips without Node >= 22 + CLI
```

## License

Apache-2.0, matching the parent project.
