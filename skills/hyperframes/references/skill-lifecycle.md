# Skill installation and freshness

Read this reference when the person asks about installing or updating skills, when diagnosing unexpected skill behavior, or when setting up HyperFrames in CI (see `HYPERFRAMES_SKIP_SKILLS` below). Skills are versioned with the CLI. Installing, updating and removing them is the person's step: tell them what is out of date and which command fits, and do not run it yourself.

For a plugin installation, follow [plugin execution rules](plugin-installation.md); the plugin manager owns updates and every skill is bundled. The commands below apply only to standalone skills.

- **Core set:** `/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry`, `/media-use`, `/reverse-any-video` and `/style-sampling`.
- **On demand:** `/figma`, `/slideshow` and `/remotion-to-hyperframes`, which the person installs with `npx hyperframes skills update <name>`.

## What `init` does

Without `--skip-skills`, `npx hyperframes init` installs the core set when it is missing and leaves every skill that is already installed as it is: it never refreshes, replaces or removes one. Installing the core set is the person's step, so pass `--skip-skills` whenever you run `init`. When a core skill is missing, tell the person to run `npx hyperframes skills update`, which also updates the skills already installed. Offline or rate-limited checks degrade gracefully and do not fail project scaffolding.

`--skip-skills` makes `init` leave skills alone. `HYPERFRAMES_SKIP_SKILLS=1` does the same for CI and tests.

`HYPERFRAMES_SKIP_SKILLS=1` also makes `skills update` (bare or named) and bare `skills` exit 0 without installing, so an install pinned to one commit stays pinned.

## Stale-skills notice

After `render`, `lint` and `validate`, the CLI prints `N HyperFrames skills out of date or missing` to stderr when the cached check finds stale skills, so an agent run without a terminal sees it too. It is off in CI, in dev, with `HYPERFRAMES_NO_UPDATE_CHECK=1` and with `HYPERFRAMES_SKIP_SKILLS=1`, and runs with `--json` too, since it only writes stderr and leaves `--json` stdout untouched.

## Diagnose, and what the person can run

```bash
npx hyperframes skills check
npx hyperframes skills check --json
```

The person's install and update commands, to name when you relay a stale result:

```bash
npx hyperframes skills update           # the person runs this
npx hyperframes skills update <name>    # the person runs this
npx hyperframes skills                  # the person runs this
```

- `skills check` exits non-zero when an installed skill is stale or the core set is incomplete. Skills available on demand but not installed are not failures.
- Bare `skills update` refreshes the core set and the HyperFrames skills already installed. It never removes a skill, and it leaves a skill the install record attributes to another publisher alone, even when the name matches one of ours.
- Named `skills update <name...>` also installs those named skills.
- Bare `skills` installs the full published set explicitly.

If the HyperFrames CLI is unavailable, the person can install with `npx skills add heygen-com/hyperframes --skill <name>` for one skill or `npx skills add heygen-com/hyperframes --all` for the full published set.

The CLI may print a one-line stale-skill reminder during `render`, `lint`, or `check`. Relay it to the person and keep working from the installed skills; do not continue from a remembered skill.

## Keep the project's CLI current

For standalone skills, use the launcher from the loaded skill installation. Plugins keep their bundled CLI.

A scaffolded project pins `hyperframes@<version>` in its `package.json` scripts so renders stay reproducible; the pin never advances on its own, and a pinned run of an older CLI prints no warning about it. When resuming a project whose scripts carry a pin, probe once before the first render-affecting command:

```bash
node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version latest upgrade --project . --check
```

The probe reads the current pin and the latest release. Keep the explicit `.` so older releases parse the project directory correctly. If the probe, the stale-pin notice, or the JSON update metadata shows the project is behind, apply the upgrade. Then use the exact version the upgrade reported to check the project:

```bash
node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version latest upgrade --project .
node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version <new-version> check
```

Report the old and new versions. The check validates the compositions. A project with no compositions yet can skip it. If validation fails, revert the pin changes, report the reason and continue with the original exact version if the launcher supports it.
