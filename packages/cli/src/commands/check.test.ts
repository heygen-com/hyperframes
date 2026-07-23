import { runCommand } from "citty";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const trackCheckReport = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackCheckReport: (...args: unknown[]) => trackCheckReport(...args),
  trackCommandFailure: vi.fn(),
}));

import { contrastRatio, parseColorRGBA } from "./contrast-bg.js";
import { createCheckCommand } from "./check.js";
import {
  DEFAULT_CHECK_OPTIONS,
  checkExitCode,
  findingCropFilename,
  runAuditGrid,
  runCheckPipeline,
  selectContrastTimes,
  selectFindingCropRequests,
  type AnchoredLayoutIssue,
  type CheckAnchor,
  type CheckAuditDriver,
  type CheckBrowserResult,
  type CheckDependencies,
  type CheckFinding,
  type CheckFindingCropRequest,
  type CheckOptions,
  type CheckReport,
  type ContrastAuditEntry,
  type MotionSpecResolution,
} from "../utils/checkPipeline.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";
import { consumeCommandResult } from "../utils/commandResult.js";
import type { ProjectLintResult } from "../utils/lintProject.js";
import type {
  LayoutIssue,
  LayoutIssueCode,
  LayoutOverflow,
  LayoutRect,
} from "../utils/layoutAudit.js";
import type { ProjectDir } from "../utils/project.js";

const PROJECT: ProjectDir = {
  dir: "/project",
  name: "project",
  indexPath: "/project/index.html",
};
const PNG_BASE64 = Buffer.from("png-bytes").toString("base64");
afterEach(() => {
  consumeCommandResult();
  trackCheckReport.mockClear();
  vi.restoreAllMocks();
});

function cleanLint(): ProjectLintResult {
  return {
    results: [
      {
        file: "index.html",
        result: {
          ok: true,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          findings: [],
        },
      },
    ],
    totalErrors: 0,
    totalWarnings: 0,
    totalInfos: 0,
  };
}

function lintWith(
  severity: "error" | "warning" | "info",
  code: string,
  message: string,
): ProjectLintResult {
  return {
    results: [
      {
        file: "index.html",
        result: {
          ok: severity !== "error",
          errorCount: severity === "error" ? 1 : 0,
          warningCount: severity === "warning" ? 1 : 0,
          infoCount: severity === "info" ? 1 : 0,
          findings: [{ severity, code, message }],
        },
      },
    ],
    totalErrors: severity === "error" ? 1 : 0,
    totalWarnings: severity === "warning" ? 1 : 0,
    totalInfos: severity === "info" ? 1 : 0,
  };
}

function anchor(selector: string, time: number): CheckAnchor {
  return {
    selector,
    dataAttributes: { "data-layout-name": "hero" },
    sourceFile: "compositions/scene.html",
    bbox: { x: 10, y: 20, width: 300, height: 80 },
    time,
  };
}

function layoutIssue(
  severity: "error" | "warning" | "info" = "error",
  overrides: { time?: number; code?: AnchoredLayoutIssue["code"] } = {},
): AnchoredLayoutIssue {
  const time = overrides.time ?? 0.5;
  return {
    ...anchor("#hero", time),
    code: overrides.code ?? (severity === "warning" ? "content_overlap" : "clipped_text"),
    severity,
    text: "Hero",
    message: severity === "warning" ? "Text may overlap." : "Text is clipped.",
    rect: { left: 10, top: 20, right: 310, bottom: 100, width: 300, height: 80 },
  };
}

function contrastEntry(overrides: Partial<ContrastAuditEntry> = {}): ContrastAuditEntry {
  return {
    ...anchor("#hero", 0.5),
    text: "Body text",
    ratio: 2.5,
    wcagAA: false,
    large: false,
    fg: "rgb(110,110,110)",
    bg: "rgb(30,30,30)",
    ...overrides,
  };
}

function fakeDriver(overrides: Partial<CheckAuditDriver> = {}): CheckAuditDriver {
  // A distinct string per call so the frozen-sweep guard (#U10) never fires
  // by accident in unrelated scenarios — tests that want it force a constant
  // via `collectLayoutGeometry: vi.fn(async () => "same")`.
  let geometryCallCount = 0;
  return {
    initialize: vi.fn(async (_contrast: boolean) => undefined),
    getDuration: vi.fn(async () => 9),
    getTransitionBoundaries: vi.fn(async () => []),
    getCanvas: vi.fn(async () => ({ width: 1920, height: 1080 })),
    findAmbiguousSelectors: vi.fn(async (_selectors: string[]) => []),
    seek: vi.fn(async (_time: number) => undefined),
    collectLayout: vi.fn(async (_time: number, _tolerance: number) => []),
    collectLayoutGeometry: vi.fn(async () => `geometry-${geometryCallCount++}`),
    collectRotationSample: vi.fn(async (_time: number) => []),
    collectGeometryCandidates: vi.fn(async () => []),
    collectMotionFrame: vi.fn(async (time: number) => ({ time, data: {}, liveness: {} })),
    anchorMotionIssues: vi.fn(async (issues: LayoutIssue[]) =>
      issues.map((issue) => ({
        ...issue,
        ...anchor(issue.selector, issue.time),
      })),
    ),
    collectContrast: vi.fn(async (_time: number) => ({ entries: [], pngBase64: PNG_BASE64 })),
    ...overrides,
  };
}

