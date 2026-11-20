# Unattended runs

Scripts, CI and scheduled jobs call the CLI with no TTY. Nothing prompts there: the CLI exits 2 and names the flag (`--yes`) instead of asking, and `npx` skips its own `Ok to proceed?` prompt whenever stdin is not a terminal or CI is detected — it prints a warning and installs. What can still fail is the install itself.

## Bare `npx hyperframes` installs on every cold cache

With no version, `npx` asks the registry for the latest release on every run and installs it under `~/.npm/_npx/<hash>/` when it is not there yet. Two consequences for a job nobody is watching:

- Two runs that start together race in npm's cache (`_cacache` for the fetch, `_npx` for the install). One can fail with `EEXIST` or `ENOTEMPTY` while the other is still writing; a retry succeeds, because by then the install is in place.
- A new release changes what the same command renders, silently.

## Pin the release

- From a skill, run the CLI through the launcher with an exact release: `node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version <exact-version> <command>` ([rules](../../hyperframes/references/plugin-installation.md)). Take the version from the person or from `--cli-version latest --version`, never from the project's own files.
- An agent keeps using the launcher, which refuses releases below its floor and starts npm in the home folder. It does not run a project's `npm run` scripts, install the CLI into the project, or use a release the project's files name, unless the person asks for that command by name. A project from someone else is never run through its own scripts, pins, `.npmrc` or `node_modules`.
- A person's own pipeline, on a project they wrote, may skip the launcher. A scaffolded project (`hyperframes init`) ships `npm run dev|check|render|publish`, each pinned (`npx …hyperframes@<version>…`) to the release that created the project. Their pipeline can run those, or install once — `npm i hyperframes@<version>` then `node_modules/.bin/hyperframes <command>`, or `npm i -g hyperframes@<version>` then `hyperframes <command>` — and skip the fetch and the cache race altogether. That is the person's setup, not a route for an agent.

Interactive sessions float on purpose: `update` moves an `npx` user to the latest release, and the reverse-any-video skill moves to `--cli-version latest` when the installed CLI is behind. That is a person's call at a terminal. An unattended job pins.

## Verify the output before anything consumes it

Nobody watches an unattended render, so check it the way the loop's step 5 does before it ships downstream: `ffprobe` the file and confirm the dimensions match the project's `data-width`/`data-height` and the duration matches the root `data-duration`.
