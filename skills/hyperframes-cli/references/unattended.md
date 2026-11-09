# Unattended runs

Scripts, CI and scheduled jobs call the CLI with no TTY. Nothing prompts there: the CLI exits 2 and names the flag (`--yes`) instead of asking, and `npx` skips its own `Ok to proceed?` prompt whenever stdin is not a terminal or CI is detected — it prints a warning and installs. What can still fail is the install itself.

## Bare `npx hyperframes` installs on every cold cache

With no version, `npx` asks the registry for the latest release on every run and installs it under `~/.npm/_npx/<hash>/` when it is not there yet. Two consequences for a job nobody is watching:

- Two runs that start together race in npm's cache (`_cacache` for the fetch, `_npx` for the install). One can fail with `EEXIST` or `ENOTEMPTY` while the other is still writing; a retry succeeds, because by then the install is in place.
- A new release changes what the same command renders, silently.

## Use the project's scripts, or pin

- A scaffolded project (`hyperframes init`) already ships `npm run dev|check|render|publish`; each is `npx --yes hyperframes@X.Y.Z`, pinned to the version that created the project. Jobs run those.
- Outside a project, pin the same way: `npx --yes hyperframes@X.Y.Z`. To skip the fetch and the cache race altogether, install once — `npm i hyperframes@X.Y.Z` then `node_modules/.bin/hyperframes <command>`, or `npm i -g hyperframes@X.Y.Z` then `hyperframes <command>`.

Interactive sessions float on purpose: `update` moves an `npx` user to `npx hyperframes@latest`, and the reverse-any-video skill runs `npx -y hyperframes@latest` when the installed CLI is behind. That is a person's call at a terminal. An unattended job pins.

## Verify the output before anything consumes it

Nobody watches an unattended render, so check it the way the loop's step 5 does before it ships downstream: `ffprobe` the file and confirm the dimensions match the project's `data-width`/`data-height` and the duration matches the root `data-duration`.