interface GeometryFixture {
  kind: "text" | "media";
  tag: string;
  text: string;
  selector: string;
  rect: LayoutRect;
  elementRect?: LayoutRect;
  time: number;
  overflow?: LayoutOverflow;
}

function geometryCandidate(fixture: GeometryFixture) {
  return {
    ...anchor(fixture.selector, fixture.time),
    kind: fixture.kind,
    tag: fixture.tag,
    text: fixture.text,
    rect: fixture.rect,
    elementRect: fixture.elementRect ?? fixture.rect,
    bbox: {
      x: fixture.rect.left,
      y: fixture.rect.top,
      width: fixture.rect.width,
      height: fixture.rect.height,
    },
    overflow: fixture.overflow,
  };
}

function fixtureRect(left: number, top: number, width: number, height: number): LayoutRect {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function checkBrowserSource(): string {
  return readFileSync(new URL("../utils/checkBrowser.ts", import.meta.url), "utf8");
}

async function gateCandidates(
  time: number,
  request: { text: boolean; media: boolean; tolerance: number },
) {
  const candidates = [];
  if (request.text) {
    candidates.push(
      geometryCandidate({
        kind: "text",
        tag: "h2",
        text: "Repeated heading",
        selector: time === 2 ? "#first-heading" : "#later-heading",
        rect: fixtureRect(800, 880, 320, 60),
        time,
      }),
    );
  }
  if (request.media) {
    candidates.push(
      geometryCandidate({
        kind: "media",
        tag: "video",
        text: "video",
        selector: "#midpoint-video",
        rect: fixtureRect(-140, 100, 100, 100),
        overflow: { left: 140 },
        time,
      }),
    );
  }
  return candidates;
}

function noMotion(): MotionSpecResolution {
  return { kind: "none" };
}

function heroMotionFrame(time: number, visibleAt: (time: number) => boolean) {
  return {
    time,
    data: {
      "#hero": {
        rect: { left: 10, top: 20, right: 310, bottom: 100, width: 300, height: 80 },
        opacity: visibleAt(time) ? 1 : 0,
        visible: visibleAt(time),
      },
    },
    liveness: {},
  };
}

function dependencies(
  driver: CheckAuditDriver,
  options: {
    lint?: ProjectLintResult;
    motion?: MotionSpecResolution;
    runtime?: CheckFinding[];
    writeSnapshot?: CheckDependencies["writeSnapshot"];
    captureFindingCrops?: CheckDependencies["captureFindingCrops"];
  } = {},
): { deps: CheckDependencies; runBrowserCheck: ReturnType<typeof vi.fn> } {
  const runBrowserCheck = vi.fn(
    async (
      _project: ProjectDir,
      checkOptions: CheckOptions,
      motion: MotionSpecResolution,
    ): Promise<CheckBrowserResult> => {
      const result = await runAuditGrid(driver, checkOptions, motion);
      return { ...result, runtimeFindings: options.runtime ?? [] };
    },
  );
  const deps: CheckDependencies = {
    lintProject: vi.fn(async () => options.lint ?? cleanLint()),
    resolveMotionSpec: vi.fn(() => options.motion ?? noMotion()),
    runBrowserCheck,
    writeSnapshot:
      options.writeSnapshot ??
      vi.fn((_projectDir: string, index: number, time: number, _pngBase64: string) =>
        Promise.resolve(
          `snapshots/frame-${String(index).padStart(2, "0")}-at-${time.toFixed(1)}s.png`,
        ),
      ),
    captureFindingCrops: options.captureFindingCrops ?? vi.fn(async () => []),
  };
  return { deps, runBrowserCheck };
}

async function runScenario(
  driver: CheckAuditDriver,
  optionOverrides: Partial<CheckOptions> = {},
  dependencyOverrides: Parameters<typeof dependencies>[1] = {},
): Promise<{ report: CheckReport; deps: CheckDependencies; browser: ReturnType<typeof vi.fn> }> {
  const { deps, runBrowserCheck } = dependencies(driver, dependencyOverrides);
  const report = await runCheckPipeline(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, ...optionOverrides },
    deps,
  );
  return { report, deps, browser: runBrowserCheck };
}

function runtimeError(): CheckFinding {
  return {
    code: "console_error",
    severity: "error",
    message: "boom",
    ...anchor("[data-composition-id]", 0),
  };
}

