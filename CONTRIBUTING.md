# Contributing to Hyperframes

Thanks for your interest in contributing to Hyperframes! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/hyperframes.git`
3. Install dependencies: `bun install`
4. Create a branch: `git checkout -b my-feature`

## Development

```bash
bun install        # Install all dependencies
bun run dev        # Run the studio (composition editor)
bun run build      # Build all packages
bun run --filter '*' typecheck   # Type-check all packages
bun run lint       # Lint all packages
bun run format:check   # Check formatting
```

### Running Tests

```bash
bun run --filter @hyperframes/core test          # Core unit tests (vitest)
bun run --filter @hyperframes/engine test        # Engine unit tests (vitest)
bun run --filter @hyperframes/core test:hyperframe-runtime-ci  # Runtime contract tests
```

### Linting & Formatting

```bash
bun run lint            # Run oxlint
bun run lint:fix        # Run oxlint with auto-fix
bun run format          # Format all files with oxfmt
bun run format:check    # Check formatting without writing
```

Git hooks (via [lefthook](https://github.com/evilmartians/lefthook)) run automatically after `bun install` and enforce linting + formatting on staged files before each commit.

## Pull Requests

- Use [conventional commit](https://www.conventionalcommits.org/) format for **all commits** (e.g., `feat: add timeline export`, `fix: resolve seek overflow`). Enforced by a git hook.
- CI must pass before merge (build, typecheck, tests, semantic PR title)
- PRs require at least 1 approval

## Packages

| Package                 | Description                                 |
| ----------------------- | ------------------------------------------- |
| `@hyperframes/core`     | Types, HTML generation, runtime, linter     |
| `@hyperframes/engine`   | Seekable page-to-video capture engine       |
| `@hyperframes/producer` | Full rendering pipeline (capture + encode)  |
| `@hyperframes/studio`   | Composition editor UI                       |
| `hyperframes`           | CLI for creating, previewing, and rendering |

## Releasing (Maintainers)

All packages use **fixed versioning** — every release bumps all packages to the same version.

### Stable releases

```bash
bun run set-version 0.2.0            # bumps all packages, commits, and creates git tag
git push origin main --tags           # triggers the publish workflow
```

The `set-version` script automatically creates a `chore: release v<version>` commit and a `v<version>` git tag. Pushing the tag triggers CI to publish all packages to npm and create a GitHub Release.

### Pre-releases (alpha / beta / rc)

Use a pre-release suffix to publish to a named npm dist-tag instead of `latest`:

```bash
bun run set-version 0.2.0-alpha.1    # first alpha
git push origin v0.2.0-alpha.1       # publishes to npm with --tag alpha

bun run set-version 0.2.0-alpha.2    # iterate
bun run set-version 0.2.0-beta.1     # promote to beta (--tag beta)
bun run set-version 0.2.0-rc.1       # release candidate (--tag rc)
bun run set-version 0.2.0            # final stable release (--tag latest)
```

Consumers install pre-releases with `npm install @hyperframes/core@alpha` (or `@beta`, `@rc`). The `latest` tag is never touched by pre-releases, so `npm install @hyperframes/core` always gets the last stable version.

Pre-releases also create GitHub Releases marked as **pre-release**.

### Options

If you need to bump versions without committing (e.g., for a release PR), pass `--no-tag`:

```bash
bun run set-version 0.2.0 --no-tag   # updates package.json files only
```

## Reporting Issues

- Use [GitHub Issues](https://github.com/heygen-com/hyperframes/issues) for bug reports and feature requests
- Search existing issues before creating a new one
- Include reproduction steps for bugs

## AI-Assisted Contributions

We welcome contributions that use AI tools (GitHub Copilot, Claude, ChatGPT, etc.). If you used AI to help write a PR, there is no need to disclose it — we review all code on its merits. However:

- You are responsible for the correctness of any code you submit, regardless of how it was generated.
- AI-generated tests must actually test meaningful behavior, not just assert truthy values.
- Do not submit AI-generated code you don't understand. If you can't explain what a change does during review, it will be rejected.

## Governance

Hyperframes uses a **BDFL (Benevolent Dictator for Life)** governance model. The core maintainers at HeyGen have final say on the project's direction, API design, and what gets merged. This keeps the project focused and moving fast.

Community input is valued and encouraged — open issues, propose RFCs, and discuss in PRs. But final decisions rest with the maintainers.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the project's license. See [LICENSE](LICENSE) for details.
