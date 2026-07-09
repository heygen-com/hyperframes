# Operator Black UI Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign exactly the 66 frozen `ui-primitive` registry entries as the approved Operator Black system, preserving their public HTML/CSS/timeline contracts while making their canonical snippets, demos, generated docs, and preview verification production-ready.

**Architecture:** Keep every installed primitive self-contained, but generate the shared Operator Black token block and demo canonical region from committed sources. Freeze the baseline contract before edits, validate every changed primitive against that snapshot, and exercise the same allowlist through static tests, Puppeteer/axe fixtures, deterministic render checks, and visual contact sheets. Component work is split into disjoint families so it can run in parallel after the foundation lands.

**Tech Stack:** HTML/CSS/SVG, deterministic GSAP 3.14.2, TypeScript/tsx, Bun tests, Puppeteer, axe-core, HyperFrames lint/validate/render, oxlint, oxfmt, GitHub Actions.

---

## Working rules

- The approved design specification at `docs/contributing/operator-black-ui-primitives-design.md` is authoritative.
- The exact scope comes from `registry/ui-primitives/operator-black.scope.json`; never infer scope from directory names after the freeze.
- Preserve all unrelated dirty producer fixtures and package symlinks in this worktree.
- Hand-edit canonical snippets and manifests. Generate token blocks, demo canonical regions, catalog pages, catalog-index entries, and preview artifacts.
- Write a failing focused test before each infrastructure behavior or family contract, then make the smallest change that passes it.
- Keep commits family-sized and conventional. Before each commit, inspect `git diff --name-only` against the allowlist.
- A primitive is not complete until dark/light, reduced-motion, keyboard semantics, render determinism, responsive containment, and canonical/demo parity pass.

## Task 1: Freeze the executable scope and baseline contract

**Files:**

- Create: `registry/ui-primitives/operator-black.scope.json`
- Create: `registry/ui-primitives/operator-black.contract.json`
- Create: `registry/ui-primitives/operator-black.states.json`
- Create: `packages/core/src/registry/uiPrimitivesScope.test.ts`
- Create: `packages/core/src/registry/uiPrimitivesContract.test.ts`
- Create: `packages/core/src/registry/__fixtures__/ui-primitives/README.md`
- Modify: `packages/core/src/registry/remocnUiPrimitivesCatalog.test.ts`

- [ ] Add a scope test that loads the proposed JSON, asserts the frozen base/head SHAs, asserts 66 sorted unique IDs, and proves the three owned paths exist for every ID.

```ts
expect(scope.comparisonBase).toBe("8e04d0196945c5173923fb72ecc665d40d122adb");
expect(scope.featureBaseline).toBe("96b1dd7beeeea01c637aca2cff2ec94fcc83fe02");
expect(scope.items).toEqual([...scope.items].sort());
expect(new Set(scope.items).size).toBe(66);
```

- [ ] Run `bun test packages/core/src/registry/uiPrimitivesScope.test.ts` and confirm it fails because the source file does not exist.
- [ ] Add `operator-black.scope.json` with the exact Appendix A allowlist and make the scope test pass.
- [ ] Refactor `remocnUiPrimitivesCatalog.test.ts` to consume that allowlist and keep the existing 66 manifest/content assertions.
- [ ] Add the baseline contract extractor in the test helper. For every canonical file at the frozen feature SHA, record markup classes, IDs, roles, ARIA and `data-*` attributes, DOM relations, selectors and match counts, CSS custom properties, timeline comment selectors, and manifest identity.
- [ ] Commit the generated snapshot as `operator-black.contract.json`, with stable key ordering and LF endings.
- [ ] Add a zero-removal contract test against current files. It may permit additions, but must print the primitive ID and removed contract key on failure.
- [ ] Add `operator-black.states.json` with a record for every ID and explicit static states, live-controller behaviors, focus target, reduced-motion expectation, theme fixture, and render checkpoints. Reject empty or unknown state names in a schema test.
- [ ] Run:

