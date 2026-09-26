# Contributing to Hyperframes

Thanks for your interest in contributing to Hyperframes! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/hyperframes.git`
3. Install dependencies: `bun install`
4. Create a branch: `git checkout -b my-feature`

## Choosing work

Start with [available newcomer issues](https://github.com/heygen-com/hyperframes/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee) or [help-wanted issues](https://github.com/heygen-com/hyperframes/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee). Read the discussion and check existing PRs before starting; an unassigned issue may already have work in progress. Comment with your intended approach and coordinate a claim with a maintainer.

`difficulty/easy`, `difficulty/medium`, and `difficulty/hard` describe the work. `triage/ready` means the scope is accepted; `help wanted` means it is available. A `good first issue` also has a testing path and a maintainer willing to help. See [TRIAGE.md](TRIAGE.md) for the full definitions and ways to discover useful issues yourself.

Discuss substantial features, public API/runtime changes, and changes to defaults before implementing them. Existing accepted scope does not need another approval. Tiny self-contained corrections can go directly into a PR with the problem and verification explained.

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

#### Comments

A comment says what the code cannot: the reason, the invariant, the non-obvious constraint. Names, types and tests carry the rest, and reasoning or history goes in the PR description, where it stays attached to the change. We follow the [Stack Overflow guidance on code comments](https://stackoverflow.blog/2021/12/23/best-practices-for-writing-code-comments/):

1. **Don't repeat the code.** `// Count label` above `const countLabel` tells the reader nothing new.
2. **A comment doesn't make unclear code clear.** Rename the variable or extract the function instead of explaining it.
3. **If you can't write a clear comment, the code may be the problem.** Simplify it first.
4. **Clear up confusion; don't add to it.** A comment the reader has to decode costs more than none.
5. **Explain code that looks wrong on purpose.** An unusual loop, a deliberate no-op or a workaround says why it has to be that way.
6. **Link the source of copied or adapted code**, with a URL that will still work.
7. **Link external references where they help**: a spec, an issue or a vendor document anyone can open.
8. **Explain bug fixes by what the code must do and how to reproduce the bug**, not by the change's history or PR number.
9. **Mark unfinished work with a TODO that has an owner or an issue**: `TODO(name):`, `TODO(area):` or `TODO(#1234):`.

Reviewers judge rules 2 to 5 and 8. The `Comments` check (`scripts/check-comment-citations.mjs`) grades the comments a PR adds or edits:

- **Citations must resolve.** A backticked path, a `path:line`, a backticked camelCase symbol, or "pinned by" / "covered by" / "see" plus a test file must point at something in the repo. A comment that names its source reads as evidence, so a stale one sends the next reader to a dead end.
- **No history.** "used to", "previously", "was removed", "before this change", "PR #123" describe the past, which git already records. State what is true now.
- **No commented-out code.** Delete it; git keeps it.
- **No block over 40 lines.** Cut it to the why and the invariant. A block that must stay whole (a licence, a diagram, a protocol table) starts with `comment-length: <reason>`.
- **A TODO, FIXME or XXX names an owner or an issue** in its parentheses, or links the issue (rule 9).
- **A URL can be opened by anyone** (rule 7): well-formed, not on a private network or internal host, and not signed or carrying a token. `localhost` addresses that describe a dev server are fine.
- **Warnings that never fail the build:** copied or adapted code without a source link (rule 6), and a short comment whose words mostly restate the next line of code (rule 1). Both are heuristics that measured too many false positives on this repo to fail a build.

- **A package file's comment share may not rise** (`scripts/comment-ratchet.mjs`). For source under `packages/*/src` (tests excluded), a file you change may not end up with a higher share of comment lines than it had where your branch forked, unless you only deleted code. It may not gain a new comment block over 12 lines, and a new file may not start above its package's share. Move the explanation into a name, a type or the PR description.

Only comment blocks holding a line your PR added can fail the citation and block rules, and the TODO and URL rules grade only the lines your PR added. Broken citations elsewhere in a file you touched are printed as warnings, and fixing one while you are there is welcome. To grade files by hand, pass their paths: `node scripts/check-comment-citations.mjs path/to/file.ts`.

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

**Anyone can add an item.** Nothing here needs commit access, and the two steps
that do need something a contributor may not have are handled by a maintainer
before merge, listed at the end.

1. Create `registry/<blocks|components>/<name>/registry-item.json` following the [schema](packages/core/schemas/registry-item.json)
2. For components: include a `demo.html`
3. Run `npx hyperframes lint` and `npx hyperframes validate` on your HTML
4. Test the install flow: `hyperframes add <name> --dir /tmp/test-project`
5. Generate and validate the catalog: `bun run check:catalog-drift`

### Generated catalog files

Catalog additions and edits commit only the item's source files. Do not commit
search vectors, generated docs pages, preview payloads, gallery data, or Catalog
navigation. CI builds and validates them from your sources.

Deleting or renaming an item has one exception: remove its old entry from
`registry/registry.json` in the same PR that deletes the complete item directory.
The CLI reads item files directly from main, so leaving that entry would offer an
item whose files no longer exist. Keep every other index entry and all metadata
unchanged. Do not add the new entry for a rename or an add-plus-delete PR;
automation publishes additions. CI rejects missing removals, added entries,
metadata edits, and removals whose item directories still exist.

To generate the complete catalog locally after installing dependencies and
building the workspace packages:

```bash
bun run generate:catalog
```

This command downloads the pinned embedding model when needed. It updates the
registry index, vectors, payloads, pages, gallery and navigation in dependency
order. Restore generated files before committing, preserving only the required
index-entry removals when you delete item directories.

After source changes merge, automation updates one standing publication PR on
`bot/catalog-publish`, titled `chore(catalog): publish generated catalog`.
A maintainer approves any waiting workflow runs, reviews it, and merges it after
checks pass. New items become discoverable after publication; edits to existing
CLI item sources take effect on main immediately. Generated docs and search
artifacts update when the publication PR merges. Existing URLs remain unchanged.

Example manifests are authored source. To deliberately scaffold them, use
`scripts/scaffold-example-manifests.ts`; indexing never rewrites them.
Catalog preview images remain a separate workflow. Attach your preview MP4 to
the item PR if you cannot upload its hosted image.

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
git push origin main                  # push the release commit
git push origin v0.2.0                # push the tag → triggers the publish workflow
```

> Push the **specific tag**, not `git push --tags` — the latter pushes every local tag and the whole push is rejected if any one already exists on the remote.

The `release:prepare` script drafts missing release notes on the first run and stops for manual review. After the generated TODO summary is rewritten, rerun the same command; it delegates to `set-version`, which creates a `chore: release v<version>` commit and a `v<version>` git tag. Pushing the tag triggers CI to publish all packages to npm and create a GitHub Release.

`set-version` also refuses to tag if a **higher** semver tag already exists (a stale higher tag would hijack tag-sorting installers like `npx skills`). Delete the stray tag (`git tag -d <tag> && git push origin :refs/tags/<tag>`) or, only if intentional, pass `--skip-monotonicity-check`.

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