describe("contrast sample selection", () => {
  it("chooses five evenly distributed grid points including both ends", () => {
    expect(selectContrastTimes([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5])).toEqual([
      0.5, 2.5, 4.5, 6.5, 8.5,
    ]);
    expect(selectContrastTimes([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

it("parses the caption-zone grammar and enables the frame gate", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    withMeta: (value) => value,
  });

  await runCommand(command, {
    rawArgs: [
      "--json",
      "--caption-zone",
      "x0=0;y0=.82;x1=1;y1=1;severity=error;seek=.25,1",
      "--frame-check",
    ],
  });

  expect(runPipeline).toHaveBeenCalledWith(
    PROJECT,
    expect.objectContaining({
      captionZone: {
        x0: 0,
        y0: 0.82,
        x1: 1,
        y1: 1,
        severity: "error",
        seek: [0.25, 1],
      },
      frameCheck: {},
    }),
  );
});

it("threads --no-proxy into the browser check options", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    withMeta: (value) => value,
  });

  await runCommand(command, { rawArgs: ["--json", "--no-proxy"] });

  expect(runPipeline).toHaveBeenCalledWith(PROJECT, expect.objectContaining({ autoProxy: false }));
});

it("rejects malformed caption-zone specs instead of silently disabling the gate", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async () => report);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    withMeta: (value) => ({ ...value, _meta: { version: "test" } }),
  });

  await runCommand(command, {
    rawArgs: ["--json", "--caption-zone", "x0=0;y0=.8;x1=1;y1=1.2"],
  });

  expect(runPipeline).not.toHaveBeenCalled();
  expect(consumeCommandResult().exitCode).toBe(1);
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
    ok: false,
    error: expect.stringContaining("Invalid --caption-zone"),
    _meta: { version: "test" },
  });
});

it("flags only text whose center is inside the caption band at the default end seek", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Centered title",
      selector: "#centered",
      rect: fixtureRect(860, 870, 200, 60),
      time,
    }),
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Overlap only",
      selector: "#overlap-only",
      rect: fixtureRect(860, 830, 200, 60),
      time,
    }),
  ]);
  const { report } = await runScenario(
    fakeDriver({
      getDuration: vi.fn(async () => 10),
      collectGeometryCandidates,
    }),
    {
      samples: 1,
      contrast: false,
      captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 0.9 },
    },
  );

  expect(collectGeometryCandidates).toHaveBeenCalledTimes(1);
  expect(collectGeometryCandidates).toHaveBeenCalledWith(10, {
    text: true,
    media: false,
    tolerance: 2,
  });
  expect(report.layout.samples).toEqual([5, 10]);
  expect(report.layout.findings).toEqual([
    expect.objectContaining({
      code: "caption_zone_collision",
      severity: "warning",
      selector: "#centered",
      text: "Centered title",
      time: 10,
    }),
  ]);
  expect(report.ok).toBe(true);
});

it("filters caption candidates by the element box while centering the text rect", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Full-frame wrapper copy",
      selector: "#full-frame-wrapper",
      rect: fixtureRect(860, 870, 200, 60),
      elementRect: fixtureRect(0, 0, 1920, 1080),
      time,
    }),
    geometryCandidate({
      kind: "text",
      tag: "span",
      text: "Tiny wrapper copy",
      selector: "#tiny-wrapper",
      rect: fixtureRect(860, 870, 200, 60),
      elementRect: fixtureRect(860, 870, 3, 3),
      time,
    }),
  ]);
  const { report } = await runScenario(fakeDriver({ collectGeometryCandidates }), {
    contrast: false,
    captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 0.9 },
  });

  expect(report.layout.findings).toEqual([]);
});

it("checks media overflow at the default midpoint and applies warning severity", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "media",
      tag: "img",
      text: "img",
      selector: "#hero-image",
      rect: fixtureRect(1840, 100, 220, 200),
      overflow: { right: 140 },
      time,
    }),
  ]);
  const { report } = await runScenario(
    fakeDriver({ getDuration: vi.fn(async () => 10), collectGeometryCandidates }),
    { samples: 1, contrast: false, frameCheck: {} },
  );

  expect(collectGeometryCandidates).toHaveBeenCalledWith(5, {
    text: false,
    media: true,
    tolerance: 2,
  });
  expect(report.layout.findings[0]).toMatchObject({
    code: "frame_out_of_frame",
    severity: "warning",
    selector: "#hero-image",
    overflow: { right: 140 },
    time: 5,
  });
});

it("converts progress seeks to time, gates each collector, and keeps the first caption hit", async () => {
  const collectGeometryCandidates = vi.fn(gateCandidates);
  const { report } = await runScenario(
    fakeDriver({
      getDuration: vi.fn(async () => 8),
      collectGeometryCandidates,
    }),
    {
      samples: 1,
      contrast: false,
      captionZone: {
        x0: 0,
        y0: 0.8,
        x1: 1,
        y1: 0.9,
        severity: "error",
        seek: [0.25, 0.75],
      },
      frameCheck: { severity: "error" },
    },
  );

  expect(report.layout.samples).toEqual([2, 4, 6]);
  expect(collectGeometryCandidates.mock.calls).toEqual([
    [2, { text: true, media: false, tolerance: 2 }],
    [4, { text: false, media: true, tolerance: 2 }],
    [6, { text: true, media: false, tolerance: 2 }],
  ]);
  expect(report.layout.findings).toEqual([
    expect.objectContaining({
      code: "caption_zone_collision",
      severity: "error",
      selector: "#first-heading",
      time: 2,
    }),
    expect.objectContaining({ code: "frame_out_of_frame", severity: "error", time: 4 }),
  ]);
  expect(report.ok).toBe(false);
});