```bash
bun test packages/core/src/registry/uiPrimitivesScope.test.ts \
  packages/core/src/registry/uiPrimitivesContract.test.ts \
  packages/core/src/registry/remocnUiPrimitivesCatalog.test.ts
```

Expected: all tests pass; the catalog test still reports exactly 66 primitives and 198 owned files.

- [ ] Commit: `test(registry): freeze Operator Black primitive contracts`

## Task 2: Build the shared token and synchronization pipeline

**Files:**

- Create: `registry/ui-primitives/operator-black.tokens.json`
- Create: `scripts/lib/ui-primitives/scope.ts`
- Create: `scripts/lib/ui-primitives/tokens.ts`
- Create: `scripts/lib/ui-primitives/canonical.ts`
- Create: `scripts/sync-ui-primitives.ts`
- Create: `packages/core/src/registry/uiPrimitivesSync.test.ts`

- [ ] Write tests for strict scope parsing, duplicate/missing IDs, token rendering, marker uniqueness, normalized SHA-256 parity, check/write modes, and idempotence in a temporary fixture.
- [ ] Run `bun test packages/core/src/registry/uiPrimitivesSync.test.ts` and confirm the missing implementation failure.
- [ ] Define semantic dark/light color fallbacks, typography, geometry, elevation, focus, and Soft Optical motion in `operator-black.tokens.json`. Public names must use `--hf-ui-*`; generated selectors must assign only `--_hf-ui-*` private resolved values.
- [ ] Render one stable CSS block between the exact markers:

```css
/* hf-ui:tokens:start */
[data-hf-ui-root] {
  --_hf-ui-surface: var(--hf-ui-surface, #141414);
  --_hf-ui-duration-state: var(--hf-ui-duration-state, 160ms);
}
[data-hf-theme="light"] [data-hf-ui-root],
[data-hf-ui-root][data-hf-theme="light"] {
  --_hf-ui-surface: var(--hf-ui-surface, #ffffff);
}
/* hf-ui:tokens:end */
```

- [ ] Implement `scripts/sync-ui-primitives.ts --write|--check [--only <id>]`. Write mode replaces exactly one token block in each canonical and replaces exactly one `<!-- hf-ui:canonical:start/end -->` region in each demo. Check mode exits nonzero on drift without writing.
- [ ] Normalize line endings to LF, trim trailing whitespace, preserve one terminal newline, and compare SHA-256 hashes of canonical and demo regions.
- [ ] Reject demo-only CSS that targets descendants of `[data-hf-ui-root]`, public/component variables, or known canonical classes.
- [ ] Make a second `--write` invocation produce no diff.
- [ ] Run `bunx oxfmt scripts/lib/ui-primitives/*.ts scripts/sync-ui-primitives.ts packages/core/src/registry/uiPrimitivesSync.test.ts` and `bunx oxlint` on the same TypeScript files.
- [ ] Commit: `feat(registry): add Operator Black sync pipeline`

## Task 3: Make preview assembly strict, local, and reproducible

**Files:**

- Create: `registry/ui-primitives/vendor/gsap-3.14.2.min.js`
- Create: `registry/ui-primitives/visual-test-image.lock.json`
- Modify: `scripts/generate-catalog-previews.ts`
- Create: `packages/core/src/registry/uiPrimitivesPreview.test.ts`
- Modify: `.github/workflows/catalog-previews.yml`
- Create: `.github/workflows/ui-primitives.yml`

