import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUiPrimitiveDemo,
  extractCanonicalRegion,
  injectOperatorBlackTokens,
  normalizedSha256,
  normalizeUiPrimitiveText,
  validateDemoOnlyCss,
} from "../../../../scripts/lib/ui-primitives/canonical";
import {
  loadUiPrimitiveScope,
  parseUiPrimitiveScope,
} from "../../../../scripts/lib/ui-primitives/scope";
import {
  loadOperatorBlackTokens,
  parseOperatorBlackTokens,
  renderOperatorBlackTokenBlock,
  TOKEN_END,
  TOKEN_START,
} from "../../../../scripts/lib/ui-primitives/tokens";
import {
  commitUiPrimitiveChangesAtomically,
  parseSyncCliOptions,
  recoverUiPrimitiveChanges,
  syncUiPrimitiveFiles,
  uiPrimitiveTransactionJournalPath,
} from "../../../../scripts/sync-ui-primitives";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const scopePath = resolve(repoRoot, "registry/ui-primitives/operator-black.scope.json");
const tokenPath = resolve(repoRoot, "registry/ui-primitives/operator-black.tokens.json");
const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("Operator Black sync sources", () => {
  it("strictly validates the frozen scope", () => {
    const scope = loadUiPrimitiveScope(scopePath);
    expect(scope.items).toHaveLength(66);
    expect(() => parseUiPrimitiveScope({ ...scope, extra: true })).toThrow("keys must be exactly");
    expect(() => parseUiPrimitiveScope({ ...scope, items: scope.items.slice(1) })).toThrow(
      "exactly 66",
    );
    expect(() =>
      parseUiPrimitiveScope({ ...scope, items: [...scope.items.slice(0, 65), scope.items[0]] }),
    ).toThrow("unique");
    expect(() =>
      parseUiPrimitiveScope({ ...scope, items: [...scope.items.slice(0, 65), "zzzz"] }),
    ).toThrow("approved frozen allowlist");
  });

  it("strictly validates and renders public-overridable private token fallbacks", () => {
    const tokens = loadOperatorBlackTokens(tokenPath);
    const block = renderOperatorBlackTokenBlock(tokens);
    expect(block.trimStart().startsWith(TOKEN_START)).toBe(true);
    expect(block.trimEnd().endsWith(TOKEN_END)).toBe(true);
    expect(block).toContain("--_hf-ui-surface: var(--hf-ui-surface, #141414)");
    expect(block).toContain(
      "--_hf-ui-duration-overlay-enter: var(--hf-ui-duration-overlay-enter, 210ms)",
    );
    expect(block).toContain('[data-hf-theme="light"] [data-hf-ui-root]');
    expect(block).toContain("color-scheme: light");
    expect(block).toContain('[data-hf-rendering="true"] [data-hf-ui-root] *');
    expect(block).toContain('[data-hf-rendering="true"] [data-hf-ui-root] *::before');
    expect(block).toContain('[data-hf-rendering="true"][data-hf-ui-root]::after');
    expect(block).toContain("@media (prefers-reduced-motion: reduce)");
    expect(block).not.toMatch(/^\s*--hf-ui-[\w-]+\s*:/m);
    expect(() => parseOperatorBlackTokens({ ...tokens, extra: true })).toThrow(
      "keys must be exactly",
    );
    expect(() =>
      parseOperatorBlackTokens({
        ...tokens,
        shared: { ...tokens.shared, "--hf-ui-control-height": "41px" },
      }),
    ).toThrow("approved Operator Black token contract");
  });

  it("rejects contradictory CLI modes and unknown arguments", () => {
    expect(parseSyncCliOptions(["--check", "--only", "button"])).toEqual({
      mode: "check",
      only: "button",
    });
    expect(() => parseSyncCliOptions([])).toThrow("Choose exactly one");
    expect(() => parseSyncCliOptions(["--check", "--write"])).toThrow("Choose exactly one");
    expect(() => parseSyncCliOptions(["--check", "--check"])).toThrow("one occurrence");
    expect(() => parseSyncCliOptions(["--check", "--only", "button", "--only", "input"])).toThrow(
      "only once",
    );
    expect(() => parseSyncCliOptions(["--wat"])).toThrow("Unknown argument");
  });
});