it("does not collect or emit opt-in geometry findings when both flags are off", async () => {
  const collectGeometryCandidates = vi.fn(async () => [
    geometryCandidate({
      kind: "media",
      tag: "video",
      text: "video",
      selector: "#video",
      rect: fixtureRect(1900, 0, 200, 200),
      overflow: { right: 180 },
      time: 4.5,
    }),
  ]);
  const { report } = await runScenario(fakeDriver({ collectGeometryCandidates }), {
    contrast: false,
  });

  expect(collectGeometryCandidates).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).not.toContain("caption_zone_collision");
  expect(JSON.stringify(report)).not.toContain("frame_out_of_frame");
});

it("computes caption bands from a portrait composition viewport", async () => {
  const viewport = resolveCompositionViewportFromHtml(
    '<div data-composition-id="portrait" data-width="1080" data-height="1920"></div>',
  );
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "text",
      tag: "p",
      text: "Portrait caption collision",
      selector: "#portrait-copy",
      rect: fixtureRect(480, 1570, 120, 60),
      time,
    }),
  ]);
  const getCanvas = vi.fn(async () => viewport);
  const { report } = await runScenario(
    fakeDriver({
      getDuration: vi.fn(async () => 4),
      getCanvas,
      collectGeometryCandidates,
    }),
    {
      samples: 1,
      contrast: false,
      captionZone: { x0: 0.4, y0: 0.8, x1: 0.6, y1: 0.9 },
    },
  );

  expect(viewport).toEqual({ width: 1080, height: 1920 });
  expect(getCanvas).toHaveBeenCalled();
  expect(report.layout.findings).toEqual([
    expect.objectContaining({ code: "caption_zone_collision", selector: "#portrait-copy" }),
  ]);
});

it("suppresses frame breaches below the per-canvas floor and reports those above it", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "media",
      tag: "canvas",
      text: "canvas",
      selector: "#under-floor",
      rect: fixtureRect(3980, 100, 199, 100),
      overflow: { right: 179 },
      time,
    }),
    geometryCandidate({
      kind: "media",
      tag: "canvas",
      text: "canvas",
      selector: "#over-floor",
      rect: fixtureRect(3980, 300, 201, 100),
      overflow: { right: 181 },
      time,
    }),
  ]);
  const { report } = await runScenario(
    fakeDriver({
      getCanvas: vi.fn(async () => ({ width: 4000, height: 3000 })),
      collectGeometryCandidates,
    }),
    {
      contrast: false,
      frameCheck: {},
    },
  );

  expect(report.layout.findings).toEqual([
    expect.objectContaining({
      code: "frame_out_of_frame",
      selector: "#over-floor",
      overflow: { right: 181 },
    }),
  ]);
});

it("keeps frame findings at distinct rounded positions across requested seeks", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "media",
      tag: "img",
      text: "img",
      selector: "#moving-image",
      rect: fixtureRect(1920, time === 2 ? 100 : 300, 130, 100),
      overflow: { right: 130 },
      time,
    }),
  ]);
  const { report } = await runScenario(
    fakeDriver({
      getDuration: vi.fn(async () => 8),
      collectGeometryCandidates,
    }),
    {
      samples: 1,
      contrast: false,
      frameCheck: { seek: [0.25, 0.75] },
    },
  );

  expect(report.layout.findings).toEqual([
    expect.objectContaining({ code: "frame_out_of_frame", time: 2 }),
    expect.objectContaining({ code: "frame_out_of_frame", time: 6 }),
  ]);
});

it("keeps contrast and snapshot sampling on the pre-gate layout grid", async () => {
  const collectContrast = vi.fn(async () => ({ entries: [], pngBase64: PNG_BASE64 }));
  const { report } = await runScenario(
    fakeDriver({
      getDuration: vi.fn(async () => 10),
      collectContrast,
    }),
    {
      samples: 1,
      captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 1 },
    },
  );

  expect(report.layout.samples).toEqual([5, 10]);
  expect(report.contrast.samples).toEqual([5]);
  expect(collectContrast).toHaveBeenCalledTimes(1);
  expect(collectContrast).toHaveBeenCalledWith(5);
});

function layoutFindingOf(
  code: LayoutIssueCode,
  severity: "error" | "warning" | "info",
  bbox: { x: number; y: number; width: number; height: number },
  time = 1,
): AnchoredLayoutIssue {
  return {
    code,
    severity,
    message: code,
    ...anchor("#el", time),
    bbox,
    rect: {
      left: bbox.x,
      top: bbox.y,
      right: bbox.x + bbox.width,
      bottom: bbox.y + bbox.height,
      ...bbox,
    },
  };
}

function checkFindingOf(
  code: string,
  severity: "error" | "warning" | "info",
  bbox: { x: number; y: number; width: number; height: number },
  time = 1,
): CheckFinding {
  return { code, severity, message: code, ...anchor("#el", time), bbox };
}

function emptySection<T extends CheckFinding>(findings: T[] = []) {
  return { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings };
}

