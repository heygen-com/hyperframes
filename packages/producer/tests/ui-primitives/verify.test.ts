import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const loadSubject = () => import("./verify.js");

function verificationModel(count = 66) {
  const items = Array.from(
    { length: count },
    (_, index) => `item-${String(index).padStart(2, "0")}`,
  );
  return {
    scope: { version: 1, name: "operator-black", items },
    states: {
      version: 1,
      name: "operator-black",
      items: items.map((id) => ({
        id,
        focusTarget: "none",
        renderCheckpoints: ["start", "end"],
      })),
    },
    checkpoints: {
      version: 2,
      selection: "declared-plus-midpoint-final-frame",
      sequentialPasses: 3,
      shuffledPasses: 1,
      includeMidpoint: true,
      includeFinalFrame: true,
      fps: 30,
      theme: "dark",
      viewport: "desktop-1440",
    },
  };
}

describe("Operator Black verification policy", () => {
  it("requires the exact sorted 66-item scope and matching state inventory", async () => {
    const { validateVerificationModel } = await loadSubject();
    const valid = verificationModel();

    expect(validateVerificationModel(valid)).toEqual([]);

    const invalid = verificationModel(65);
    invalid.scope.items = invalid.scope.items.toReversed();
    invalid.states.items.pop();
    invalid.checkpoints.sequentialPasses = 2;
    expect(validateVerificationModel(invalid).map((failure) => failure.category)).toEqual([
      "scope.count",
      "scope.order",
      "states.coverage",
      "determinism.sequential-passes",
    ]);
  });

  it("rejects duplicate inventory IDs and unpinned checkpoint policy", async () => {
    const { validateVerificationModel } = await loadSubject();
    const invalid = verificationModel();
    invalid.scope.items[1] = invalid.scope.items[0] ?? "item-00";
    invalid.states.items[1] = invalid.states.items[0] ?? invalid.states.items[1];
    invalid.checkpoints.selection = "hand-picked";
    invalid.checkpoints.shuffledPasses = 0;
    invalid.checkpoints.includeMidpoint = false;
    invalid.checkpoints.includeFinalFrame = false;
    invalid.checkpoints.fps = 24;
    invalid.checkpoints.theme = "light";
    invalid.checkpoints.viewport = "mobile-320";

    expect(validateVerificationModel(invalid).map((failure) => failure.category)).toEqual([
      "scope.unique",
      "states.unique",
      "determinism.selection",
      "determinism.shuffled-passes",
      "determinism.midpoint",
      "determinism.final-frame",
      "determinism.fps",
      "determinism.theme",
      "determinism.viewport",
    ]);
  });

  it("classifies empty, horizontally clipped, and overflowing presentations", async () => {
    const { auditPresentation } = await loadSubject();
    const viewport = { width: 320, height: 568 };

    expect(
      auditPresentation({
        viewport,
        documentScrollWidth: 320,
        documentScrollHeight: 568,
        root: { x: 8, y: 8, width: 304, height: 40 },
        visiblePaintedNodes: 1,
      }),
    ).toEqual([]);

    expect(
      auditPresentation({
        viewport,
        documentScrollWidth: 344,
        documentScrollHeight: 600,
        root: { x: -4, y: 8, width: 340, height: 0 },
        visiblePaintedNodes: 0,
      }).map((failure) => failure.category),
    ).toEqual([
      "layout.nonzero",
      "layout.horizontal-overflow",
      "layout.vertical-overflow",
      "layout.horizontal-clipping",
      "layout.paint",
    ]);
  });

  it("reports vertical clipping independently from scrollable page overflow", async () => {
    const { auditPresentation } = await loadSubject();

    expect(
      auditPresentation({
        viewport: { width: 390, height: 844 },
        documentScrollWidth: 390,
        documentScrollHeight: 844,
        root: { x: 24, y: 820, width: 342, height: 48 },
        visiblePaintedNodes: 1,
      }).map((failure) => failure.category),
    ).toEqual(["layout.vertical-clipping"]);
  });

  it("allows vertical-only scrolling for zoom reflow and short-height containment gates", async () => {
    const { auditPresentation } = await loadSubject();

    expect(
      auditPresentation(
        {
          viewport: { width: 320, height: 225 },
          documentScrollWidth: 320,
          documentScrollHeight: 900,
          root: { x: 8, y: 8, width: 304, height: 720 },
          visiblePaintedNodes: 1,
        },
        { allowVerticalScroll: true },
      ),
    ).toEqual([]);
  });

  it("enforces 40px visual controls and non-overlapping 44px coarse targets", async () => {
    const { auditTargetGeometry } = await loadSubject();

    expect(
      auditTargetGeometry([
        {
          selector: "button:nth-of-type(1)",
          requiresDefaultControlFace: true,
          visual: { x: 0, y: 0, width: 80, height: 40 },
          effective: { x: 0, y: -2, width: 80, height: 44 },
        },
        {
          selector: "button:nth-of-type(2)",
          requiresDefaultControlFace: true,
          visual: { x: 0, y: 48, width: 80, height: 40 },
          effective: { x: 0, y: 46, width: 80, height: 44 },
        },
      ]),
    ).toEqual([]);

    expect(
      auditTargetGeometry([
        {
          selector: "button:nth-of-type(1)",
          requiresDefaultControlFace: true,
          visual: { x: 0, y: 0, width: 32, height: 32 },
          effective: { x: 0, y: 0, width: 40, height: 40 },
        },
        {
          selector: "button:nth-of-type(2)",
          requiresDefaultControlFace: true,
          visual: { x: 0, y: 36, width: 80, height: 40 },
          effective: { x: 0, y: 34, width: 80, height: 44 },
        },
      ]).map((failure) => failure.category),
    ).toEqual(["target.visual-size", "target.coarse-size", "target.overlap"]);
  });

  it("permits compact functional faces while preserving their 44px effective target", async () => {
    const { auditTargetGeometry } = await loadSubject();

    expect(
      auditTargetGeometry([
        {
          selector: '[role="switch"]',
          requiresDefaultControlFace: false,
          visual: { x: 12, y: 12, width: 36, height: 20 },
          effective: { x: 8, y: 0, width: 44, height: 44 },
        },
      ]),
    ).toEqual([]);
  });

  it("does not treat a composite focus container as overlapping its owned child target", async () => {
    const { auditTargetGeometry } = await loadSubject();

    expect(
      auditTargetGeometry([
        {
          selector: ".menu",
          requiresDefaultControlFace: true,
          visual: { x: 0, y: 0, width: 200, height: 120 },
          effective: { x: 0, y: 0, width: 200, height: 120 },
        },
        {
          selector: ".menu-item",
          containers: [".menu"],
          requiresDefaultControlFace: true,
          visual: { x: 8, y: 8, width: 184, height: 44 },
          effective: { x: 8, y: 8, width: 184, height: 44 },
        },
      ]),
    ).toEqual([]);
  });

  it("audits visual faces without applying coarse-target policy on fine pointers", async () => {
    const { auditTargetGeometry } = await loadSubject();

    expect(
      auditTargetGeometry(
        [
          {
            selector: "button",
            requiresDefaultControlFace: true,
            visual: { x: 0, y: 0, width: 32, height: 32 },
            effective: { x: 0, y: 0, width: 32, height: 32 },
          },
        ],
        false,
      ).map((failure) => failure.category),
    ).toEqual(["target.visual-size"]);
  });

  it("reports missing and mismatched hashes between independent frame passes", async () => {
    const { compareFrameHashPasses } = await loadSubject();

    expect(compareFrameHashPasses({ "button:start": "a" }, { "button:start": "a" })).toEqual([]);
    expect(
      compareFrameHashPasses(
        { "button:start": "a", "button:end": "b" },
        { "button:start": "c", "input:start": "d" },
      ).map((failure) => failure.category),
    ).toEqual([
      "determinism.hash-mismatch",
      "determinism.missing-pass-two",
      "determinism.missing-pass-one",
    ]);
  });

  it("turns axe, name, ARIA, focus, and reduced-motion evidence into precise failures", async () => {
    const { auditSemanticSnapshot } = await loadSubject();

    expect(
      auditSemanticSnapshot({
        axeViolations: [
          { id: "color-contrast", impact: "serious", targets: [".bad-contrast"] },
          { id: "region", impact: "moderate", targets: ["main"] },
        ],
        unnamedControls: ["button:nth-of-type(2)"],
        brokenAriaReferences: ["#trigger aria-controls=missing"],
        duplicateIds: ["duplicate"],
        focus: {
          selector: ".target",
          found: true,
          focusable: false,
          sequential: false,
          indicatorVisible: false,
          ringContained: false,
          visible: false,
          unobscured: false,
        },
        reducedMotionMoving: [".spinner animation-duration=1s"],
      }).map((failure) => failure.category),
    ).toEqual([
      "accessibility.axe-serious",
      "accessibility.name",
      "accessibility.aria-reference",
      "accessibility.duplicate-id",
      "focus.unfocusable",
      "focus.not-sequential",
      "focus.indicator-missing",
      "focus.ring-clipped",
      "focus.clipped",
      "focus.obscured",
      "motion.reduced-css",
    ]);
  });

  it("rejects the aria-hidden-only closed fixture that the old semantic check missed", async () => {
    const { auditSemanticStateSnapshot } = await loadSubject();

    expect(
      auditSemanticStateSnapshot({
        state: "closed",
        mode: "controlled",
        relationshipValid: true,
        root: { found: true, hidden: false, inert: false, axPresent: true },
        controller: {
          found: true,
          expanded: "false",
          sequential: true,
          programmatic: true,
          axPresent: true,
        },
        region: {
          found: true,
          hidden: false,
          inert: false,
          sequentialFocusables: ["button"],
          programmaticFocusables: ["button"],
          axPresent: false,
        },
        axeViolations: [],
      }).map((failure) => failure.category),
    ).toEqual([
      "state.closed-not-hidden",
      "state.closed-not-inert",
      "state.closed-sequential-focus",
      "state.closed-programmatic-focus",
    ]);
  });

  it("accepts synchronized controlled and controller-less open/closed state pairs", async () => {
    const { auditSemanticStateSnapshot } = await loadSubject();
    const controlled = {
      mode: "controlled" as const,
      relationshipValid: true,
      root: { found: true, hidden: false, inert: false, axPresent: true },
      controller: {
        found: true,
        expanded: "true",
        sequential: true,
        programmatic: true,
        axPresent: true,
      },
      region: {
        found: true,
        hidden: false,
        inert: false,
        sequentialFocusables: ["button"],
        programmaticFocusables: ["button"],
        axPresent: true,
      },
      axeViolations: [],
    };
    expect(auditSemanticStateSnapshot({ ...controlled, state: "open" })).toEqual([]);
    expect(
      auditSemanticStateSnapshot({
        ...controlled,
        state: "closed",
        controller: { ...controlled.controller, expanded: "false" },
        region: {
          ...controlled.region,
          hidden: true,
          inert: true,
          sequentialFocusables: [],
          programmaticFocusables: [],
          axPresent: false,
        },
      }),
    ).toEqual([]);
    expect(
      auditSemanticStateSnapshot({
        state: "closed",
        mode: "root",
        relationshipValid: true,
        root: { found: true, hidden: true, inert: true, axPresent: false },
        controller: null,
        region: {
          found: true,
          hidden: true,
          inert: true,
          sequentialFocusables: [],
          programmaticFocusables: [],
          axPresent: false,
        },
        axeViolations: [],
      }),
    ).toEqual([]);
  });

  it("audits declared timeline labels, seek errors, runtime errors, and final paint", async () => {
    const { auditTimelineSnapshot } = await loadSubject();

    expect(
      auditTimelineSnapshot({
        declared: ["start", "open", "end"],
        labels: { start: 0, end: 4 },
        seekErrors: [{ checkpoint: "start", message: "seek exploded" }],
        consoleErrors: ["console exploded"],
        pageErrors: ["page exploded"],
        finalState: { stable: false, painted: false },
      }).map((failure) => failure.category),
    ).toEqual([
      "timeline.label-missing",
      "timeline.seek",
      "runtime.console",
      "runtime.page",
      "timeline.final-unstable",
      "timeline.final-unpainted",
    ]);
  });

  it("requires exact source and rendered canonical parity", async () => {
    const { auditCanonicalParity, auditThemeLayoutParity } = await loadSubject();

    expect(
      auditCanonicalParity({
        canonicalSource: "<button>one</button>",
        demoCanonicalSource: "<button>two</button>",
        canonicalHash: "abc",
        demoCanonicalHash: "def",
      }).map((failure) => failure.category),
    ).toEqual(["parity.source", "parity.render"]);

    expect(
      auditThemeLayoutParity(
        [{ path: "root", values: ["block", 10, 20] }],
        [{ path: "root", values: ["block", 10, 20] }],
      ),
    ).toEqual([]);
    expect(
      auditThemeLayoutParity(
        [{ path: "root", values: ["block", 10, 20] }],
        [{ path: "root", values: ["grid", 10, 21] }],
      ).map((failure) => failure.category),
    ).toEqual(["parity.theme-layout"]);
  });

  it("strictly parses scoped verifier CLI options", async () => {
    const { parseArgs } = await loadSubject();

    expect(
      parseArgs([
        "--json",
        "--only",
        "button",
        "--artifacts-dir",
        "/tmp/operator-black",
        "--update-frame-hashes",
      ]),
    ).toEqual({
      json: true,
      only: "button",
      artifactsDir: "/tmp/operator-black",
      updateFrameHashes: true,
    });
    expect(() => parseArgs(["--only", "button", "--only", "input"])).toThrow("only once");
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown");
    expect(() => parseArgs(["--update-frame-hashes", "--update-frame-hashes"])).toThrow(
      "only once",
    );
  });

  it("summarizes checks, failed primitives, and categories without hiding duplicates", async () => {
    const { buildVerificationSummary } = await loadSubject();
    const failures = [
      { id: "button", category: "layout.horizontal-overflow", message: "overflow" },
      { id: "button", category: "layout.horizontal-overflow", message: "overflow again" },
    ];

    expect(buildVerificationSummary(["button", "input"], 7, failures)).toEqual({
      primitives: { total: 2, passed: 1, failed: 1 },
      checks: { total: 7, passed: 5, failed: 2 },
      failureCategories: { "layout.horizontal-overflow": 2 },
    });
  });

  it("pins axe-core and declares all-inventory checkpoint selection", () => {
    const packageJson = JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8"));
    const checkpoints = JSON.parse(readFileSync(resolve(here, "frame-checkpoints.json"), "utf8"));

    expect(packageJson.devDependencies?.["axe-core"]).toBe("4.10.3");
    expect(packageJson.scripts?.["verify:ui-primitives"]).toBe("tsx tests/ui-primitives/runner.ts");
    expect(checkpoints).toEqual({
      version: 2,
      selection: "declared-plus-midpoint-final-frame",
      sequentialPasses: 3,
      shuffledPasses: 1,
      includeMidpoint: true,
      includeFinalFrame: true,
      fps: 30,
      theme: "dark",
      viewport: "desktop-1440",
    });

    const workflow = readFileSync(
      resolve(here, "../../../../.github/workflows/ui-primitives.yml"),
      "utf8",
    );
    const imageLock = JSON.parse(
      readFileSync(
        resolve(here, "../../../../registry/ui-primitives/visual-test-image.lock.json"),
        "utf8",
      ),
    );
    expect(workflow).toContain('"packages/producer/tests/ui-primitives/**"');
    expect(workflow).toContain('"packages/producer/package.json"');
    expect(workflow).toContain('"bun.lock"');
    expect(workflow).toContain('"scripts/generate-catalog-previews.ts"');
    expect(workflow).toContain(`${imageLock.container.image}@${imageLock.container.digest}`);
    expect(workflow).toContain("bun run --cwd packages/producer verify:ui-primitives");
    expect(workflow).toContain("packages/core/src/registry/uiPrimitivesSync.test.ts");
    expect(workflow).toContain("packages/core/src/registry/uiPrimitivesStyleAudit.test.ts");
    expect(workflow).toContain("packages/core/src/registry/uiPrimitivesPreview.test.ts");
    expect(workflow).toContain("bunx tsx scripts/sync-ui-primitives.ts --check");
    expect(workflow.match(/bun-version: 1\.3\.14/g)).toHaveLength(2);
  });
});
