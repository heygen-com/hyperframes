# Minimal Grouped-Control Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the framed segmented-control treatment in `toggle-group`, `button-group`, and `menubar` with the approved single-rail visual language while preserving every public and accessibility contract.

**Architecture:** Canonical component HTML remains the single source of truth. A focused regression test locks the shared rail vocabulary, the three canonical CSS regions receive the minimal visual changes, and the existing sync tool regenerates each demo from its canonical source. Existing semantic verification remains unchanged; only the pinned visual hash artifact is regenerated after the new rendering is proven deterministic.

**Tech Stack:** HTML, CSS custom properties, TypeScript, Vitest through Bun, Puppeteer/Chrome pinned Linux verification, GSAP timeline fixtures.

---

## File map

- Modify `packages/core/src/registry/uiPrimitivesStyleAudit.test.ts` — add a focused static contract for the three grouped-control surfaces and active edges.
- Modify `registry/components/toggle-group/toggle-group.html` — turn the sliding plate into a 2px rail indicator.
- Modify `registry/components/button-group/button-group.html` — replace shell and pressed fill with a flat rail and active edge.
- Modify `registry/components/menubar/menubar.html` — replace the wrapping framed field with an unwrapped rail and current-item edge.
- Regenerate `registry/components/toggle-group/demo.html` — synchronized demo copy.
- Regenerate `registry/components/button-group/demo.html` — synchronized demo copy.
- Regenerate `registry/components/menubar/demo.html` — synchronized demo copy.
- Modify `packages/producer/tests/ui-primitives/frame-hashes.json` — locked Linux screenshot hashes after the complete 66-item run.

### Task 1: Lock the minimal rail vocabulary with a failing regression test

**Files:**
- Modify: `packages/core/src/registry/uiPrimitivesStyleAudit.test.ts`
- Test: `packages/core/src/registry/uiPrimitivesStyleAudit.test.ts`

- [ ] **Step 1: Add a CSS-rule extraction helper near the existing audit helpers**