function reportWithFindings(overrides: Partial<CheckReport> = {}): CheckReport {
  return {
    ok: true,
    strict: false,
    lint: { ...emptySection(), filesScanned: 0 },
    runtime: emptySection(),
    layout: {
      ...emptySection(),
      duration: 10,
      samples: [],
      transitionSamples: [],
      transitionSamplesDropped: 0,
      tolerance: 2,
      totalIssueCount: 0,
      truncated: false,
    },
    motion: { ...emptySection(), enabled: false, samples: 0 },
    contrast: { ...emptySection(), enabled: true, samples: [], checked: 0, passed: 0 },
    snapshots: { enabled: false, files: [], times: [], findingFiles: [] },
    ...overrides,
  };
}

describe("selectFindingCropRequests", () => {
  const NON_ZERO_BBOX = { x: 10, y: 20, width: 100, height: 50 };
  const ZERO_BBOX = { x: 0, y: 0, width: 0, height: 0 };

  it("filenames a request finding-NN-<code>.png with the finding's time and bbox", () => {
    const report = reportWithFindings({
      layout: {
        ...reportWithFindings().layout,
        findings: [layoutFindingOf("clipped_text", "error", NON_ZERO_BBOX, 2.5)],
      },
    });

    expect(selectFindingCropRequests(report)).toEqual([
      { filename: "finding-00-clipped_text.png", time: 2.5, bbox: NON_ZERO_BBOX },
    ]);
  });

  it("skips warnings/info and findings without a real bbox", () => {
    const report = reportWithFindings({
      layout: {
        ...reportWithFindings().layout,
        findings: [
          layoutFindingOf("content_overlap", "warning", NON_ZERO_BBOX),
          layoutFindingOf("clipped_text", "error", ZERO_BBOX),
        ],
      },
      runtime: { ...emptySection([checkFindingOf("console_error", "info", NON_ZERO_BBOX)]) },
    });

    expect(selectFindingCropRequests(report)).toEqual([]);
  });

  it("caps at 12 requests across sections", () => {
    const findings = Array.from({ length: 15 }, (_, index) =>
      checkFindingOf(`code_${index}`, "error", NON_ZERO_BBOX, index),
    );
    const report = reportWithFindings({
      runtime: { ...emptySection(findings) },
    });

    const requests = selectFindingCropRequests(report);
    expect(requests).toHaveLength(12);
    expect(requests[0]?.filename).toBe(findingCropFilename(0, "code_0"));
    expect(requests[11]?.filename).toBe(findingCropFilename(11, "code_11"));
  });

  it("sanitizes unusual characters out of the code when building a filename", () => {
    expect(findingCropFilename(3, "weird code/name")).toBe("finding-03-weird_code_name.png");
  });
});