- [ ] Add failing parser/assembly tests for `--allowlist`, `--prepare-only`, `--keep-workspace`, stable workspace names, local GSAP injection, aggregate errors, and refusal to process an item outside the frozen scope.
- [ ] Replace the UI-primitive CDN script with the pinned local GSAP asset and verify its checksum from `visual-test-image.lock.json`.
- [ ] Make `--allowlist registry/ui-primitives/operator-black.scope.json` process only those 66 entries; `--prepare-only` must assemble without capture; `--keep-workspace` must print and retain the path.
- [ ] Collect per-item errors, print a final table, and set a nonzero exit code when any item fails.
- [ ] Add a pinned Ubuntu/container/Chrome workflow that runs scope, sync, contract, lint, semantic, responsive, and deterministic checks. Keep external preview upload out of the workflow.
- [ ] Run:

```bash
bun test packages/core/src/registry/uiPrimitivesPreview.test.ts
bunx tsx scripts/generate-catalog-previews.ts \
  --allowlist registry/ui-primitives/operator-black.scope.json \
  --prepare-only
```

Expected: 66 prepared, 0 failed, no network runtime references in assembled HTML.

- [ ] Commit: `build(registry): harden UI primitive preview assembly`

## Task 4: Establish the shared component shell with eleven pilots

**Files:**

- Modify canonical/demo/manifest files under:
  - `registry/components/button/`
  - `registry/components/input/`
  - `registry/components/select/`
  - `registry/components/switch/`
  - `registry/components/dialog/`
  - `registry/components/popover/`
  - `registry/components/toast/`
  - `registry/components/table/`
  - `registry/components/chart/`
  - `registry/components/skeleton/`
  - `registry/components/spinner/`
- Create: `packages/core/src/registry/uiPrimitivesStyleAudit.test.ts`
- Create: `packages/producer/tests/ui-primitives/pilots.html`

- [ ] Add a style audit that fails on gradients, `backdrop-filter`, glass alpha surfaces, decorative-dot class names, `transition: all`, bounce/back easing, entry `scale(0)`, unpinned remote scripts/fonts, unscoped generic selectors, control heights below 40px, or coarse-pointer targets below 44px.
- [ ] Add `data-hf-ui-root` to each pilot without inserting compatibility-breaking wrappers. Keep every baseline class, variable, selector match, ARIA relationship, and timeline selector.
- [ ] Apply the approved shell: matte plane, one-pixel edges, 5/7/10px geometry, sans labels, mono technical values, square 1.5px SVG strokes, mint only for focus/selection/progress/success.
- [ ] Implement dark fallback and warm-paper light mode through private token resolution. Primitive roots remain transparent unless they semantically own a surface.
- [ ] Implement Soft Optical timing: press 120ms, state 160ms, anchored overlay 210ms in/140ms out, dialog 280ms in/180ms out. Use transform/opacity/filter only for animated entry/exit.
- [ ] Put every visible variant/state in the canonical snippet; use the demo only to arrange the canonical region and deterministic presentation choreography.
- [ ] Run sync, style, contract, and catalog tests for these IDs.
- [ ] Open the pilot fixture at 1440×900, 390×844, and 320×568 in dark/light and reduced-motion modes. Fix overflow, focus visibility, ambiguous selection, or nested framing before continuing.
- [ ] Commit: `feat(registry): establish Operator Black primitive language`

## Task 5: Roll out controls and form primitives

**Files:** Modify canonical/demo/manifest files for:

`button-group`, `toggle`, `toggle-group`, `textarea`, `input-group`, `input-otp`, `field`, `label`, `native-select`, `select-item`, `combobox`, `checkbox`, `radio`, `slider`, `calendar`, `stepper`, `progress-steps`.

- [ ] Add family fixtures to `packages/producer/tests/ui-primitives/controls-forms.html` before styling; assert all declared states from `operator-black.states.json` are mounted.
- [ ] Apply the pilot control grammar: 40px visible height, 44px coarse hit area, disciplined labels/help/error text, recessed selection, and no full-surface mint fills except semantic success.
- [ ] Preserve native form semantics and visible focus. Inputs keep placeholder/disabled/error/read-only distinctions; composite controls preserve their baseline role and ARIA relationships.
- [ ] Make technical values—OTP digits, slider values, step counts, and calendar metadata—monospace without turning prose labels into mono.
- [ ] Use deterministic CSS-variable/state choreography only; do not add live application controllers to installed snippets.
- [ ] Run family sync/style/contract tests and validate the fixture at 320, 390, 768, and 1440px widths in both themes.
- [ ] Commit: `feat(registry): redesign Operator Black form controls`

