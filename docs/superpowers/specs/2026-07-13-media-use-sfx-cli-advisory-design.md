# Media-use SFX CLI advisory design

## Goal

When SFX resolution succeeds through the bundled fallback because the HeyGen CLI is missing or outdated, tell the agent how to restore the broader HeyGen catalog path. Keep bundled fallback successful and never install software automatically.

## Behavior

- Reuse the existing HeyGen CLI error classification produced by the failed catalog provider call.
- Retain only the latest actionable `not_found` or `outdated` remediation for the current resolver process.
- When `bundled.sfx` wins after that failure, include a structured advisory in JSON output and print the same concise hint in human output.
- Use the existing canonical remediation:
  - Missing: install the [HeyGen CLI](https://developers.heygen.com/cli), then run `heygen auth login --oauth`
  - Outdated: `heygen update`
- Do not emit this advisory for authentication, quota, network, or legitimate empty-catalog results; `--local-only`; or an explicitly forced bundled provider.
- Do not execute the install or update command.

## Components

1. `heygen-cli.mjs` records and exposes one process-local actionable remediation alongside the existing logging and telemetry behavior.
2. `resolve.mjs` consumes that remediation only when the winning provider is `bundled.sfx`, then attaches it to the result.
3. The result formatter exposes the advisory consistently to JSON and human consumers.

## Tests

- Missing CLI followed by bundled fallback returns the install advisory.
- Outdated CLI followed by bundled fallback returns the update advisory.
- A healthy CLI with a legitimate catalog miss returns bundled SFX without an install/update advisory.
- `--local-only` and explicit bundled-provider resolution do not suggest installation.
- Existing fallback, registry, skill, format, and manifest checks remain green.

## Safety

This is recommendation-only. It does not cross the software-install consent boundary, run a shell, or turn a successful local fallback into an error.