describe("check pipeline", () => {
  afterEach(() => {
    consumeCommandResult();
    vi.restoreAllMocks();
  });

  it("emits one clean JSON envelope with every section and exit 0", async () => {
    const { report } = await runScenario(fakeDriver());
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const command = createCheckCommand({
      resolveProject: () => PROJECT,
      runPipeline: vi.fn(async () => report),
      withMeta: (value) => ({ ...value, _meta: { version: "test" } }),
    });

    await runCommand(command, { rawArgs: ["--json"] });

    expect(report.ok).toBe(true);
    expect(checkExitCode(report)).toBe(0);
    expect(consumeCommandResult().exitCode).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0]?.[0];
    expect(typeof output).toBe("string");
    if (typeof output !== "string") throw new Error("expected JSON output");
    const envelope = JSON.parse(output);
    expect(envelope).toMatchObject({
      ok: true,
      lint: { ok: true },
      runtime: { ok: true },
      layout: { ok: true },
      motion: { ok: true },
      contrast: { ok: true },
      snapshots: { enabled: false },
      _meta: { version: "test" },
    });
  });

  it("short-circuits on lint errors without launching a browser", async () => {
    const lint = lintWith(
      "error",
      "root_missing_composition_id",
      "Root element needs data-composition-id.",
    );
    const { report, browser } = await runScenario(fakeDriver(), {}, { lint });

    expect(report.ok).toBe(false);
    expect(checkExitCode(report)).toBe(1);
    expect(report.lint.findings).toHaveLength(1);
    expect(browser).not.toHaveBeenCalled();
  });

  it("gates AA contrast failures and --no-contrast skips the pass", async () => {
    const failingContrast = vi.fn(async (time: number) => ({
      entries: time === 0.5 ? [contrastEntry()] : [],
      pngBase64: PNG_BASE64,
    }));
    const { report } = await runScenario(fakeDriver({ collectContrast: failingContrast }));
    expect(report.ok).toBe(false);
    expect(checkExitCode(report)).toBe(1);
    expect(report.contrast.errorCount).toBe(1);

    const skippedContrast = vi.fn(async () => ({
      entries: [contrastEntry()],
      pngBase64: PNG_BASE64,
    }));
    const skipped = await runScenario(fakeDriver({ collectContrast: skippedContrast }), {
      contrast: false,
    });
    expect(skipped.report.ok).toBe(true);
    expect(checkExitCode(skipped.report)).toBe(0);
    expect(skipped.report.contrast.enabled).toBe(false);
    expect(skippedContrast).not.toHaveBeenCalled();
  });

  it("includes measured colors, thresholds, and a passing palette-direction suggestion", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectContrast: vi.fn(async () => ({
          entries: [contrastEntry()],
          pngBase64: PNG_BASE64,
        })),
      }),
    );
    const finding = report.contrast.findings[0];
    expect(finding).toMatchObject({
      fg: "rgb(110,110,110)",
      bg: "rgb(30,30,30)",
      ratio: 2.5,
      requiredRatio: 4.5,
    });
    if (!finding) throw new Error("expected contrast finding");
    const suggested = parseColorRGBA(finding.suggestedColor);
    const background = parseColorRGBA(finding.bg);
    expect(suggested).not.toBeNull();
    expect(background).not.toBeNull();
    if (!suggested || !background) throw new Error("expected parseable colors");
    expect(
      contrastRatio(
        [suggested[0], suggested[1], suggested[2]],
        [background[0], background[1], background[2]],
      ),
    ).toBeGreaterThanOrEqual(finding.requiredRatio);
    expect(suggested[0]).toBeGreaterThan(110);
  });

  it("preserves a resolving selector, source file, identity, bbox, and sample time", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
      }),
    );
    expect(report.layout.findings[0]).toMatchObject({
      selector: "#hero",
      dataAttributes: { "data-layout-name": "hero" },
      sourceFile: "compositions/scene.html",
      bbox: { x: 10, y: 20, width: 300, height: 80 },
      time: 0.5,
    });
  });

  it("reports layout and runtime errors from one browser session", async () => {
    const { report, browser } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
      }),
      {},
      { runtime: [runtimeError()] },
    );
    expect(report.runtime.errorCount).toBe(1);
    expect(report.layout.errorCount).toBe(1);
    expect(browser).toHaveBeenCalledTimes(1);
  });

  it("reports a failing appearsBy sidecar as motion_appears_late", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: { assertions: [{ kind: "appearsBy", selector: "#hero", bySec: 0.2 }] },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      collectMotionFrame: vi.fn(async (time: number) => heroMotionFrame(time, (t) => t >= 0.5)),
    });
    const { report } = await runScenario(driver, {}, { motion });

    expect(report.motion.findings).toEqual([
      expect.objectContaining({
        code: "motion_appears_late",
        severity: "error",
        selector: "#hero",
      }),
    ]);
    expect(report.ok).toBe(false);
  });

  it("writes cached contrast PNGs only with --snapshots at the contrast timestamps", async () => {
    const writer = vi.fn(
      async (_projectDir: string, index: number, time: number, _pngBase64: string) =>
        `snapshots/frame-${String(index).padStart(2, "0")}-at-${time.toFixed(1)}s.png`,
    );
    const captured = fakeDriver({
      collectContrast: vi.fn(async () => ({ entries: [], pngBase64: PNG_BASE64 })),
    });
    const { report } = await runScenario(captured, { snapshots: true }, { writeSnapshot: writer });

    expect(report.snapshots.times).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
    expect(report.snapshots.files).toEqual([
      "snapshots/frame-00-at-0.5s.png",
      "snapshots/frame-01-at-2.5s.png",
      "snapshots/frame-02-at-4.5s.png",
      "snapshots/frame-03-at-6.5s.png",
      "snapshots/frame-04-at-8.5s.png",
    ]);
    expect(writer).toHaveBeenCalledTimes(5);

    const absentWriter = vi.fn(async () => "unused.png");
    await runScenario(fakeDriver(), { snapshots: false }, { writeSnapshot: absentWriter });
    expect(absentWriter).not.toHaveBeenCalled();
  });

  it("captures finding crops for error findings with bboxes only when --snapshots is set", async () => {
    const capture = vi.fn(
      async (
        _project: ProjectDir,
        _options: CheckOptions,
        _requests: CheckFindingCropRequest[],
      ) => ["snapshots/finding-00-clipped_text.png"],
    );
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
      }),
      { snapshots: true },
      { captureFindingCrops: capture },
    );

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[2]).toEqual([
      {
        filename: "finding-00-clipped_text.png",
        time: 0.5,
        bbox: { x: 10, y: 20, width: 300, height: 80 },
      },
    ]);
    expect(report.snapshots.findingFiles).toEqual(["snapshots/finding-00-clipped_text.png"]);

    const withoutSnapshots = vi.fn(async () => ["unused.png"]);
    await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
      }),
      { snapshots: false },
      { captureFindingCrops: withoutSnapshots },
    );
    expect(withoutSnapshots).not.toHaveBeenCalled();

    const noErrors = vi.fn(async () => ["unused.png"]);
    await runScenario(
      fakeDriver({
        collectLayout: vi.fn(
          async (time: number) =>
            // container_overflow, not content_overlap: this fixture wants a plain
            // warning-severity finding held across the whole run, unaffected by
            // content_overlap's #U10 held-duration re-promotion to error.
            [layoutIssue("warning", { time, code: "container_overflow" })],
        ),
      }),
      { snapshots: true },
      { captureFindingCrops: noErrors },
    );
    expect(noErrors).not.toHaveBeenCalled();
  });

  it("--strict flips a warnings-only result from exit 0 to exit 1", async () => {
    const warningDriver = () =>
      fakeDriver({
        collectLayout: vi.fn(
          async (time: number) =>
            // container_overflow, not content_overlap: this fixture wants a plain
            // warning-severity finding held across the whole run, unaffected by
            // content_overlap's #U10 held-duration re-promotion to error.
            [layoutIssue("warning", { time, code: "container_overflow" })],
        ),
      });
    const normal = await runScenario(warningDriver(), { strict: false });
    const strict = await runScenario(warningDriver(), { strict: true });

    expect(checkExitCode(normal.report)).toBe(0);
    expect(checkExitCode(strict.report)).toBe(1);
  });

  it("fails clearly without samples when no timeline duration is available, without hanging", async () => {
    const driver = fakeDriver({ getDuration: vi.fn(async () => 0) });
    await expect(runAuditGrid(driver, DEFAULT_CHECK_OPTIONS, noMotion())).rejects.toThrow(
      "Could not determine composition duration — no layout samples run",
    );
    await expect(
      runAuditGrid(
        driver,
        {
          ...DEFAULT_CHECK_OPTIONS,
          captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 1 },
        },
        noMotion(),
      ),
    ).rejects.toThrow("Could not determine composition duration — no layout samples run");

    const { report, browser } = await runScenario(driver);
    expect(browser).toHaveBeenCalledTimes(1);
    expect(report.runtime.findings[0]?.message).toContain(
      "Could not determine composition duration — no layout samples run",
    );
    expect(checkExitCode(report)).toBe(1);
  });

  describe("frozen-sweep guard (#U10)", () => {
    it("fails with sweep_static when a 6s composition's geometry never changes across samples", async () => {
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
      });
      const { report } = await runScenario(driver);

      expect(report.ok).toBe(false);
      expect(
        report.layout.findings.some(
          (finding) =>
            finding.code === "sweep_static" &&
            finding.severity === "error" &&
            finding.message.includes("did not advance"),
        ),
      ).toBe(true);
    });

    it("does not flag a 1.5s static title card — too short for the guard to apply", async () => {
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 1.5),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
      });
      const { report } = await runScenario(driver);

      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(false);
    });

    it("does not double-report when a motion_frozen finding already covers the same symptom", async () => {
      const motion: MotionSpecResolution = {
        kind: "valid",
        path: "/project/index.motion.json",
        spec: { assertions: [{ kind: "keepsMoving" }] },
      };
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
        collectMotionFrame: vi.fn(async (time: number) => ({
          time,
          data: {},
          liveness: { "*": "unchanging" },
        })),
      });
      const { report } = await runScenario(driver, {}, { motion });

      expect(report.motion.findings.some((finding) => finding.code === "motion_frozen")).toBe(true);
      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(false);
    });
  });
});

