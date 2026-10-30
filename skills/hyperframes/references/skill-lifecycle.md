# Skill installation and freshness

Read this reference when installing or updating skills, diagnosing unexpected skill behavior, or running HyperFrames setup in CI.

For a plugin installation, follow [plugin execution rules](plugin-installation.md); the plugin manager owns updates and every skill is bundled. The commands below apply only to standalone skills.

- **Core set, installed eagerly:** `/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry` and `/media-use`.
- **On demand:** `/figma`, `/slideshow` and `/remotion-to-hyperframes`, installed with `npx hyperframes skills update <name>`.

## What `init` does

`npx hyperframes init` installs the core set when it is missing and leaves every skill that is already installed as it is: it never refreshes, replaces or removes one. Updating is `npx hyperframes skills update`, run by you. Offline or rate-limited checks degrade gracefully and do not fail project scaffolding.

`--skip-skills` makes `init` leave skills alone. `HYPERFRAMES_SKIP_SKILLS=1` does the same for CI and tests.

`HYPERFRAMES_SKIP_SKILLS=1` also makes `skills update` (bare or named) and bare `skills` exit 0 without installing, so an install pinned to one commit stays pinned.

## Stale-skills notice

After `render`, `lint` and `validate`, the CLI prints `N HyperFrames skills out of date or missing` to stderr when the cached check finds stale skills, so an agent run without a terminal sees it too. It is off in CI, in dev, with `HYPERFRAMES_NO_UPDATE_CHECK=1` and with `HYPERFRAMES_SKIP_SKILLS=1`, and runs with `--json` too, since it only writes stderr and leaves `--json` stdout untouched.

## Diagnose and update

```bash
npx hyperframes skills check
npx hyperframes skills check --json
npx hyperframes skills update
npx hyperframes skills update <name>
npx hyperframes skills
```

- `skills check` exits non-zero when an installed skill is stale or the core set is incomplete. Skills available on demand but not installed are not failures.
- Bare `skills update` refreshes the core set and the HyperFrames skills already installed. It never removes a skill, and it leaves a skill the install record attributes to another publisher alone, even when the name matches one of ours.
- Named `skills update <name...>` also installs those named skills.
- Bare `skills` installs the full published set explicitly.

If the HyperFrames CLI is unavailable, use `npx skills add heygen-com/hyperframes --skill <name>` for one skill or `npx skills add heygen-com/hyperframes --all` for the full published set.

The CLI may print a one-line stale-skill reminder during `render`, `lint`, or `check`. Treat a failed update as a visible tool failure; do not continue from a remembered skill.

## Keep the project's CLI current

A scaffolded project pins `hyperframes@<version>` in its `package.json` scripts so renders stay reproducible; the pin never advances on its own, and a pinned run of an older CLI prints no warning about it. When resuming a project whose scripts carry a pin, probe once before the first render-affecting command:

```bash
npx hyperframes@latest upgrade --project . --check
```

The probe is read-only and reports the pin against the latest release; keep the explicit `.` — on older CLI releases a bare `--project` followed by another flag consumes that flag as its directory value. When it reports the project behind — or any CLI output already shows it (the stderr notice `This project pins hyperframes@… (latest …)`, or `_meta.updateAvailable: true` in a `--json` result from a pinned script) — apply with `npx hyperframes@latest upgrade --project .`, then verify with `npx hyperframes check`. A passing check confirms the project's compositions still validate on the new version — not that rendered output is frame-identical to the old pin — so a successful bump is never silent: name the old and new version in the run's summary. A project with no composition yet needs no verification. If the check fails, revert the `package.json` change, continue on the pinned version, and report which version the project stays on and why. Act on the signal rather than relaying it to the user; never leave a bumped pin unverified.