```ts
function cssDeclarations(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule for ${selector}`);
  return match[1];
}
```

- [ ] **Step 2: Add a focused test after the frozen-scope audit**

```ts
describe("Operator Black grouped-control rail", () => {
  it("uses one open baseline and no framed or filled selection surface", () => {
    const sources = new Map(
      ["toggle-group", "button-group", "menubar"].map((id) => [
        id,
        readFileSync(resolve(repoRoot, "registry/components", id, `${id}.html`), "utf8"),
      ]),
    );

    for (const [id, selector] of [
      ["toggle-group", ".hf-ui-toggle-group"],
      ["button-group", ".hf-ui-button-group"],
      ["menubar", ".hf-ui-menubar"],
    ] as const) {
      const rootRule = cssDeclarations(sources.get(id) ?? "", selector);
      expect(rootRule).toContain("border-block-end: 1px solid var(--_hf-ui-border)");
      expect(rootRule).not.toMatch(/\b(?:background|border-radius|box-shadow)\s*:/);
    }

    const indicatorRule = cssDeclarations(
      sources.get("toggle-group") ?? "",
      ".hf-ui-toggle-indicator",
    );
    expect(indicatorRule).toContain("bottom: 0");
    expect(indicatorRule).toContain("height: 2px");
    expect(indicatorRule).toContain("background: var(--_hf-ui-accent)");
    expect(indicatorRule).not.toMatch(/\b(?:border-radius|box-shadow)\s*:/);

    for (const [id, selector] of [
      ["button-group", '.hf-ui-button-group button[aria-pressed="true"]'],
      ["menubar", '.hf-ui-menubar button[aria-current="page"]'],
    ] as const) {
      const activeRule = cssDeclarations(sources.get(id) ?? "", selector);
      expect(activeRule).toContain("border-block-end-color: var(--_hf-ui-accent)");
      expect(activeRule).not.toMatch(/\b(?:background|border-radius|box-shadow)\s*:/);
    }
  });
});
```

- [ ] **Step 3: Run the focused test and confirm it fails on the old framed treatment**

Run:

```bash
bun test packages/core/src/registry/uiPrimitivesStyleAudit.test.ts
```

Expected: FAIL because the three roots do not yet contain `border-block-end: 1px solid var(--_hf-ui-border)`.

### Task 2: Implement the rail in the three canonical primitives

**Files:**
- Modify: `registry/components/toggle-group/toggle-group.html`
- Modify: `registry/components/button-group/button-group.html`
- Modify: `registry/components/menubar/menubar.html`
- Test: `packages/core/src/registry/uiPrimitivesStyleAudit.test.ts`

- [ ] **Step 1: Replace the `toggle-group` shell and indicator declarations**

Use these declarations in the existing rules, retaining the existing width, grid, typography, button state, and transform contract:

```css
.hf-ui-toggle-group {
  --hf-toggle-count: 3;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  width: min(420px, 100%);
  height: var(--_hf-ui-control-height);
  padding: 0;
  border: 0;
  border-block-end: 1px solid var(--_hf-ui-border);
  font-family: var(--_hf-ui-font-sans);
}
.hf-ui-toggle-indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  width: calc(100% / var(--hf-toggle-count));
  height: 2px;
  background: var(--_hf-ui-accent);
  transform: translateX(calc(var(--hf-toggle-index) * 100%));
  transition: transform var(--_hf-ui-duration-state) var(--_hf-ui-ease-response);
}
```

Update its coarse-pointer group margin to:

```css
margin-block: calc((var(--_hf-ui-hit-target) - var(--_hf-ui-control-height)) / 2);
```

- [ ] **Step 2: Replace the `button-group` shell and pressed-state declarations**

```css
.hf-ui-button-group {
  display: inline-flex;
  min-height: var(--_hf-ui-control-height);
  padding: 0;
  border: 0;
  border-block-end: 1px solid var(--_hf-ui-border);
  font-family: var(--_hf-ui-font-sans);
}
.hf-ui-button-group button {
  position: relative;
  min-width: 72px;
  height: var(--_hf-ui-control-height);
  padding: 0 var(--_hf-ui-space-3);
  border: 0;
  border-block-end: 2px solid transparent;
  background: transparent;
  color: var(--_hf-ui-text-muted);
  font: var(--_hf-ui-weight-medium) 13px/1 var(--_hf-ui-font-sans);
  cursor: pointer;
  transition:
    transform var(--_hf-ui-duration-press) var(--_hf-ui-ease-response),
    border-color var(--_hf-ui-duration-state) var(--_hf-ui-ease-response),
    color var(--_hf-ui-duration-state) var(--_hf-ui-ease-response);
}
.hf-ui-button-group button[aria-pressed="true"] {
  border-block-end-color: var(--_hf-ui-accent);
  color: var(--_hf-ui-text-strong);
}
```

Update its coarse-pointer group margin to:

```css
margin-block: calc((var(--_hf-ui-hit-target) - var(--_hf-ui-control-height)) / 2);
```

- [ ] **Step 3: Replace the `menubar` shell, current state, and hover declarations**

```css
.hf-ui-menubar {
  display: inline-flex;
  flex-wrap: nowrap;
  gap: 0;
  max-width: 100%;
  min-height: var(--_hf-ui-control-height);
  padding: 0;
  border: 0;
  border-block-end: 1px solid var(--_hf-ui-border);
  font-family: var(--_hf-ui-font-sans);
}
.hf-ui-menubar button {
  position: relative;
  height: var(--_hf-ui-control-height);
  padding: 0 12px;
  border: 0;
  border-block-end: 2px solid transparent;
  background: transparent;
  color: var(--_hf-ui-text-muted);
  font: var(--_hf-ui-weight-medium) 13px/1 var(--_hf-ui-font-sans);
  cursor: pointer;
  transform: translateY(0) scale(1);
  white-space: nowrap;
  transition:
    border-color var(--_hf-ui-duration-state) var(--_hf-ui-ease-response),
    color var(--_hf-ui-duration-state) var(--_hf-ui-ease-response),
    transform var(--_hf-ui-duration-press) var(--_hf-ui-ease-response);
}
.hf-ui-menubar button[aria-current="page"] {
  border-block-end-color: var(--_hf-ui-accent);
  color: var(--_hf-ui-text-strong);
}
```

Remove the redundant `button:first-child` strong-color rule. Keep hover feedback text-only:

```css
@media (hover: hover) and (pointer: fine) {
  .hf-ui-menubar button:hover {
    color: var(--_hf-ui-text);
  }
}
```

- [ ] **Step 4: Run the regression test and confirm it passes**

Run:

```bash
bun test packages/core/src/registry/uiPrimitivesStyleAudit.test.ts
```

Expected: PASS, including the new grouped-control rail test and the existing 66-item style audit.

- [ ] **Step 5: Commit the canonical visual change**

```bash
git add packages/core/src/registry/uiPrimitivesStyleAudit.test.ts registry/components/toggle-group/toggle-group.html registry/components/button-group/button-group.html registry/components/menubar/menubar.html
git commit -m "feat(registry): flatten grouped controls onto a single rail"
```

### Task 3: Regenerate synchronized demos

**Files:**
- Modify: `registry/components/toggle-group/demo.html`
- Modify: `registry/components/button-group/demo.html`
- Modify: `registry/components/menubar/demo.html`
- Test: `packages/core/src/registry/uiPrimitivesSync.test.ts`

- [ ] **Step 1: Regenerate each demo from its canonical source**

```bash
bunx tsx scripts/sync-ui-primitives.ts --write --only toggle-group
bunx tsx scripts/sync-ui-primitives.ts --write --only button-group
bunx tsx scripts/sync-ui-primitives.ts --write --only menubar
```

Expected: each command reports its selected primitive synchronized; only the three `demo.html` files change.

- [ ] **Step 2: Verify exact source/demo parity**

```bash
bunx tsx scripts/sync-ui-primitives.ts --check --only toggle-group
bunx tsx scripts/sync-ui-primitives.ts --check --only button-group
bunx tsx scripts/sync-ui-primitives.ts --check --only menubar
bun test packages/core/src/registry/uiPrimitivesSync.test.ts packages/core/src/registry/uiPrimitivesContract.test.ts packages/core/src/registry/uiPrimitivesPreview.test.ts
```

Expected: all sync checks and tests PASS.

- [ ] **Step 3: Commit synchronized demos**

```bash
git add registry/components/toggle-group/demo.html registry/components/button-group/demo.html registry/components/menubar/demo.html
git commit -m "chore(registry): sync minimal grouped control demos"
```

### Task 4: Verify behavior, accessibility, themes, and responsive geometry

**Files:**
- Verify: `registry/components/toggle-group/demo.html`
- Verify: `registry/components/button-group/demo.html`
- Verify: `registry/components/menubar/demo.html`
- Test: `packages/producer/tests/ui-primitives/runner.ts`

- [ ] **Step 1: Format and lint every changed implementation file**

```bash
bunx oxfmt packages/core/src/registry/uiPrimitivesStyleAudit.test.ts registry/components/toggle-group/toggle-group.html registry/components/toggle-group/demo.html registry/components/button-group/button-group.html registry/components/button-group/demo.html registry/components/menubar/menubar.html registry/components/menubar/demo.html
bunx oxlint packages/core/src/registry/uiPrimitivesStyleAudit.test.ts
```

Expected: formatting completes and oxlint reports no errors.

- [ ] **Step 2: Run the focused browser matrix for each primitive**

```bash
bun run --cwd packages/producer verify:ui-primitives -- --only toggle-group --artifacts-dir /tmp/operator-black-rail/toggle-group
bun run --cwd packages/producer verify:ui-primitives -- --only button-group --artifacts-dir /tmp/operator-black-rail/button-group
bun run --cwd packages/producer verify:ui-primitives -- --only menubar --artifacts-dir /tmp/operator-black-rail/menubar
```

Expected: semantic, keyboard, dark/light, 280/360/640/1024/1920 width, 200%/400% zoom, coarse pointer, reduced motion, forced colors, canonical parity, and deterministic multi-pass checks report no failures. A non-locked local run may report that it cannot publish the committed full-run frame lock; no semantic or layout category may fail.

- [ ] **Step 3: Inspect generated screenshots at the narrow and default checkpoints**

Confirm all three screenshots show one neutral baseline, no perimeter or active fill, an unclipped focus ring, and a 2px active edge. Confirm the menubar remains on one line at 280px.

- [ ] **Step 4: Run the complete focused non-browser suite**

```bash
bun test \
  packages/core/src/registry/uiPrimitivesScope.test.ts \
  packages/core/src/registry/uiPrimitivesContract.test.ts \
  packages/core/src/registry/remocnUiPrimitivesCatalog.test.ts \
  packages/core/src/registry/uiPrimitivesSync.test.ts \
  packages/core/src/registry/uiPrimitivesStyleAudit.test.ts \
  packages/core/src/registry/uiPrimitivesPreview.test.ts \
  packages/producer/tests/ui-primitives/*.test.ts
```

Expected: all focused tests PASS.

### Task 5: Regenerate the pinned 66-primitive visual lock and finish

**Files:**
- Modify: `packages/producer/tests/ui-primitives/frame-hashes.json`
- Verify: all files listed in the file map

- [ ] **Step 1: Create an isolated committed verification checkout**

```bash
rm -rf /tmp/operator-black-rail-pinned
git worktree add --detach /tmp/operator-black-rail-pinned HEAD
```

Expected: a clean detached worktree at the implementation commit.

- [ ] **Step 2: Run the complete update in the exact pinned Linux image**

```bash
docker run --rm --platform linux/amd64 --init --cap-add SYS_ADMIN \
  --user root \
  -v /tmp/operator-black-rail-pinned:/app \
  -v operator-black-rail-node-modules:/app/node_modules \
  -w /app \
  --entrypoint bash \
  ghcr.io/puppeteer/puppeteer@sha256:9665f5b57abc5cc7080a641878964018de219055a4d2c9d8d050ceb1161778ba \
  -lc 'npm install --global bun@1.3.14 && bun install --frozen-lockfile --ignore-scripts && HF_UI_REQUIRE_LOCKED_ENV=1 HF_UI_CONTAINER_IMAGE=ghcr.io/puppeteer/puppeteer:25.3.0 HF_UI_CONTAINER_DIGEST=sha256:9665f5b57abc5cc7080a641878964018de219055a4d2c9d8d050ceb1161778ba bun run --cwd packages/producer verify:ui-primitives -- --update-frame-hashes'
```

Expected: 66/66 primitives pass, all four screenshot passes match exactly, and the verifier publishes a new `frame-hashes.json` in the detached worktree.

- [ ] **Step 3: Verify the regenerated lock again in the same isolated checkout**

```bash
docker run --rm --platform linux/amd64 --init --cap-add SYS_ADMIN \
  --user root \
  -v /tmp/operator-black-rail-pinned:/app \
  -v operator-black-rail-node-modules:/app/node_modules \
  -w /app \
  --entrypoint bash \
  ghcr.io/puppeteer/puppeteer@sha256:9665f5b57abc5cc7080a641878964018de219055a4d2c9d8d050ceb1161778ba \
  -lc 'npm install --global bun@1.3.14 && HF_UI_REQUIRE_LOCKED_ENV=1 HF_UI_CONTAINER_IMAGE=ghcr.io/puppeteer/puppeteer:25.3.0 HF_UI_CONTAINER_DIGEST=sha256:9665f5b57abc5cc7080a641878964018de219055a4d2c9d8d050ceb1161778ba bun run --cwd packages/producer verify:ui-primitives'
```

Expected: the same complete run passes and matches the committed lock exactly.

- [ ] **Step 4: Copy only the twice-verified lock into the working branch**

```bash
cp /tmp/operator-black-rail-pinned/packages/producer/tests/ui-primitives/frame-hashes.json packages/producer/tests/ui-primitives/frame-hashes.json
```

Expected: only `packages/producer/tests/ui-primitives/frame-hashes.json` is added to the implementation worktree diff.

- [ ] **Step 5: Run repository quality gates on the changed surface**

```bash
bunx oxfmt --check packages/core/src/registry/uiPrimitivesStyleAudit.test.ts registry/components/toggle-group/toggle-group.html registry/components/toggle-group/demo.html registry/components/button-group/button-group.html registry/components/button-group/demo.html registry/components/menubar/menubar.html registry/components/menubar/demo.html packages/producer/tests/ui-primitives/frame-hashes.json
bun run lint
bun run build
git diff --check
```

Expected: all commands PASS with no new formatting, lint, build, or whitespace error.

- [ ] **Step 6: Commit the regenerated visual lock**

```bash
git add packages/producer/tests/ui-primitives/frame-hashes.json
git commit -m "test(registry): update grouped control frame hashes"
```

- [ ] **Step 7: Remove only the temporary verification resources**

```bash
git worktree remove --force /tmp/operator-black-rail-pinned
docker volume rm operator-black-rail-node-modules
```

Expected: the feature worktree remains intact and the pre-existing producer output/node-module modifications remain untouched.