describe("frame-check flag grammar", () => {
  it("keeps bare --frame-check on defaults and parses the value form", async () => {
    const { parseFrameCheck } = await import("./check.js");
    expect(parseFrameCheck(undefined)).toBeUndefined();
    expect(parseFrameCheck(true)).toEqual({});
    expect(parseFrameCheck("")).toEqual({});
    expect(parseFrameCheck("severity=error;seek=.25,.75;tol=4")).toEqual({
      severity: "error",
      seek: [0.25, 0.75],
      tol: 4,
    });
    expect(() => parseFrameCheck("bogus=1")).toThrow("Invalid --frame-check");
    expect(() => parseFrameCheck("tol=-2")).toThrow("Invalid --frame-check");
  });
});

describe("contrast persistence", () => {
  it("demotes a single-sample contrast failure to warning but gates held failures", async () => {
    const driver = fakeDriver({
      collectContrast: vi.fn(async (time: number) => ({
        entries: [
          // #hero fails at every sample: held, stays an error.
          contrastEntry({ time, selector: "#hero" }),
          // #entrance fails only at the first sample (mid-entrance): demoted.
          ...(time < 1
            ? [contrastEntry({ time, selector: "#entrance", text: "Fading in" })]
            : [
                contrastEntry({
                  time,
                  selector: "#entrance",
                  text: "Fading in",
                  ratio: 8,
                  wcagAA: true,
                }),
              ]),
        ],
        pngBase64: PNG_BASE64,
      })),
    });
    const { report } = await runScenario(driver);

    const bySelector = new Map(
      report.contrast.findings.map((finding) => [finding.selector, finding.severity]),
    );
    expect(bySelector.get("#hero")).toBe("error");
    expect(bySelector.get("#entrance")).toBe("warning");
    expect(checkExitCode(report)).toBe(1);
  });

  it("keeps full severity when only one sample time exists", async () => {
    const driver = fakeDriver({
      collectContrast: vi.fn(async (time: number) => ({
        entries: [contrastEntry({ time })],
        pngBase64: PNG_BASE64,
      })),
    });
    const { report } = await runScenario(driver, { samples: 1, at: [2] });

    expect(report.contrast.findings[0]?.severity).toBe("error");
  });
});

