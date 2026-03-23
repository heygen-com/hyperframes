# Contributing to Hyperframes

Thanks for your interest in contributing to Hyperframes! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/hyperframes.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b my-feature`

## Development

```bash
pnpm install        # Install all dependencies
pnpm dev            # Run the studio (composition editor)
pnpm build          # Build all packages
pnpm -r typecheck   # Type-check all packages
pnpm lint           # Lint all packages
pnpm format:check   # Check formatting
```

### Running Tests

```bash
pnpm --filter @hyperframes/core test          # Core unit tests (vitest)
pnpm --filter @hyperframes/engine test        # Engine unit tests (vitest)
pnpm --filter @hyperframes/core test:hyperframe-runtime-ci  # Runtime contract tests
```

### Linting & Formatting

```bash
pnpm lint            # Run oxlint
pnpm lint:fix        # Run oxlint with auto-fix
pnpm format          # Format all files with oxfmt
pnpm format:check    # Check formatting without writing
```

Git hooks (via [lefthook](https://github.com/evilmartians/lefthook)) run automatically after `pnpm install` and enforce linting + formatting on staged files before each commit.

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

### Via GitHub UI (recommended)

1. Go to **Actions** → **Prepare Release** → **Run workflow**
2. Enter the version (e.g., `0.2.0`)
3. Click **Run workflow** — this creates a release PR
4. Review and merge the PR
5. Merging auto-creates the `v0.2.0` tag, which triggers npm publish and a GitHub Release

### Via CLI

```bash
# Bump versions, commit to a branch, create PR
pnpm set-version 0.2.0
git checkout -b release/v0.2.0
git add packages/*/package.json
git commit -m "chore: release v0.2.0"
git push origin release/v0.2.0
gh pr create --title "chore: release v0.2.0" --base main
# After merge, the tag + publish happen automatically
```

## Reporting Issues

- Use [GitHub Issues](https://github.com/heygen-com/hyperframes/issues) for bug reports and feature requests
- Search existing issues before creating a new one
- Include reproduction steps for bugs

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