## Task 6: Roll out navigation and structural primitives

**Files:** Modify canonical/demo/manifest files for:

`accordion`, `collapsible`, `breadcrumb`, `pagination`, `tabs`, `menubar`, `navigation-menu`, `sidebar`, `card`, `item`, `separator`, `aspect-ratio`, `resizable`, `scroll-area`, `carousel`, `avatar`, `kbd`, `cursor`, `caret`.

- [ ] Add `packages/producer/tests/ui-primitives/navigation-structure.html` and make its state coverage assertion fail first.
- [ ] Build hierarchy through alignment, open space, typography, and selective rules. Remove gratuitous container-within-container framing while retaining the semantic card primitive.
- [ ] Keep navigation selections recessed and unambiguous. Mint may mark the active indicator/focus, not paint every selected surface.
- [ ] Preserve overflow and sizing behavior for scroll-area, carousel, resizable, and aspect-ratio. Prove no viewport overflow at the four required widths.
- [ ] Preserve ordered/positional selectors and direct-child cardinality recorded by the baseline contract.
- [ ] Run family sync/style/contract tests and fixture lint/validate.
- [ ] Commit: `feat(registry): redesign Operator Black navigation`

## Task 7: Roll out overlays, feedback, data, and meta primitives

**Files:** Modify canonical/demo/manifest files for:

`alert-dialog`, `drawer`, `sheet`, `tooltip`, `hover-card`, `context-menu`, `dropdown-menu`, `dropdown-menu-item`, `command-menu`, `command-menu-item`, `alert`, `badge`, `progress`, `empty`, `backdrop`, `blur-in`, `registry`, `remocn-ui`.

- [ ] Add `packages/producer/tests/ui-primitives/overlays-feedback.html` and make its state coverage assertion fail first.
- [ ] Anchor menus, popovers, hover cards, and tooltips to their trigger; keep dialogs centered; attach sheets/drawers to an edge; preserve toast stack origin.
- [ ] Use legitimate overlay elevation only: 10px corners, fine border, restrained shadow, flat backdrop, no glass or background blur.
- [ ] Apply exact Soft Optical overlay durations and transform origins. Drawer/sheet use 360ms in/240ms out; exits are faster; reduced motion removes spatial movement.
- [ ] Give alerts, badges, progress, empty/loading, and meta primitives strong semantic hierarchy without decorative color. Mint remains reserved for true success/progress/focus.
- [ ] Treat `backdrop`, `blur-in`, `registry`, and `remocn-ui` as literal allowlisted primitives; do not silently exclude them because they are atypical.
- [ ] Run family sync/style/contract tests and fixture lint/validate.
- [ ] Commit: `feat(registry): redesign Operator Black overlays and feedback`

## Task 8: Add semantic, responsive, and deterministic browser verification

**Files:**

- Modify: `packages/producer/package.json`
- Modify: `bun.lock`
- Create: `packages/producer/tests/ui-primitives/verify.ts`
- Create: `packages/producer/tests/ui-primitives/semantic-fixtures.ts`
- Create: `packages/producer/tests/ui-primitives/frame-checkpoints.json`
- Create: `packages/producer/tests/ui-primitives/frame-hashes.json`