describe("check report telemetry", () => {
  it("reports one clean run with every gate and sampled-point count", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: { duration: 1, assertions: [{ kind: "appearsBy", selector: "#hero", bySec: 1 }] },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      collectMotionFrame: vi.fn(async (time: number) => heroMotionFrame(time, () => true)),
      collectContrast: vi.fn(async (time: number) => ({
        entries: [contrastEntry({ time, ratio: 7, wcagAA: true })],
        pngBase64: PNG_BASE64,
      })),
    });

    const { report } = await runScenario(
      driver,
      {
        samples: 1,
        captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 1 },
        frameCheck: {},
        snapshots: true,
      },
      { motion },
    );

    expect(trackCheckReport).toHaveBeenCalledTimes(1);
    expect(trackCheckReport).toHaveBeenCalledWith(
      expect.objectContaining({
        contrastGate: true,
        motionGate: true,
        captionZoneGate: true,
        frameCheckGate: true,
        snapshotsGate: true,
        gridPoints: 2,
        contrastPoints: 1,
        ok: true,
        exitCode: 0,
      }),
    );
    expect(report.ok).toBe(true);
  });

  it("reports one failing contrast run with its section error count", async () => {
    const collectContrast = vi.fn(async (time: number) => ({
      entries: time === 0.5 ? [contrastEntry()] : [],
      pngBase64: PNG_BASE64,
    }));

    const { report } = await runScenario(fakeDriver({ collectContrast }));

    expect(trackCheckReport).toHaveBeenCalledTimes(1);
    expect(trackCheckReport).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        exitCode: 1,
        contrastErrors: report.contrast.errorCount,
      }),
    );
    expect(report.contrast.errorCount).toBe(1);
  });

  it("reports zero browser samples and timings after a lint short circuit", async () => {
    const lint = lintWith(
      "error",
      "root_missing_composition_id",
      "Root element needs data-composition-id.",
    );

    const { report, browser } = await runScenario(fakeDriver(), {}, { lint });

    expect(browser).not.toHaveBeenCalled();
    expect(trackCheckReport).toHaveBeenCalledTimes(1);
    expect(trackCheckReport).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        exitCode: 1,
        gridPoints: 0,
        contrastPoints: 0,
        launchSettleMs: 0,
        seekLoopMs: 0,
        contrastMs: 0,
      }),
    );
    expect(report.ok).toBe(false);
  });

  it("matches report counts for mixed findings across classes", async () => {
    const lint = lintWith("warning", "lint_warning", "Lint warning.");
    const driver = fakeDriver({
      collectLayout: vi.fn(async () => [layoutIssue(), layoutIssue("warning")]),
      collectContrast: vi.fn(async () => ({
        entries: [contrastEntry()],
        pngBase64: PNG_BASE64,
      })),
    });

    const { report } = await runScenario(
      driver,
      { samples: 1 },
      { lint, runtime: [runtimeError()] },
    );

    expect(trackCheckReport).toHaveBeenCalledTimes(1);
    expect(trackCheckReport).toHaveBeenCalledWith(
      expect.objectContaining({
        lintErrors: report.lint.errorCount,
        lintWarnings: report.lint.warningCount,
        runtimeErrors: report.runtime.errorCount,
        runtimeWarnings: report.runtime.warningCount,
        layoutErrors: report.layout.errorCount,
        layoutWarnings: report.layout.warningCount,
        motionErrors: report.motion.errorCount,
        motionWarnings: report.motion.warningCount,
        contrastErrors: report.contrast.errorCount,
        contrastWarnings: report.contrast.warningCount,
      }),
    );
    expect(report.lint.warningCount).toBe(1);
    expect(report.runtime.errorCount).toBe(1);
    expect(report.layout.errorCount).toBe(1);
    expect(report.layout.warningCount).toBe(1);
  });

  it("measures contrast work inside the overall seek loop", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(105)
      .mockReturnValueOnce(110)
      .mockReturnValueOnce(120);

    const result = await runAuditGrid(
      fakeDriver(),
      { ...DEFAULT_CHECK_OPTIONS, samples: 1 },
      noMotion(),
    );

    expect(result.timings).toEqual({ launchSettleMs: 0, seekLoopMs: 20, contrastMs: 5 });
  });
});

describe("contrast candidate round-trip", () => {
  it("passes the browser script's raw candidates back to finish, never the normalized copies", () => {
    const source = checkBrowserSource();

    // __contrastAuditFinish samples pixels via the page script's own bbox
    // shape ({x, y, w, h}); sending the Node-normalized candidate
    // ({width, height}) makes every sample rect NaN and the audit silently
    // reports zero checked elements. The raw object must round-trip verbatim.
    expect(source).toMatch(/prepared\.map\(\(entry\) => entry\.raw\)/);
    expect(source).toMatch(/raw: unknown;/);
    expect(source).not.toMatch(/prepared\.map\(\(entry\) => entry\.candidate\)/);
  });
});