describe("Operator Black canonical and demo synchronization", () => {
  const canonical = `<button class="hf-ui-button" type="button">Run</button>
<style>.hf-ui-button { color: red; }</style>`;
  const tokenBlock = renderOperatorBlackTokenBlock(loadOperatorBlackTokens(tokenPath));

  it("normalizes, roots, injects once, hashes, and bootstraps an exact demo region", () => {
    const injected = injectOperatorBlackTokens(`${canonical}  \r\n`, tokenBlock, "sample");
    expect(injected).toContain("data-hf-ui-root");
    expect(injected.split(TOKEN_START)).toHaveLength(2);
    expect(injectOperatorBlackTokens(injected, tokenBlock, "sample")).toBe(injected);
    expect(normalizeUiPrimitiveText("a  \r\n\r\n")).toBe("a\n");

    const demo = buildUiPrimitiveDemo("button", injected);
    const region = extractCanonicalRegion(demo);
    expect(normalizedSha256(region)).toBe(normalizedSha256(injected));
    expect(demo).toContain("../../ui-primitives/vendor/gsap-3.14.2.min.js");
    expect(demo).toContain('data-hf-rendering="true"');
    expect(demo).not.toContain("https://cdn.jsdelivr.net");
    expect(() => validateDemoOnlyCss(demo, injected)).not.toThrow();
  });

  it("finds the shallow structural root instead of decoys and supports quoted greater-than signs", () => {
    const tricky = `<!-- <div class="hf-ui-comment-decoy"></div> -->
<script>const sample = '<div class="hf-ui-script-decoy"></div>';</script>
<style>.sample::before { content: '<div class="hf-ui-style-decoy">'; }</style>
<div><span class="hf-ui-nested-decoy">Nested</span></div>
<section class="hf-ui-real-root" data-note="value > threshold">Real</section>`;
    const injected = injectOperatorBlackTokens(tricky, tokenBlock, "tricky");
    expect(injected).toContain(
      '<section data-hf-ui-root class="hf-ui-real-root" data-note="value > threshold">',
    );
    expect(injected).toContain('<span class="hf-ui-nested-decoy">');
    expect(injected).not.toContain('<span data-hf-ui-root class="hf-ui-nested-decoy">');
    expect(injected).toContain('<div class="hf-ui-comment-decoy"></div>');
  });

  it("rejects demo-only rules that reach into the canonical component", () => {
    const injected = injectOperatorBlackTokens(canonical, tokenBlock, "sample");
    const demo = buildUiPrimitiveDemo("button", injected).replace(
      "</style>",
      ".hf-ui-button { color: hotpink; }</style>",
    );
    expect(() => validateDemoOnlyCss(demo, injected)).toThrow("targets the canonical root");
  });

  it("rejects demo selector, inline-style, and custom-property escape routes", () => {
    const injected = injectOperatorBlackTokens(
      `<div id="component" class="hf-ui-button" role="dialog"><div>Run</div></div>
<style>.hf-ui-button { color: red; }</style>`,
      tokenBlock,
      "sample",
    );
    const base = buildUiPrimitiveDemo("button", injected);
    const escapedCss = [
      ".hf-ui-demo-stage div { color: red; }",
      ".hf-ui-demo-stage * { color: red; }",
      '[role="dialog"] { color: red; }',
      "#component { color: red; }",
      ".hf-ui-demo-stage { --brand-color: red; }",
    ];
    for (const css of escapedCss) {
      const demo = base.replace("</style>", `${css}</style>`);
      expect(() => validateDemoOnlyCss(demo, injected), css).toThrow();
    }
    const inline = base.replace(
      'class="hf-ui-demo-caption"',
      'class="hf-ui-demo-caption" style="color: red"',
    );
    expect(() => validateDemoOnlyCss(inline, injected)).toThrow("inline style");
  });

  it("supports check, write, and idempotent second-write behavior", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-sync-"));
    temporaryRoots.push(root);
    const canonicalPath = resolve(root, "button.html");
    const demoPath = resolve(root, "demo.html");
    writeFileSync(canonicalPath, canonical);
    writeFileSync(demoPath, "<!doctype html><title>old</title>\n");

    const check = syncUiPrimitiveFiles({
      id: "button",
      canonicalPath,
      demoPath,
      tokenBlock,
      mode: "check",
    });
    expect(check).toMatchObject({ canonicalChanged: true, demoChanged: true });
    expect(readFileSync(canonicalPath, "utf8")).toBe(canonical);

    const write = syncUiPrimitiveFiles({
      id: "button",
      canonicalPath,
      demoPath,
      tokenBlock,
      mode: "write",
    });
    expect(write).toMatchObject({ canonicalChanged: true, demoChanged: true });
    const secondWrite = syncUiPrimitiveFiles({
      id: "button",
      canonicalPath,
      demoPath,
      tokenBlock,
      mode: "write",
    });
    expect(secondWrite).toMatchObject({ canonicalChanged: false, demoChanged: false });
    expect(normalizedSha256(extractCanonicalRegion(readFileSync(demoPath, "utf8")))).toBe(
      normalizedSha256(readFileSync(canonicalPath, "utf8")),
    );

    const canonicalDemo = readFileSync(demoPath, "utf8");
    writeFileSync(demoPath, canonicalDemo.replace(/\n/g, "\r\n").replace(/\r\n$/, "  \r\n"));
    const byteDrift = syncUiPrimitiveFiles({
      id: "button",
      canonicalPath,
      demoPath,
      tokenBlock,
      mode: "check",
    });
    expect(byteDrift.demoChanged).toBe(true);
  });

  it("stages every file before install and leaves originals intact on staging failure", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-atomic-"));
    temporaryRoots.push(root);
    const firstPath = resolve(root, "first.html");
    const missingParentPath = resolve(root, "missing", "second.html");
    writeFileSync(firstPath, "before\n");

    expect(() =>
      commitUiPrimitiveChangesAtomically([
        { path: firstPath, content: "after\n" },
        { path: missingParentPath, content: "never\n" },
      ]),
    ).toThrow();
    expect(readFileSync(firstPath, "utf8")).toBe("before\n");
    expect(existsSync(`${firstPath}.hf-ui-sync.tmp`)).toBe(false);
  });

  it("rolls every installed file back after an injected install-phase failure", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-rollback-"));
    temporaryRoots.push(root);
    const firstPath = resolve(root, "first.html");
    const secondPath = resolve(root, "second.html");
    writeFileSync(firstPath, "first-before\n");
    writeFileSync(secondPath, "second-before\n");

    expect(() =>
      commitUiPrimitiveChangesAtomically(
        [
          { path: firstPath, content: "first-after\n" },
          { path: secondPath, content: "second-after\n" },
        ],
        {
          beforeInstall: (_path, index) => {
            if (index === 1) throw new Error("injected install failure");
          },
        },
      ),
    ).toThrow("injected install failure");
    expect(readFileSync(firstPath, "utf8")).toBe("first-before\n");
    expect(readFileSync(secondPath, "utf8")).toBe("second-before\n");
    for (const path of [firstPath, secondPath]) {
      expect(existsSync(`${path}.hf-ui-sync.tmp`)).toBe(false);
      expect(existsSync(`${path}.hf-ui-sync.bak`)).toBe(false);
    }
  });

  it("recovers a crash journal before a later write prepares new output", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-recovery-"));
    temporaryRoots.push(root);
    const path = resolve(root, "component.html");
    writeFileSync(path, "partially-installed\n");
    writeFileSync(`${path}.hf-ui-sync.bak`, "original\n");
    writeFileSync(`${path}.hf-ui-sync.tmp`, "staged\n");

    recoverUiPrimitiveChanges([path]);
    expect(readFileSync(path, "utf8")).toBe("original\n");
    expect(existsSync(`${path}.hf-ui-sync.tmp`)).toBe(false);
    expect(existsSync(`${path}.hf-ui-sync.bak`)).toBe(false);
  });

  it("keeps the whole new batch after a committed crash during partial backup cleanup", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-committed-recovery-"));
    temporaryRoots.push(root);
    const firstPath = resolve(root, "first.html");
    const secondPath = resolve(root, "second.html");
    const paths = [firstPath, secondPath];
    const journalPath = uiPrimitiveTransactionJournalPath(paths);
    writeFileSync(firstPath, "first-new\n");
    writeFileSync(secondPath, "second-new\n");
    writeFileSync(`${secondPath}.hf-ui-sync.bak`, "second-old\n");
    writeFileSync(
      journalPath,
      `${JSON.stringify(
        {
          version: 1,
          state: "committed",
          entries: paths.map((path) => ({ path })),
        },
        null,
        2,
      )}\n`,
    );

    recoverUiPrimitiveChanges(paths, journalPath);
    expect(readFileSync(firstPath, "utf8")).toBe("first-new\n");
    expect(readFileSync(secondPath, "utf8")).toBe("second-new\n");
    expect(existsSync(`${secondPath}.hf-ui-sync.bak`)).toBe(false);
    expect(existsSync(journalPath)).toBe(false);
  });

  it("rejects journal paths outside the supplied allowlist without touching them", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-malicious-journal-"));
    temporaryRoots.push(root);
    const allowedPath = resolve(root, "allowed.html");
    const outsidePath = resolve(root, "outside.html");
    const journalPath = uiPrimitiveTransactionJournalPath([allowedPath]);
    writeFileSync(allowedPath, "allowed\n");
    writeFileSync(outsidePath, "outside\n");
    writeFileSync(`${outsidePath}.hf-ui-sync.bak`, "malicious replacement\n");
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        version: 1,
        state: "installing",
        entries: [{ path: outsidePath }],
      })}\n`,
    );

    expect(() => recoverUiPrimitiveChanges([allowedPath], journalPath)).toThrow(
      "outside the allowed UI primitive scope",
    );
    expect(readFileSync(outsidePath, "utf8")).toBe("outside\n");
    expect(readFileSync(`${outsidePath}.hf-ui-sync.bak`, "utf8")).toBe("malicious replacement\n");
  });

  it("rejects duplicate and caller-supplied staging paths in a journal", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-invalid-journal-"));
    temporaryRoots.push(root);
    const path = resolve(root, "allowed.html");
    const journalPath = uiPrimitiveTransactionJournalPath([path]);
    writeFileSync(path, "allowed\n");
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        version: 1,
        state: "installing",
        entries: [{ path }, { path }],
      })}\n`,
    );
    expect(() => recoverUiPrimitiveChanges([path], journalPath)).toThrow("duplicate");

    writeFileSync(
      journalPath,
      `${JSON.stringify({
        version: 1,
        state: "installing",
        entries: [{ path, backupPath: resolve(root, "outside.bak") }],
      })}\n`,
    );
    expect(() => recoverUiPrimitiveChanges([path], journalPath)).toThrow("only path");
  });

  it("does not modify a canonical when its paired demo is missing", () => {
    const root = mkdtempSync(resolve(tmpdir(), "operator-black-missing-"));
    temporaryRoots.push(root);
    const canonicalPath = resolve(root, "button.html");
    writeFileSync(canonicalPath, canonical);
    expect(() =>
      syncUiPrimitiveFiles({
        id: "button",
        canonicalPath,
        demoPath: resolve(root, "missing-demo.html"),
        tokenBlock,
        mode: "write",
      }),
    ).toThrow("demo file is missing");
    expect(readFileSync(canonicalPath, "utf8")).toBe(canonical);
  });
});