- [ ] Add pinned `axe-core` to the producer test dependencies and update the Bun lockfile without touching installed package symlinks.
- [ ] Mount standalone canonical and demo-canonical versions of every ID in the same theme and assert normalized markup hash plus computed-style parity for declared state targets.
- [ ] Run axe against light/dark semantic fixtures. Fail on serious/critical violations, missing accessible names, broken ARIA references, non-keyboard-focusable interactive controls, or focus that is clipped/obscured.
- [ ] Capture every ID at 320×568, 390×844, 768×1024, and 1440×900. Fail on horizontal viewport overflow, content clipping, controls below the required hit target, or overlay bounds outside the safe viewport.
- [ ] Set `data-hf-rendering="true"`, disable CSS transitions/animations in render mode, seek declared GSAP checkpoints, and hash frames twice. The second run must match byte-for-byte.
- [ ] Assert `prefers-reduced-motion: reduce` removes spatial/blur motion while retaining immediate, understandable state changes.
- [ ] Run the complete browser suite twice and record the pinned hashes only after both runs agree.
- [ ] Commit: `test(registry): verify Operator Black UI primitives`

## Task 9: Regenerate catalog surfaces and visual review artifacts

**Files:**

- Modify: `docs/catalog/components/<id>.mdx` for the 66 scoped IDs only
- Modify: the same 66 records in `docs/public/catalog-index.json`
- Create locally only: UI primitive posters/contact sheets under the preview output directory

- [ ] Run `bunx tsx scripts/sync-ui-primitives.ts --write` and assert the second run is a no-op.
- [ ] Run the catalog page generator, then prove that changed docs/index records equal the 66-item allowlist and no unrelated catalog item changed.
- [ ] Generate dark/light contact sheets at desktop and mobile sizes, grouped by the three rollout families. Generate focused interaction strips for press, focus, selection, overlay enter/exit, progress, and reduced motion.
- [ ] Review at actual size for inconsistent radii, border contrast, type hierarchy, mint overuse, accidental cards, gradients, decorative dots, overlay origins, and motion discontinuities. Fix source files and regenerate; never repair generated demos/docs by hand.
- [ ] Keep preview assets local; do not run upload scripts.
- [ ] Commit: `docs(registry): regenerate Operator Black catalog previews`

## Task 10: Complete the release-grade verification gate

**Files:** all files changed by Tasks 1–9.

- [ ] Prove scope containment:

```bash
git diff --name-only 0ab9b57e2...HEAD
```

Expected: only the permitted support surfaces and the 198 owned primitive files from the specification.

- [ ] Run formatting and linting on every changed TypeScript/JSON/HTML/MDX file:

```bash
bunx oxfmt --check <changed-files>
bunx oxlint <changed-typescript-files>
```

- [ ] Run all focused core tests, the full registry suite, and producer UI primitive browser tests.
- [ ] For each changed canonical/demo composition, run static and runtime checks through the strict allowlist:

```bash
npx hyperframes lint
npx hyperframes validate
```

- [ ] Run `bun run build` and `bun run test`. Distinguish any unrelated pre-existing failure with captured evidence; do not hide or overwrite it.
- [ ] Run `bunx tsx scripts/sync-ui-primitives.ts --check` after all generators and tests. Expected: zero drift.
- [ ] Inspect `git status --short`, verify unrelated dirty producer outputs/symlinks remain unstaged and unchanged by this work, and stage only intentional paths.
- [ ] Request an independent code/design review against the approved specification. Resolve every high-confidence contract, accessibility, determinism, or visual-system finding.
- [ ] Make the final implementation commit if needed: `feat(registry): ship Operator Black UI primitives`

## Completion evidence

The goal is complete only when the final report includes:

1. The exact 66-ID scope and zero out-of-scope component edits.
2. Passing sync idempotence, canonical/demo parity, and baseline compatibility tests.
3. Passing axe, keyboard, responsive, reduced-motion, and deterministic frame checks.
4. Passing HyperFrames lint/validate plus relevant build/test commands.
5. Reviewed dark/light desktop/mobile contact sheets with no unresolved design-system findings.
6. A clean intentional diff that preserves all unrelated user-owned worktree changes.
