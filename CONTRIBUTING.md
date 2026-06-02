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

#### Type-safety conventions

We aim for honest types — code that lies to the compiler eventually lies to users. The underlying convention is:

- **Avoid `any`.** Use `unknown` and narrow it where possible.
- **Avoid `as T` type assertions.** They suppress type-checker warnings without telling the compiler anything new. Prefer:
  - Type guards (`function isFoo(x): x is Foo`)
  - `instanceof` / `typeof` narrowing
  - Centralized narrowing helpers (e.g. `resolveIframe`)
  - Properly-typed interfaces at the source
- **Acceptable `as` use, with a comment explaining why:**
  - `as const` — literal narrowing; always safe
  - `as unknown as T` — explicit double-cast at hard type-system boundaries (e.g. parsing untrusted JSON, FFI/postMessage). Pair with a one-line justification.
- **Avoid `!` non-null assertions** outside of post-`if`-checked code paths. Use `??` defaults or guard clauses instead.

If you must add a cast, add a comment:

```ts
// `postMessage` data is `unknown`; the runtime guarantees this shape.
const event = data as unknown as RuntimeEvent;
```

## Adding Registry Items (Blocks & Components)

The registry at `registry/` contains reusable items installable via `hyperframes add <name>`. Each item lives in its own directory under `registry/blocks/` or `registry/components/`.

### Directory structure

```
registry/blocks/<name>/
  registry-item.json     # Manifest (name, type, description, tags, files)
  <name>.html            # The composition HTML

registry/components/<name>/
  registry-item.json     # Manifest (no dimensions/duration for components)
  <name>.html            # The snippet HTML to paste into a composition
  demo.html              # Required — standalone demo showing the effect
```

### The `demo.html` convention

Every **component** must ship a companion `demo.html`. This file:

1. Is a complete, standalone HTML document (with `<!doctype html>`, GSAP CDN, etc.)
2. Shows the component effect applied to representative content
3. Registers a GSAP timeline on `window.__timelines` so it can be previewed in the Studio and rendered by the CI preview pipeline
4. Uses `data-composition-id="<name>-demo"` to avoid ID collisions

Blocks don't need `demo.html` — they are already standalone compositions.

### Checklist for new items

1. Create `registry/<blocks|components>/<name>/registry-item.json` following the [schema](packages/core/schemas/registry-item.json)
2. Add the item to `registry/registry.json`
3. For components: include a `demo.html`
4. Run `npx hyperframes lint` and `npx hyperframes validate` on your HTML
5. Test the install flow: `hyperframes add <name> --dir /tmp/test-project`

### Auto-generated docs

When you add a new block or component, its documentation page is generated automatically — you don't need to write MDX by hand.

Run the codegen script after adding items:

```bash
npx tsx scripts/generate-catalog-pages.ts
```

This produces:

- `docs/catalog/blocks/<name>.mdx` — per-block detail page
- `docs/catalog/components/<name>.mdx` — per-component detail page
- `docs/public/catalog-index.json` — flat manifest for the catalog grid page
- Updates `docs/docs.json` navigation with the new pages

The script wipes `docs/catalog/` before regenerating, so deleted items are automatically cleaned up.

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
bun run release:prepare 0.2.0        # drafts changelog if needed, then creates the release commit/tag after review
git push origin main --tags           # triggers the publish workflow
```

The `release:prepare` script drafts missing release notes on the first run and stops for manual review. After the generated TODO summary is rewritten, rerun the same command; it delegates to `set-version`, which creates a `chore: release v<version>` commit and a `v<version>` git tag. Pushing the tag triggers CI to publish all packages to npm and create a GitHub Release.

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
