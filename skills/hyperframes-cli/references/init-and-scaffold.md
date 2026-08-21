# init, capture, skills

Scaffolding commands. Use these instead of creating files by hand — they set up the right file structure, copy media, run transcription, and install AI coding skills.

## init

```bash
npx hyperframes init my-video                                    # TTY: interactive wizard
npx hyperframes init my-video --example warm-grain               # pick an example
npx hyperframes init my-video --example blank --resolution portrait
npx hyperframes init my-video --video clip.mp4                   # with video file
npx hyperframes init my-video --audio track.mp3                  # with audio file
npx hyperframes init my-video --example blank --tailwind         # Tailwind v4 browser runtime
npx hyperframes init my-video --non-interactive --example blank  # CI/agents — flag-only
```

**Default depends on TTY**: in a terminal, the CLI prompts for example/options. Outside a TTY (CI, agents, piped output) it auto-switches to non-interactive and **requires `--example`** (the CLI errors with a usage example if missing). Pass `--non-interactive` to force flag-only mode even on a TTY.

Templates: `blank`, `warm-grain`, `play-mode`, `swiss-grid`, `vignelli`, `decision-tree`, `kinetic-type`, `product-promo`, `nyt-graph`.

Other useful flags:

- `--resolution` — preset: `landscape` (1920×1080), `portrait` (1080×1920), `landscape-4k`, `portrait-4k`, `square` (1080×1080), `square-4k`. Aliases: `1080p`, `4k`, `uhd`, `1080p-square`, `4k-square`.
- `--skill=<slug>` — record the owning authoring workflow (e.g. `product-launch-video`) in `hyperframes.json`, so every later render of this project — re-renders, `npm run render`, `--batch` — is attributed to it on anonymous telemetry without re-passing the flag. Creation workflows set this automatically; you rarely pass it by hand.
- `--skip-skills` — **temporarily ignored**: `init` always checks AI coding skills against GitHub while the skills.sh registry catches up. To opt out (CI/tests), set the `HYPERFRAMES_SKIP_SKILLS=1` env var instead.
- `--skip-transcribe` — don't auto-transcribe `--audio` / `--video` with Whisper.
- `--model`, `--language` — Whisper model / language for the auto-transcription.

When using `--tailwind`, invoke the `hyperframes-core` (Tailwind reference) skill before editing classes or theme tokens. The scaffold uses Tailwind v4 browser runtime patterns, not Studio's Tailwind v3 setup.

When `--audio` or `--video` is supplied, `init` transcribes the file with Whisper. For voice/model selection see the `media-use` skill.

## capture

```bash
npx hyperframes capture https://stripe.com                  # scaffold from a website
npx hyperframes capture https://linear.app -o linear-video  # custom output directory
npx hyperframes capture https://example.com --json          # JSON output for agents
npx hyperframes capture https://example.com --skip-assets   # skip image/SVG download
npx hyperframes capture https://example.com --skip-vision   # skip optional AI captions
npx hyperframes capture https://example.com --max-screenshots 12
npx hyperframes capture https://example.com --timeout 60000 # page-load timeout in ms
npx hyperframes capture https://example.com --capture-budget 90000 # post-navigation budget
```

Captures a live URL as an editable HyperFrames project: screenshots become layered scenes, assets are downloaded locally, and the result is a normal project you can `lint` / `preview` / `render`. Use this when the user supplies a URL as the starting point for a video.

`--timeout` bounds page navigation; `--capture-budget` is the separate cooperative budget for work
after navigation (fonts, assets, vision, and contact sheets). The latter is not a hard wall-clock
watchdog and cannot interrupt native work already in flight. An outer caller deadline is therefore a
third, distinct timeout. An outer caller timeout leaves the capture result unknown; it does not prove
HyperFrames hung or that the navigation timeout should be increased. Preserve the last phase and
classify the boundary that fired. `--skip-vision` disables only optional AI image captioning.

For agents, use `--json`. The result includes `ok`, warnings, and `lastPhase`. The command also emits
stable `HYPERFRAMES_CAPTURE_PHASE` records so a watchdog can report the last started, completed, or
degraded phase without retaining sensitive payloads.

Treat a non-zero exit, JSON `ok: false`, or an output `BLOCKED.md` as a **hard stop**. Do not render,
build, or infer brand/design data from partial files in a blocked capture. A successful capture may
degrade an optional phase within budget, but its structural output still has to satisfy the owning
workflow's gate. Exit zero and file existence alone are not semantic success: require the current
invocation's JSON `ok: true`, no `BLOCKED.md`, and artifacts usable for that workflow. Run each retry
into a fresh output directory; never merge or reuse a blocked attempt's partial output.

## skills

```bash
npx hyperframes skills    # install HyperFrames skills for AI coding tools
```

One-time setup that adds the HyperFrames skill pack (`hyperframes-core`, `-creative`, `-animation`, `-cli`, `-registry`, `-media`, plus the `product-launch-video` and `hyperframes` orchestrators) to the local AI coding environment so agents follow the framework conventions. Re-run after major HyperFrames upgrades.
