import { runCommand } from "citty";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const trackCheckReport = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackCheckReport: (...args: unknown[]) => trackCheckReport(...args),
  trackCommandFailure: vi.fn(),
}));

import { contrastRatio, parseColorRGBA } from "./contrast-bg.js";
import { createCheckCommand, parseCheckRange } from "./check.js";
import { CheckDeadlineError } from "../utils/checkDeadline.js";
import { trackCommandFailures } from "../utils/command-failure-tracking.js";
import type { CommandDef } from "citty";

// Bare `--frame-check` is rewritten by the wrapCommand gate, so run through cli.ts's wrapping.
async function runViaCli(
  command: CommandDef<any>,
  opts: Parameters<typeof runCommand>[1],
): Promise<ReturnType<typeof runCommand>> {
  const wrapped = await trackCommandFailures(() => Promise.resolve(command))();
  return runCommand(wrapped, opts);
}
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
import { ambiguousIssue } from "../utils/motionAudit.js";
import type { ProjectLintResult } from "../utils/lintProject.js";
import type {
  LayoutIssue,
  LayoutIssueCode,
  LayoutOverflow,
  LayoutRect,
} from "../utils/layoutAudit.js";
import type { CraftFrame, SeekClock } from "../utils/checkTypes.js";
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
        contentHash: "test",
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
        contentHash: "test",
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

// A rendered frame that is a function of the last seek, as a seek-driven film's is.
function framesOfSeekedTime(): Pick<CheckAuditDriver, "seek" | "captureFrame"> {
  let seeked = 0;
  return {
    seek: vi.fn(async (time: number) => {
      seeked = time;
    }),
    captureFrame: vi.fn(async () => `frame@${seeked}`),
  };
}

function fakeDriver(overrides: Partial<CheckAuditDriver> = {}): CheckAuditDriver {
  // A distinct string per call so the frozen-sweep guard (#U10) never fires
  // by accident in unrelated scenarios — tests that want it force a constant
  // via `collectLayoutGeometry: vi.fn(async () => "same")`.
  let geometryCallCount = 0;
  const driver: CheckAuditDriver = {
    initialize: vi.fn(async (_contrast: boolean) => undefined),
    getDuration: vi.fn(async () => 9),
    hasNoTimelineDeclaration: vi.fn(async () => false),
    getTransitionBoundaries: vi.fn(async () => []),
    getClipEdges: vi.fn(async () => []),
    getCanvas: vi.fn(async () => ({ width: 1920, height: 1080 })),
    findAmbiguousSelectors: vi.fn(async (_selectors: string[]) => []),
    seek: vi.fn(async (_time: number) => undefined),
    seekGeometry: vi.fn(async (_time: number) => undefined),
    collectLayout: vi.fn(async (_time: number, _tolerance: number) => []),
    collectOverlap: vi.fn(async (_time: number) => []),
    collectLayoutGeometry: vi.fn(async () => `geometry-${geometryCallCount++}`),
    captureFrame: vi.fn(async (_scope?: string) => "frame"),
    framesDiffer: vi.fn(async (first: string, second: string) => first !== second),
    collectSeekClock: vi.fn(async () => [{ id: 1, time: 0, done: false }]),
    collectRotationSample: vi.fn(async (_time: number) => []),
    collectOffPivotRotationSample: vi.fn(async (time: number) => ({ time, samples: [] })),
    collectGeometryCandidates: vi.fn(async () => []),
    collectMotionFrame: vi.fn(async (time: number) => ({ time, data: {}, liveness: {} })),
    anchorMotionIssues: vi.fn(async (issues: LayoutIssue[]) =>
      issues.map((issue) => ({
        ...issue,
        ...anchor(issue.selector, issue.time),
      })),
    ),
    collectContrast: vi.fn(async (_time: number) => ({ entries: [], pngBase64: PNG_BASE64 })),
    collectOverlapGrid: vi.fn(async (times: number[]) => {
      const issues: AnchoredLayoutIssue[][] = [];
      for (const time of times) {
        await driver.seekGeometry(time);
        issues.push(await driver.collectOverlap(time));
      }
      return issues;
    }),
    ...overrides,
  };
  return driver;
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
  dataAttributes?: Record<string, string>;
}

function geometryCandidate(fixture: GeometryFixture) {
  return {
    ...anchor(fixture.selector, fixture.time),
    ...(fixture.dataAttributes ? { dataAttributes: fixture.dataAttributes } : {}),
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
    inspectHdrAutoPromotion?: NonNullable<CheckDependencies["inspectHdrAutoPromotion"]>;
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
    inspectHdrAutoPromotion: options.inspectHdrAutoPromotion ?? vi.fn(async () => null),
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

describe("check --prepare-media", () => {
  async function runPrepare(
    files: Array<{ file: string; state: "ready" | "cached" | "failed"; reason?: string }>,
    rawArgs: string[],
  ) {
    const { report } = await runScenario(fakeDriver());
    const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
    const prepareMedia = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => files);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCommand(
      createCheckCommand({
        resolveProject: () => PROJECT,
        runPipeline,
        prepareMedia,
        withMeta: (value) => value,
      }),
      { rawArgs },
    );
    return { runPipeline, prepareMedia, log };
  }

  it("makes the copies without running the check, and reports every file", async () => {
    const files = [
      { file: "a.mov", state: "ready" as const },
      { file: "b.mov", state: "cached" as const },
    ];
    const { runPipeline, prepareMedia, log } = await runPrepare(files, [
      "--prepare-media",
      "--json",
      "--no-proxy",
    ]);

    expect(runPipeline).not.toHaveBeenCalled();
    expect(prepareMedia).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ autoProxy: false }),
    );
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      ok: true,
      prepared: files,
      total: 2,
      ready: 2,
      failed: 0,
    });
    expect(consumeCommandResult().exitCode).toBe(0);
  });

  it("exits 1 and names the reason when a copy failed", async () => {
    const { log } = await runPrepare(
      [{ file: "a.mov", state: "failed", reason: "ffmpeg exited with code 1" }],
      ["--prepare-media", "--json"],
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      ready: 0,
      failed: 1,
      prepared: [{ file: "a.mov", state: "failed", reason: "ffmpeg exited with code 1" }],
    });
    expect(consumeCommandResult().exitCode).toBe(1);
  });
});

it("parses the caption-zone grammar and enables the frame gate", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
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

it("preserves caption-zone after bare --frame-check", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });

  await runViaCli(command, {
    rawArgs: [
      "--frame-check",
      "--caption-zone",
      "x0=0;y0=.82;x1=1;y1=1;severity=error;seek=.25,1",
      "--json",
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

it("preserves --json after bare --frame-check", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });

  await runViaCli(command, {
    rawArgs: ["--snapshots", "--samples", "15", "--frame-check", "--json"],
  });

  expect(runPipeline).toHaveBeenCalledWith(
    PROJECT,
    expect.objectContaining({
      samples: 15,
      snapshots: true,
      frameCheck: {},
    }),
  );
  expect(log).toHaveBeenCalledWith(expect.stringContaining('"ok"'));
});

it("prints a dash-prefixed --frame-check value's parse failure exactly once, not doubled", async () => {
  // run()'s own try/catch prints parseFrameCheck's error, so the throw site must not print too.
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });

  await runViaCli(command, { rawArgs: ["--frame-check=--json"] });

  expect(runPipeline).not.toHaveBeenCalled();
  const matching = errorLog.mock.calls.filter(
    ([arg]) => typeof arg === "string" && arg.includes("Missing value for --frame-check"),
  );
  expect(matching).toHaveLength(1);
});

it("no longer swallows --json after a --layout value (the wider bug class beyond --frame-check)", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });

  await expect(runViaCli(command, { rawArgs: ["--layout", "--json"] })).rejects.toThrow(
    /Missing value for --layout/,
  );

  expect(runPipeline).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it("includes local HDR auto-promotion attribution in --json output", async () => {
  const { report } = await runScenario(
    fakeDriver(),
    {},
    {
      inspectHdrAutoPromotion: vi.fn(async () => ({
        triggeringAsset: "assets/source-hdr.mp4",
        output: { colorSpace: "BT.2020", codec: "HEVC Main10" } as const,
      })),
    },
  );
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline: vi.fn(async () => report),
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });

  await runCommand(command, { rawArgs: ["--json"] });

  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(log.mock.calls[0]?.[0])).hdr.autoPromotion).toEqual({
    triggeringAsset: "assets/source-hdr.mp4",
    output: { colorSpace: "BT.2020", codec: "HEVC Main10" },
  });
});

it("distinguishes unavailable HDR inspection from no promotion", async () => {
  const { report } = await runScenario(
    fakeDriver(),
    {},
    {
      inspectHdrAutoPromotion: vi.fn(async () => Promise.reject(new Error("ffprobe unavailable"))),
    },
  );

  expect(report.hdr).toEqual({ autoPromotion: null, inspection: "unavailable" });
});

it("threads --no-proxy into the browser check options", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });

  await runCommand(command, { rawArgs: ["--json", "--no-proxy"] });

  expect(runPipeline).toHaveBeenCalledWith(PROJECT, expect.objectContaining({ autoProxy: false }));
});

it("waits for the project lock declared in HF_TOOL_CONTEXT before running the pipeline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-check-lock-"));
  const lock = join(dir, ".hyperframes", "project.lock");
  mkdirSync(join(dir, ".hyperframes"));
  writeFileSync(lock, JSON.stringify({ pid: process.pid, command: "snapshot", startedAt: 1 }));
  vi.stubEnv(
    "HF_TOOL_CONTEXT",
    JSON.stringify({ version: 1, capabilities: { "project-lock": { waitMs: 0 } } }),
  );
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async () => report);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => ({ ...PROJECT, dir }),
    runPipeline,
    prepareMedia: vi.fn(async () => []),
    withMeta: (value) => value,
  });
  try {
    await runCommand(command, { rawArgs: ["--json"] });
    expect(runPipeline).not.toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("hyperframes snapshot");
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects malformed caption-zone specs instead of silently disabling the gate", async () => {
  const { report } = await runScenario(fakeDriver());
  const runPipeline = vi.fn(async () => report);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const command = createCheckCommand({
    resolveProject: () => PROJECT,
    runPipeline,
    prepareMedia: vi.fn(async () => []),
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

it("flags text whose DOM box overlaps the caption band at the default end seek", async () => {
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
    expect.objectContaining({
      code: "caption_zone_collision",
      severity: "warning",
      selector: "#overlap-only",
      text: "Overlap only",
      time: 10,
    }),
  ]);
  expect(report.ok).toBe(true);
});

it("rejects a 1920×1080 card centered at y=.860 that overlaps the 5% keepout", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Demand card",
      selector: "#at-860",
      rect: fixtureRect(200, 889, 400, 80),
      time,
    }),
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Clear above keepout",
      selector: "#tiny-860",
      rect: fixtureRect(200, 919, 400, 20),
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
      captionZone: { x0: 0.118, y0: 0.875, x1: 0.882, y1: 0.925, severity: "error" },
    },
  );

  expect(report.layout.findings).toEqual([
    expect.objectContaining({
      code: "caption_zone_collision",
      severity: "error",
      selector: "#at-860",
    }),
  ]);
  expect(report.ok).toBe(false);
});

it("skips caption_zone_collision when data-layout-allow-caption-zone is set", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Intentional lower third",
      selector: "#lower-third",
      rect: fixtureRect(860, 870, 200, 60),
      time,
      dataAttributes: { "data-layout-allow-caption-zone": "" },
    }),
  ]);
  const { report } = await runScenario(
    fakeDriver({ getDuration: vi.fn(async () => 10), collectGeometryCandidates }),
    { samples: 1, contrast: false, captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 0.9 } },
  );

  expect(report.layout.findings).toEqual([]);
});

it("keeps overlap waivers from suppressing changelog caption-rail collisions", async () => {
  const collectGeometryCandidates = vi.fn(async (time: number) => [
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Release card copy",
      selector: "#release-card",
      rect: fixtureRect(120, 970, 840, 118),
      time,
      dataAttributes: { "data-layout-allow-overlap": "" },
    }),
    geometryCandidate({
      kind: "text",
      tag: "div",
      text: "Intentional caption rail",
      selector: "#cap-line",
      rect: fixtureRect(0, 990, 1080, 52),
      time,
      dataAttributes: { "data-layout-allow-caption-zone": "" },
    }),
  ]);
  const { report } = await runScenario(
    fakeDriver({
      getCanvas: vi.fn(async () => ({ width: 1080, height: 1080 })),
      collectGeometryCandidates,
    }),
    {
      samples: 1,
      contrast: false,
      captionZone: { x0: 0, y0: 0.9, x1: 1, y1: 1, severity: "error" },
    },
  );

  expect(report.layout.findings).toEqual([
    expect.objectContaining({
      code: "caption_zone_collision",
      severity: "error",
      selector: "#release-card",
    }),
  ]);
  expect(report.ok).toBe(false);
});

it("skips full-frame and tiny wrappers when measuring the caption box", async () => {
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

it("converts progress seeks to time, gates each collector, and keeps distinct caption elements", async () => {
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
    expect.objectContaining({
      code: "caption_zone_collision",
      severity: "error",
      selector: "#later-heading",
      time: 6,
      times: [6],
    }),
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

it("reports one moving element rule with both requested seek times", async () => {
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
    expect.objectContaining({
      code: "frame_out_of_frame",
      time: 2,
      times: [2, 6],
      firstSeen: 2,
      lastSeen: 6,
      occurrences: 2,
      heldMs: 0,
      bbox: { x: 1920, y: 100, width: 130, height: 100 },
    }),
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

it("waits for paint only on the grid seeks a contrast screenshot follows", async () => {
  const driver = fakeDriver({ getDuration: vi.fn(async () => 10) });
  await runScenario(driver, { samples: 1, captionZone: { x0: 0, y0: 0.8, x1: 1, y1: 1 } });

  expect(vi.mocked(driver.seek).mock.calls).toEqual([
    [5, true],
    [10, false],
  ]);
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
    browserSkipped: false,
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
    craft: { ...emptySection(), enabled: false, step: 0, samples: 0 },
    hdr: { autoPromotion: null, inspection: "available" },
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
      prepareMedia: vi.fn(async () => []),
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
      browserSkipped: false,
      lint: { ok: true },
      runtime: { ok: true },
      layout: { ok: true },
      motion: { ok: true },
      contrast: { ok: true },
      snapshots: { enabled: false },
      _meta: { version: "test" },
    });
  });

  it("short-circuits on lint errors without launching a browser, and flags the skipped sections", async () => {
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
    // The browser sections look clean either way; only browserSkipped tells them apart.
    expect(report.browserSkipped).toBe(true);
    expect(report.runtime).toMatchObject({ ok: true, errorCount: 0, findings: [] });
    expect(report.layout).toMatchObject({ ok: true, errorCount: 0, findings: [], duration: 0 });
    expect(report.motion).toMatchObject({ ok: true, errorCount: 0, findings: [] });
    expect(report.contrast).toMatchObject({ ok: true, errorCount: 0, findings: [] });
  });

  it("marks browserSkipped true when the linter itself crashes", async () => {
    const { deps } = dependencies(fakeDriver());
    deps.lintProject = vi.fn(async () => {
      throw new Error("unreadable index.html");
    });
    const report = await runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);

    expect(report.ok).toBe(false);
    expect(report.browserSkipped).toBe(true);
    expect(report.runtime.findings[0]?.code).toBe("check_lint_failure");
  });

  it.each([
    { lint: cleanLint(), handed: true },
    { lint: lintWith("error", "lint_error", "Lint error."), handed: false },
  ])(
    "closes the browser started during lint unless the browser pass took it",
    async ({ lint, handed }) => {
      const prelaunched = {
        launched: Promise.resolve(undefined),
        take: vi.fn(async () => undefined),
        discard: vi.fn(async () => undefined),
      };
      const { deps, runBrowserCheck } = dependencies(fakeDriver(), { lint });
      deps.prelaunchBrowser = vi.fn(async () => prelaunched);
      await runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);

      expect(runBrowserCheck.mock.calls.map((call) => call[4])).toEqual(
        handed ? [prelaunched] : [],
      );
      expect(prelaunched.discard).toHaveBeenCalledTimes(1);
    },
  );

  it("marks browserSkipped false once a browser session actually runs", async () => {
    const { report } = await runScenario(fakeDriver());
    expect(report.browserSkipped).toBe(false);
  });

  it("marks browserSkipped true when the browser session throws before producing results", async () => {
    const { deps } = dependencies(fakeDriver());
    deps.runBrowserCheck = vi.fn(async () => {
      throw new Error("Chrome launch failed");
    });
    const report = await runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);

    expect(report.ok).toBe(false);
    expect(report.browserSkipped).toBe(true);
    expect(report.runtime.findings).toHaveLength(1);
    expect(report.layout).toMatchObject({ ok: true, errorCount: 0, findings: [] });
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

  it("still audits layout when the motion sidecar is invalid", async () => {
    const motion: MotionSpecResolution = {
      kind: "invalid",
      path: "/project/index.motion.json",
      message: 'assertions[0] (staysInFrame): "selector" must be a non-empty string',
    };
    const driver = fakeDriver({
      collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
    });
    const { report, browser } = await runScenario(driver, {}, { motion });

    expect(browser).toHaveBeenCalledTimes(1);
    expect(report.layout.findings.length).toBeGreaterThan(0);
    expect(report.motion.findings).toEqual([
      expect.objectContaining({ code: "motion_spec_invalid", severity: "error" }),
    ]);
    expect(report.motion).toMatchObject({
      enabled: true,
      specPath: "/project/index.motion.json",
      samples: 0,
    });
    expect(report.ok).toBe(false);
  });

  it("does not sample motion for an invalid sidecar", async () => {
    const motion: MotionSpecResolution = {
      kind: "invalid",
      path: "/project/index.motion.json",
      message: "version 2 is not supported",
    };
    const driver = fakeDriver();
    const { report } = await runScenario(driver, {}, { motion });

    expect(report.motion.samples).toBe(0);
    expect(driver.collectMotionFrame).not.toHaveBeenCalled();
  });

  it("keeps evaluating the unambiguous assertions when one selector is ambiguous", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: {
        assertions: [
          { kind: "appearsBy", selector: ".item", bySec: 1 },
          { kind: "appearsBy", selector: "#hero", bySec: 0.2 },
        ],
      },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      findAmbiguousSelectors: vi.fn(async () => [
        { ...layoutIssue("error", { code: "motion_selector_ambiguous" }), selector: ".item" },
      ]),
      collectMotionFrame: vi.fn(async (time: number) => heroMotionFrame(time, (t) => t >= 0.5)),
    });
    const { report } = await runScenario(driver, {}, { motion });

    expect(report.motion.samples).toBeGreaterThan(0);
    expect(report.motion.findings.map((finding) => finding.code).sort()).toEqual([
      "motion_appears_late",
      "motion_selector_ambiguous",
    ]);
    expect(report.ok).toBe(false);
    expect(
      report.motion.findings.find((finding) => finding.code === "motion_selector_ambiguous")
        ?.message,
    ).toContain("1 assertion(s) naming it were not evaluated");
    expect(driver.collectMotionFrame).toHaveBeenCalledWith(expect.any(Number), ["#hero"], []);
  });

  it("separates the ambiguity message from the skipped-assertion count", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: { assertions: [{ kind: "appearsBy", selector: ".item", bySec: 1 }] },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      findAmbiguousSelectors: vi.fn(async () => [
        { ...layoutIssue("error"), ...ambiguousIssue(".item") },
      ]),
    });
    const { report } = await runScenario(driver, {}, { motion });

    const message = report.motion.findings.find(
      (finding) => finding.code === "motion_selector_ambiguous",
    )?.message;
    expect(message).toContain("exactly one. 1 assertion(s)");
  });

  it("counts skipped assertions per ambiguous selector, not across all of them", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: {
        assertions: [
          { kind: "appearsBy", selector: ".item", bySec: 1 },
          { kind: "appearsBy", selector: ".card", bySec: 1 },
          { kind: "appearsBy", selector: ".card", bySec: 2 },
        ],
      },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      findAmbiguousSelectors: vi.fn(async () => [
        { ...layoutIssue("error", { code: "motion_selector_ambiguous" }), selector: ".item" },
        { ...layoutIssue("error", { code: "motion_selector_ambiguous" }), selector: ".card" },
      ]),
    });
    const { report } = await runScenario(driver, {}, { motion });

    const messages = report.motion.findings
      .filter((finding) => finding.code === "motion_selector_ambiguous")
      .map((finding) => finding.message);
    expect(messages.filter((m) => m.includes("1 assertion(s) naming it"))).toHaveLength(1);
    expect(messages.filter((m) => m.includes("2 assertion(s) naming it"))).toHaveLength(1);
  });

  it("drops a before assertion when either side is ambiguous, keeping the rest", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: {
        assertions: [
          { kind: "before", a: "#hero", b: ".item" },
          { kind: "appearsBy", selector: "#hero", bySec: 0.2 },
        ],
      },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      findAmbiguousSelectors: vi.fn(async () => [
        { ...layoutIssue("error", { code: "motion_selector_ambiguous" }), selector: ".item" },
      ]),
      collectMotionFrame: vi.fn(async (time: number) => heroMotionFrame(time, (t) => t >= 0.5)),
    });
    const { report } = await runScenario(driver, {}, { motion });

    expect(report.motion.findings.map((finding) => finding.code).sort()).toEqual([
      "motion_appears_late",
      "motion_selector_ambiguous",
    ]);
    expect(driver.collectMotionFrame).toHaveBeenCalledWith(expect.any(Number), ["#hero"], []);
  });

  it("does not sample when every assertion names an ambiguous selector", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: { assertions: [{ kind: "appearsBy", selector: ".item", bySec: 1 }] },
    };
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 1),
      findAmbiguousSelectors: vi.fn(async () => [
        { ...layoutIssue("error", { code: "motion_selector_ambiguous" }), selector: ".item" },
      ]),
    });
    const { report } = await runScenario(driver, {}, { motion });

    expect(report.motion.samples).toBe(0);
    expect(report.motion.findings.map((finding) => finding.code)).toEqual([
      "motion_selector_ambiguous",
    ]);
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

  it("reports the total deadline during crops while retaining the audit failure", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
      }),
      { snapshots: true },
      {
        captureFindingCrops: async () => {
          throw new CheckDeadlineError();
        },
      },
    );
    expect(report.ok).toBe(false);
    expect(report.layout.errorCount).toBeGreaterThan(0);
    expect(report.runtime.findings).toContainEqual(
      expect.objectContaining({
        code: "check_runtime_failure",
        message: "Check did not finish within its deadline.",
      }),
    );
  });

  it("slow samples that each finish keep the check alive past 120 s", async () => {
    vi.useFakeTimers();
    try {
      const collectLayout = vi.fn(async (_time: number, _tolerance: number) => {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        return [];
      });
      const driver = fakeDriver({ collectLayout });
      const { deps } = dependencies(driver);
      deps.runBrowserCheck = async (_project, options, motion, deadline) => {
        deadline!.start();
        return runAuditGrid(driver, options, motion, undefined, deadline!.enter);
      };
      const pending = runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);
      await vi.advanceTimersByTimeAsync(2_000_000);
      const report = await pending;
      expect(report.runtime.findings.map((finding) => finding.code)).not.toContain(
        "check_runtime_failure",
      );
      expect(collectLayout.mock.calls.length * 30).toBeGreaterThan(120);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a long overlap pass that keeps reporting progress finishes instead of hitting a wall clock", async () => {
    vi.useFakeTimers();
    try {
      const collectOverlapGrid = vi.fn(async (times: number[]) => {
        await new Promise((resolve) => setTimeout(resolve, 10_000 * times.length));
        return times.map((): AnchoredLayoutIssue[] => []);
      });
      const driver = fakeDriver({ collectOverlapGrid });
      const { deps } = dependencies(driver);
      deps.runBrowserCheck = async (_project, options, motion, deadline) => {
        deadline!.start();
        return runAuditGrid(driver, options, motion, undefined, deadline!.enter);
      };
      const pending = runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);
      await vi.advanceTimersByTimeAsync(2_000_000);
      const report = await pending;
      expect(report.runtime.findings.map((finding) => finding.code)).not.toContain(
        "check_runtime_failure",
      );
      expect(collectOverlapGrid.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a deadline that fires in the overlap pass names that pass in its finding", async () => {
    vi.useFakeTimers();
    try {
      let aborted!: AbortSignal;
      const driver = fakeDriver({
        collectOverlapGrid: vi.fn(
          () =>
            new Promise<never>((_, reject) =>
              aborted.addEventListener("abort", () => reject(aborted.reason)),
            ),
        ),
      });
      const { deps } = dependencies(driver);
      deps.runBrowserCheck = async (_project, options, motion, deadline) => {
        aborted = deadline!.signal;
        deadline!.start();
        return runAuditGrid(driver, options, motion, undefined, deadline!.enter);
      };
      const pending = runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);
      await vi.advanceTimersByTimeAsync(120_000);
      const report = await pending;
      const failure = report.runtime.findings.find(
        (finding) => finding.code === "check_runtime_failure",
      );
      expect(failure?.message).toMatch(/^Check did not finish within its deadline/);
      expect(failure?.message).toContain("while running the overlap pass.");
      expect(failure?.message).toContain("checking samples 0.0, running the overlap pass 120.0.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a deadline keeps the layout findings the finished samples already made", async () => {
    vi.useFakeTimers();
    try {
      let aborted!: AbortSignal;
      const driver = fakeDriver({
        collectLayout: vi.fn(async (time: number) => [
          layoutIssue("warning", { time, code: "container_overflow" }),
        ]),
        collectOverlapGrid: vi.fn(
          () =>
            new Promise<never>((_, reject) =>
              aborted.addEventListener("abort", () => reject(aborted.reason)),
            ),
        ),
      });
      const { deps } = dependencies(driver);
      deps.runBrowserCheck = async (_project, options, motion, deadline) => {
        aborted = deadline!.signal;
        deadline!.start();
        return runAuditGrid(
          driver,
          options,
          motion,
          undefined,
          deadline!.enter,
          undefined,
          deadline!.keepPartial,
        );
      };
      const pending = runCheckPipeline(PROJECT, DEFAULT_CHECK_OPTIONS, deps);
      await vi.advanceTimersByTimeAsync(120_000);
      const report = await pending;
      expect(report.layout.findings.some((finding) => finding.code === "container_overflow")).toBe(
        true,
      );
      expect(report.browserSkipped).toBe(false);
      expect(
        report.runtime.findings.some((finding) => finding.code === "check_runtime_failure"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it("splits samples over a helper page and returns what one page seeking every sample returns", async () => {
    const pageOfTime = () => {
      let seeked = 0;
      return fakeDriver({
        seek: vi.fn(async (time: number) => {
          seeked = time;
        }),
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
        collectLayoutGeometry: vi.fn(async () => `geometry-${seeked}`),
        collectContrast: vi.fn(async (time: number) => ({
          entries: [contrastEntry({ ...anchor("#hero", time), ratio: 1 + time })],
          pngBase64: `${PNG_BASE64}-${time}`,
        })),
      });
    };
    const options = { ...DEFAULT_CHECK_OPTIONS, contrast: true };
    const { timings: _serialTimings, ...serial } = await runAuditGrid(
      pageOfTime(),
      options,
      noMotion(),
    );
    const primary = pageOfTime();
    const helper = pageOfTime();
    const { timings: _splitTimings, ...split } = await runAuditGrid(
      primary,
      options,
      noMotion(),
      Promise.resolve([helper]),
    );

    expect(split).toEqual(serial);
    expect(serial.layoutIssues.length).toBeGreaterThan(2);
    expect(helper.initialize).toHaveBeenCalledWith(true);
    const seeks = (driver: CheckAuditDriver) =>
      vi.mocked(driver.seek).mock.calls.map(([time]) => time);
    expect(seeks(helper).length).toBeGreaterThan(0);
    expect(seeks(primary).filter((time) => seeks(helper).includes(time))).toEqual([]);
  });

  it("redoes a crashed helper page's samples on the first page and returns the serial result", async () => {
    let helperSeeks = 0;
    const pageOfTime = (crashOnSeek?: number) => {
      let seeked = 0;
      return fakeDriver({
        markSamples: vi.fn(),
        seek: vi.fn(async (time: number) => {
          if (crashOnSeek !== undefined && ++helperSeeks === crashOnSeek)
            throw new Error("Target closed");
          await new Promise((resolve) => setImmediate(resolve));
          seeked = time;
        }),
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
        collectLayoutGeometry: vi.fn(async () => `geometry-${seeked}`),
      });
    };
    const { timings: _serialTimings, ...serial } = await runAuditGrid(
      pageOfTime(),
      DEFAULT_CHECK_OPTIONS,
      noMotion(),
    );
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const primary = pageOfTime();
    const helper = pageOfTime(2);
    const { timings: _splitTimings, ...split } = await runAuditGrid(
      primary,
      DEFAULT_CHECK_OPTIONS,
      noMotion(),
      Promise.resolve([helper]),
    );
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);

    expect(split).toEqual(serial);
    expect(helperSeeks).toBe(2);
    expect(helper.markSamples).toHaveBeenLastCalledWith("drop");
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("waits for the helper's sample in flight when the first page runs out of samples", async () => {
    const pageOfTime = (onSeek?: () => Promise<void>) =>
      fakeDriver({
        seek: vi.fn(async () => onSeek?.()),
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
        collectLayoutGeometry: vi.fn(async () => "geometry"),
      });
    const serialPage = pageOfTime();
    const { timings: _serialTimings, ...serial } = await runAuditGrid(
      serialPage,
      DEFAULT_CHECK_OPTIONS,
      noMotion(),
    );
    const samples = vi.mocked(serialPage.collectLayout).mock.calls.length;
    let firstPageSeeks = 0;
    let othersTaken!: () => void;
    const allOthersTaken = new Promise<void>((resolve) => (othersTaken = resolve));
    const primary = pageOfTime(async () => {
      if (++firstPageSeeks === samples - 1) setImmediate(othersTaken);
    });
    const helper = pageOfTime(() => allOthersTaken);
    const { timings: _splitTimings, ...split } = await runAuditGrid(
      primary,
      DEFAULT_CHECK_OPTIONS,
      noMotion(),
      Promise.resolve([helper]),
    );

    expect(vi.mocked(helper.seek).mock.calls).toHaveLength(1);
    expect(split).toEqual(serial);
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
            finding.message.includes("did not advance") &&
            finding.fixHint?.includes("window.__timelines"),
        ),
      ).toBe(true);
    });

    function stillCard(clocks: (sample: number) => SeekClock[]) {
      let sample = 0;
      return fakeDriver({
        getDuration: vi.fn(async () => 4),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
        collectSeekClock: vi.fn(async () => clocks(sample++)),
      });
    }

    function sweepOf(report: CheckReport): [string, string][] {
      return report.layout.findings
        .filter((finding) => finding.code === "sweep_static")
        .map((finding) => [finding.severity, finding.message]);
    }

    it.each([
      [
        "whose timeline follows the seek",
        (sample: number) => [{ id: 1, time: sample, done: false }],
      ],
      ["with nothing that could move", () => []],
      ["whose only animation already holds at its end", () => [{ id: 1, time: 4, done: true }]],
      [
        "whose timeline is seen, listed twice, at only one sample",
        (sample: number) =>
          sample === 2
            ? [
                { id: 1, time: 0, done: false },
                { id: 1, time: 0, done: false },
              ]
            : [],
      ],
    ])("warns, without failing, on a still card %s", async (_case, clocks) => {
      const { report } = await runScenario(stillCard(clocks));

      expect(sweepOf(report)).toEqual([["warning", "Nothing on screen moved under seek."]]);
      expect(report.ok).toBe(true);
    });

    it.each([
      [
        "one animation is stuck while another follows the seek",
        (sample: number) => [
          { id: 1, time: 0, done: false },
          { id: 2, time: sample, done: false },
        ],
      ],
      [
        "a tween created mid-run is stuck",
        (sample: number) => [
          { id: 1, time: sample, done: false },
          ...(sample >= 2 ? [{ id: 2, time: 0, done: false }] : []),
        ],
      ],
    ])("fails when %s", async (_case, clocks) => {
      const { report } = await runScenario(stillCard(clocks));

      expect(sweepOf(report).map(([severity]) => severity)).toEqual(["error"]);
      expect(report.ok).toBe(false);
    });

    it("warns, without failing, when only the audio advanced and nothing on screen moved", async () => {
      let call = 0;
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectLayoutGeometry: vi.fn(async () => `still\u001f${call++}`),
      });
      const { report } = await runScenario(driver);

      const sweep = report.layout.findings.filter((finding) => finding.code === "sweep_static");
      expect(sweep.map((finding) => [finding.severity, finding.message])).toEqual([
        ["warning", "Only the audio advanced under seek; nothing on screen moved."],
      ]);
      expect(sweep[0]?.fixHint).toContain("data-no-timeline");
      expect(report.ok).toBe(true);
    });

    it("does not flag a sweep where something on screen moved", async () => {
      let call = 0;
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectLayoutGeometry: vi.fn(async () => `frame${call++}\u001f0`),
      });
      const { report } = await runScenario(driver);

      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(false);
    });

    it.each([
      ["a timeline that looks stuck", (_sample: number) => "frozen", true],
      ["a still card", (_sample: number) => "frozen", false],
      ["an audio-only sweep", (sample: number) => `still\u001f${sample}`, false],
    ])("does not flag %s when the rendered frames differ", async (_case, geometry, stuck) => {
      let sample = 0;
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectLayoutGeometry: vi.fn(async () => geometry(sample++)),
        ...(stuck ? {} : { collectSeekClock: vi.fn(async () => []) }),
        ...framesOfSeekedTime(),
      });
      const { report } = await runScenario(driver);

      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(false);
      expect(report.ok).toBe(true);
    });

    it("still warns when the frames change with the wall clock rather than the seek", async () => {
      let frame = 0;
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
        collectSeekClock: vi.fn(async () => []),
        captureFrame: vi.fn(async () => `frame${frame++}`),
      });
      const { report } = await runScenario(driver);

      expect(sweepOf(report)).toEqual([["warning", "Nothing on screen moved under seek."]]);
    });

    it("never captures frames when the signature already moved", async () => {
      const driver = fakeDriver({ getDuration: vi.fn(async () => 6) });
      await runScenario(driver);

      expect(driver.captureFrame).not.toHaveBeenCalled();
    });

    it("does not flag --at times the user picked on a still end card", async () => {
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 53.7),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
      });
      const { report } = await runScenario(driver, { at: [51, 52.5] });

      expect(report.layout.samples).toEqual([51, 52.5]);
      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(false);
    });

    it("still judges the spread samples --at-transitions adds to an --at run", async () => {
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 53.7),
        getTransitionBoundaries: vi.fn(async () => [10, 20]),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
      });
      const { report } = await runScenario(driver, { at: [51, 52.5], atTransitions: true });

      expect(report.layout.samples).toEqual([10, 15, 20, 51, 52.5]);
      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(true);
    });

    it("does not flag intentional static content declared with data-no-timeline", async () => {
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        hasNoTimelineDeclaration: vi.fn(async () => true),
        collectLayoutGeometry: vi.fn(async () => "frozen"),
      });

      const { report } = await runScenario(driver);

      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(false);
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

  describe("craft warnings", () => {
    // A 20 s film: frame 0 empty, a 7-word line on screen 6.2–6.9 s, nothing moving 7.5–12.5 s, no sound.
    function craftFrame(time: number): CraftFrame {
      const line = time >= 6.2 && time < 6.9;
      return {
        time,
        parts: line
          ? [
              {
                key: 1,
                block: 1,
                selector: "#title",
                blockSelector: "#title",
                sourceFile: "compositions/stat.html",
                text: "Every team gets one shared calendar now",
                opacity: 1,
                fontPx: 96,
                rect: { left: 160, top: 380, width: 1600, height: 220 },
                captions: false,
              },
            ]
          : [],
        held: false,
        painted: time > 0,
        signature: time >= 7.5 && time <= 12.5 ? "still" : `moving-${time}`,
      };
    }

    function craftDriver(overrides: Partial<CheckAuditDriver> = {}): CheckAuditDriver {
      return fakeDriver({
        getDuration: vi.fn(async () => 20),
        collectCraftFrame: vi.fn(async (time: number) => craftFrame(time)),
        collectCraftFilm: vi.fn(async () => ({ soundSources: 0 })),
        ...overrides,
      });
    }

    it("reports them as warnings that keep exit 0, even under --strict", async () => {
      const { report } = await runScenario(craftDriver());

      expect(report.craft.enabled).toBe(true);
      expect(report.craft.findings.map((finding) => finding.code).sort()).toEqual([
        "dead_stretch",
        "film_silent",
        "first_frame_empty",
        "line_unread",
      ]);
      expect(report.craft.findings.every((finding) => finding.severity === "warning")).toBe(true);
      expect(report.craft.warningCount).toBe(4);
      expect(report.ok).toBe(true);
      expect(checkExitCode(report)).toBe(0);

      const strict = await runScenario(craftDriver(), { strict: true });
      expect(checkExitCode(strict.report)).toBe(0);
    });

    it("re-measures a short line between dense samples before judging it", async () => {
      const driver = craftDriver();
      const { report } = await runScenario(driver);
      const line = report.craft.findings.find((finding) => finding.code === "line_unread");

      expect(line?.seconds).toBeCloseTo(0.7, 1);
      const sampled = vi.mocked(driver.collectCraftFrame!).mock.calls.map(([time]) => time);
      expect(sampled.some((time) => Math.round(time * 1000) % 125 !== 0)).toBe(true);
    });

    it("samples a long film at 8 fps, finer than the overlap pass's capped grid", async () => {
      // A 60 s film whose seven-word line shows 10.1-10.3 s, between two of the overlap grid's samples.
      const driver = craftDriver({
        getDuration: vi.fn(async () => 60),
        collectCraftFrame: vi.fn(async (time: number) => {
          const frame = craftFrame(time);
          const line = time >= 10.1 && time < 10.3;
          const part = craftFrame(6.5).parts[0];
          return { ...frame, parts: line && part ? [part] : [], signature: `moving-${time}` };
        }),
      });
      const { report } = await runScenario(driver);
      const line = report.craft.findings.find((finding) => finding.code === "line_unread");

      expect(line?.time).toBeCloseTo(10.1, 1);
    });

    it("skips the section for --range checks and for drivers without a craft sampler", async () => {
      const ranged = await runScenario(craftDriver(), { range: [2, 8] });
      expect(ranged.report.craft).toMatchObject({ enabled: false, findings: [] });

      const { report } = await runScenario(fakeDriver({ getDuration: vi.fn(async () => 20) }));
      expect(report.craft).toMatchObject({ enabled: false, findings: [] });
    });

    it("leaves stillness to sweep_static when the whole sweep is frozen", async () => {
      const driver = craftDriver({
        collectLayoutGeometry: vi.fn(async () => "frozen"),
        collectCraftFrame: vi.fn(async (time: number) => ({
          ...craftFrame(time),
          signature: "still",
        })),
      });
      const { report } = await runScenario(driver);

      expect(report.layout.findings.some((finding) => finding.code === "sweep_static")).toBe(true);
      expect(report.craft.findings.some((finding) => finding.code === "dead_stretch")).toBe(false);
    });
  });

  describe("keepsMoving frame check", () => {
    function frozenLiveness(withinSelector?: string) {
      const motion: MotionSpecResolution = {
        kind: "valid",
        path: "/project/index.motion.json",
        spec: { assertions: [{ kind: "keepsMoving", ...(withinSelector && { withinSelector }) }] },
      };
      const scope = withinSelector ?? "*";
      const overrides = {
        getDuration: vi.fn(async () => 6),
        collectMotionFrame: vi.fn(async (time: number) => ({
          time,
          data: {},
          liveness: { [scope]: "unchanging" },
        })),
      };
      return { motion, overrides };
    }

    function frozenFindings(report: CheckReport): string[] {
      return report.motion.findings
        .filter((finding) => finding.code === "motion_frozen")
        .map((finding) => finding.message);
    }

    it.each([undefined, "#scene"])(
      "does not call a scope (%s) frozen when its rendered frames keep changing",
      async (withinSelector) => {
        const { motion, overrides } = frozenLiveness(withinSelector);
        let frame = 0;
        const driver = fakeDriver({
          ...overrides,
          captureFrame: vi.fn(async () => `frame${frame++}`),
        });
        const { report } = await runScenario(driver, {}, { motion });

        expect(frozenFindings(report)).toEqual([]);
        expect(driver.captureFrame).toHaveBeenCalledWith(withinSelector);
        // One capture per half maxStaticSec, not one per motion frame.
        expect(vi.mocked(driver.captureFrame).mock.calls.length).toBeLessThanOrEqual(7);
      },
    );

    async function frozenIssues(driver: CheckAuditDriver, motion: MotionSpecResolution) {
      const result = await runAuditGrid(driver, DEFAULT_CHECK_OPTIONS, motion);
      return result.motionIssues.map((issue) => `${issue.code} ${issue.message}`);
    }

    it("splits a frozen span where its frames change once, keeping both halves", async () => {
      const { motion, overrides } = frozenLiveness();
      let seeked = 0;
      const driver = fakeDriver({
        ...overrides,
        // 9 s, so the last END_CARD_HOLD_SEC (6-9 s) a film may hold still stays clear of both spans.
        getDuration: vi.fn(async () => 9),
        seek: vi.fn(async (time: number) => {
          seeked = time;
        }),
        captureFrame: vi.fn(async () => (seeked < 3 ? "before" : "after")),
      });

      expect(await frozenIssues(driver, motion)).toEqual([
        expect.stringContaining("between 0s and 3s"),
        expect.stringContaining("between 3s and 6s"),
      ]);
    });

    it("keeps the second of two frozen spans that touch at a cut", async () => {
      const motion: MotionSpecResolution = {
        kind: "valid",
        path: "/project/index.motion.json",
        spec: { assertions: [{ kind: "keepsMoving" }] },
      };
      // A hold, a hard cut at 3 s into a second hold, then motion from 5.05 s to the end at 9 s,
      // clear of the last END_CARD_HOLD_SEC a film may hold still.
      const shot = (index: number) => (index < 60 ? "a" : index < 101 ? "b" : String(index));
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 9),
        collectMotionFrame: vi.fn(async (time: number) => ({
          time,
          data: {},
          liveness: { "*": shot(Math.round(time * 20)) },
        })),
      });

      expect(await frozenIssues(driver, motion)).toEqual([
        expect.stringContaining("between 0s and 3s"),
        expect.stringContaining("between 3s and 5.05s"),
      ]);
    });

    it("leaves a scope that matched nothing as missing while another scope is frozen", async () => {
      const motion: MotionSpecResolution = {
        kind: "valid",
        path: "/project/index.motion.json",
        spec: {
          assertions: [{ kind: "keepsMoving" }, { kind: "keepsMoving", withinSelector: "#typo" }],
        },
      };
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectMotionFrame: vi.fn(async (time: number) => ({
          time,
          data: {},
          liveness: { "*": "unchanging", "#typo": "" },
        })),
      });

      const codes = (await frozenIssues(driver, motion)).map((line) => line.split(" ")[0]);
      expect(codes).toEqual(["motion_frozen", "motion_selector_missing"]);
    });

    it("never captures frames when the liveness already moved", async () => {
      const motion: MotionSpecResolution = {
        kind: "valid",
        path: "/project/index.motion.json",
        spec: { assertions: [{ kind: "keepsMoving" }] },
      };
      const driver = fakeDriver({
        getDuration: vi.fn(async () => 6),
        collectMotionFrame: vi.fn(async (time: number) => ({
          time,
          data: {},
          liveness: { "*": String(time) },
        })),
      });
      const { report } = await runScenario(driver, {}, { motion });

      expect(frozenFindings(report)).toEqual([]);
      expect(driver.captureFrame).not.toHaveBeenCalled();
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
    expect(() => parseFrameCheck("tol=4px")).toThrow("Invalid --frame-check");
    expect(() => parseFrameCheck("tol=2garbage")).toThrow("Invalid --frame-check");
  });

  it("attributes swallowed option values to --frame-check", async () => {
    const { parseFrameCheck } = await import("./check.js");

    expect(() => parseFrameCheck("--json")).toThrow(
      'Missing value for --frame-check: value "--json" appears to have swallowed the next option; use --frame-check= or move --frame-check to the end',
    );
    expect(() => parseFrameCheck("severity")).toThrow("Invalid --frame-check");
  });
});

describe("layout flag grammar", () => {
  it("parses proseCoverageFloor and rejects malformed specs", async () => {
    const { parseLayout } = await import("./check.js");
    expect(parseLayout(undefined)).toBeUndefined();
    expect(parseLayout("proseCoverageFloor=0.05")).toEqual({ proseCoverageFloor: 0.05 });
    expect(parseLayout("proseCoverageFloor=0")).toEqual({ proseCoverageFloor: 0 });
    expect(parseLayout("proseCoverageFloor=1")).toEqual({ proseCoverageFloor: 1 });
    expect(() => parseLayout(true)).toThrow("Invalid --layout");
    expect(() => parseLayout("")).toThrow("Invalid --layout");
    expect(() => parseLayout("bogus=1")).toThrow("Invalid --layout");
    expect(() => parseLayout("proseCoverageFloor=-0.1")).toThrow("Invalid --layout");
    expect(() => parseLayout("proseCoverageFloor=1.1")).toThrow("Invalid --layout");
    expect(() => parseLayout("proseCoverageFloor=0.05garbage")).toThrow("Invalid --layout");
    expect(() => parseLayout("proseCoverageFloor=0.1%")).toThrow("Invalid --layout");
    expect(() => parseLayout("proseCoverageFloor=")).toThrow("Invalid --layout");
  });

  it("threads --layout into the check pipeline options", async () => {
    const { report } = await runScenario(fakeDriver());
    const runPipeline = vi.fn(async (_project: ProjectDir, _options: CheckOptions) => report);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const command = createCheckCommand({
      resolveProject: () => PROJECT,
      runPipeline,
      prepareMedia: vi.fn(async () => []),
      withMeta: (value) => value,
    });

    await runCommand(command, {
      rawArgs: ["--json", "--layout", "proseCoverageFloor=0.05"],
    });

    expect(runPipeline).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({
        layout: { proseCoverageFloor: 0.05 },
      }),
    );
  });

  it("forwards layout options into driver.collectLayout", async () => {
    const collectLayout = vi.fn(async (_time: number, _tolerance: number, _layout?: unknown) => []);
    await runScenario(fakeDriver({ collectLayout }), { layout: { proseCoverageFloor: 0.05 } });
    expect(collectLayout).toHaveBeenCalled();
    expect(collectLayout).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), {
      proseCoverageFloor: 0.05,
    });
  });
});

describe("sampled finding reporting", () => {
  it("keeps the representative crop time paired with its geometry when dense observations arrive earlier", async () => {
    const movingOverlap = (time: number): AnchoredLayoutIssue => {
      const rect = fixtureRect(time * 1000, 20, 300, 80);
      return {
        ...layoutIssue("warning", { time, code: "content_overlap" }),
        rect,
        bbox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      };
    };
    const captureFindingCrops = vi.fn(async () => []);
    const { report } = await runScenario(
      fakeDriver({
        getDuration: vi.fn(async () => 1),
        collectLayout: vi.fn(async (time: number) => (time === 0.5 ? [movingOverlap(time)] : [])),
        collectOverlap: vi.fn(async (time: number) =>
          time >= 0.125 && time <= 0.75 ? [movingOverlap(time)] : [],
        ),
      }),
      { samples: 2, at: [0.5, 0.875], contrast: false, snapshots: true },
      { captureFindingCrops },
    );
    expect(report.layout.findings).toEqual([
      expect.objectContaining({
        code: "content_overlap",
        severity: "error",
        time: 0.5,
        firstSeen: 0.125,
        times: [0.125, 0.25, 0.375, 0.5, 0.625, 0.75],
        bbox: { x: 500, y: 20, width: 300, height: 80 },
      }),
    ]);
    expect(captureFindingCrops).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ snapshots: true }),
      [
        {
          filename: "finding-00-content_overlap.png",
          time: 0.5,
          bbox: { x: 500, y: 20, width: 300, height: 80 },
        },
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("retains all sampled times for a stationary frame failure", async () => {
    const { report } = await runScenario(
      fakeDriver({
        getDuration: vi.fn(async () => 8),
        collectGeometryCandidates: vi.fn(async (time: number) => [
          geometryCandidate({
            kind: "media",
            tag: "img",
            text: "img",
            selector: "#stationary",
            rect: fixtureRect(1920, 100, 130, 100),
            overflow: { right: 130 },
            time,
          }),
        ]),
      }),
      { contrast: false, samples: 1, frameCheck: { seek: [0.25, 0.75] } },
    );
    expect(report.layout.findings).toEqual([
      expect.objectContaining({
        code: "frame_out_of_frame",
        selector: "#stationary",
        times: [2, 6],
      }),
    ]);
  });

  it("keeps different rules on one element as separate findings", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [
          layoutIssue("error", { time, code: "clipped_text" }),
          layoutIssue("error", { time, code: "text_box_overflow" }),
        ]),
      }),
      { contrast: false, samples: 2, at: [0.5, 1.5] },
    );
    expect(report.layout.findings.map(({ code, times }) => ({ code, times }))).toEqual([
      { code: "clipped_text", times: [0.5, 1.5] },
      { code: "text_box_overflow", times: [0.5, 1.5] },
    ]);
  });

  it("retains per-sample layout observations when collapse is explicitly disabled", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [layoutIssue("error", { time })]),
      }),
      { contrast: false, collapseStatic: false, samples: 2, at: [0.5, 1.5] },
    );
    expect(report.layout.findings.map(({ code, time }) => ({ code, time }))).toEqual([
      { code: "clipped_text", time: 0.5 },
      { code: "clipped_text", time: 1.5 },
    ]);
  });

  it("reports held low contrast once with every occurrence time in JSON and terminal output", async () => {
    const times = [0.111, 0.556, 1, 1.444, 1.889];
    const { report } = await runScenario(
      fakeDriver({
        getDuration: vi.fn(async () => 2),
        collectContrast: vi.fn(async (time: number) => ({
          entries: [contrastEntry({ time, selector: "#low", ratio: time === 1 ? 1.2 : 2.5 })],
          pngBase64: PNG_BASE64,
        })),
      }),
      { samples: 5, at: times },
    );
    expect(report.contrast.findings).toEqual([
      expect.objectContaining({
        selector: "#low",
        severity: "error",
        times,
        time: 1,
        ratio: 1.2,
      }),
    ]);
    expect(report.contrast.errorCount).toBe(1);
    expect(report.contrast.checked).toBe(5);
    expect(checkExitCode(report)).toBe(1);
    const command = createCheckCommand({
      resolveProject: () => PROJECT,
      runPipeline: vi.fn(async () => report),
      prepareMedia: vi.fn(async () => []),
      withMeta: (value) => value,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCommand(command, { rawArgs: [] });
    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output.match(/#low/g)).toHaveLength(1);
    expect(output).toContain("t=0.111, 0.556, 1, 1.444, 1.889s");
    log.mockClear();
    await runCommand(command, { rawArgs: ["--json"] });
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).contrast.findings).toEqual(
      report.contrast.findings,
    );
  });

  it("keeps same-selector contrast failures in separate source files and grades each independently", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectContrast: vi.fn(async (time: number) => ({
          entries: [
            contrastEntry({
              time,
              selector: "#low",
              sourceFile: time < 1 ? "index.html" : "compositions/scene.html",
            }),
          ],
          pngBase64: PNG_BASE64,
        })),
      }),
      { samples: 2, at: [0.5, 1.5] },
    );
    expect(report.contrast.findings).toEqual([
      expect.objectContaining({ sourceFile: "index.html", severity: "warning", times: [0.5] }),
      expect.objectContaining({
        sourceFile: "compositions/scene.html",
        severity: "warning",
        times: [1.5],
      }),
    ]);
  });

  it("keeps same-selector layout findings from separate source files", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [
          {
            ...layoutIssue("error", { time }),
            sourceFile: time < 1 ? "index.html" : "compositions/scene.html",
          },
        ]),
      }),
      { contrast: false, samples: 2, at: [0.5, 1.5] },
    );
    expect(report.layout.findings).toEqual([
      expect.objectContaining({ sourceFile: "index.html", times: [0.5] }),
      expect.objectContaining({ sourceFile: "compositions/scene.html", times: [1.5] }),
    ]);
  });

  it("reports an element's repeated layout rule once even when its text changes", async () => {
    const { report } = await runScenario(
      fakeDriver({
        collectLayout: vi.fn(async (time: number) => [
          {
            ...layoutIssue("error", { time }),
            text: time < 1 ? "First" : "Changed",
          },
        ]),
      }),
      { contrast: false, samples: 2, at: [0.5, 1.5] },
    );
    expect(report.layout.findings).toHaveLength(1);
    expect(report.layout.findings[0]).toMatchObject({ code: "clipped_text", times: [0.5, 1.5] });
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

describe("dense motion-overlap re-sampling", () => {
  // Collision lives inside (3.5, 4.5), a gap the sparse base grid seeks past; only the 8fps dense pass observes it.
  const inBetweenGridWindow = (time: number): boolean => time >= 3.6 && time <= 4.4;

  it("detects a content_overlap that occurs ONLY between two sparse grid samples", async () => {
    const driver = fakeDriver({
      // Sparse base grid sees nothing at any base sample time.
      collectLayout: vi.fn(async (_time: number) => []),
      // The transient exists only strictly between base samples 3.5 and 4.5.
      collectOverlap: vi.fn(async (time: number) =>
        inBetweenGridWindow(time)
          ? [layoutIssue("warning", { time, code: "content_overlap" })]
          : [],
      ),
    });
    const { report } = await runScenario(driver);
    expect(driver.collectOverlap).toHaveBeenCalled();
    expect(report.layout.findings.some((f) => f.code === "content_overlap")).toBe(true);
    // Held ~750ms across the dense grid (>= the 500ms floor) -> promoted.
    expect(report.layout.errorCount).toBeGreaterThan(0);
  });

  it("runs the dense pass even when sparse fingerprints are identical (aliased motion)", async () => {
    // Aliased motion has identical fingerprints yet still collides between samples — the false-negative the removed gate caused.
    const driver = fakeDriver({
      collectLayoutGeometry: vi.fn(async () => "static"),
      collectLayout: vi.fn(async (_time: number) => []),
      collectOverlap: vi.fn(async (time: number) =>
        inBetweenGridWindow(time)
          ? [layoutIssue("warning", { time, code: "content_overlap" })]
          : [],
      ),
    });
    const { report } = await runScenario(driver);
    expect(driver.collectOverlap).toHaveBeenCalled();
    expect(report.layout.findings.some((f) => f.code === "content_overlap")).toBe(true);
  });

  it("keeps a long film's dense pass to a fixed number of seeks", async () => {
    const clipEdges = Array.from({ length: 433 }, (_, i) => [i * 1.2, i * 1.2 + 1.1]).flat();
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 540),
      getClipEdges: async () => clipEdges,
    });
    await runScenario(driver);
    expect(vi.mocked(driver.seekGeometry).mock.calls.length).toBeLessThanOrEqual(240);
  });

  it("still promotes an overlap held on a long film", async () => {
    const held = (time: number): boolean => time >= 200 && time <= 260;
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 540),
      collectLayout: vi.fn(async (_time: number) => []),
      collectOverlap: vi.fn(async (time: number) =>
        held(time) ? [layoutIssue("warning", { time, code: "content_overlap" })] : [],
      ),
    });
    const { report } = await runScenario(driver);
    expect(report.layout.findings).toContainEqual(
      expect.objectContaining({ code: "content_overlap", severity: "error" }),
    );
    expect(vi.mocked(driver.seekGeometry).mock.calls.length).toBeLessThanOrEqual(240);
  });

  it("spends one hold probe on an overlap that stays the whole film", async () => {
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 540),
      collectLayout: vi.fn(async (_time: number) => []),
      collectOverlap: vi.fn(async (time: number) => [
        layoutIssue("warning", { time, code: "content_overlap" }),
      ]),
    });
    await runScenario(driver);
    expect(vi.mocked(driver.seekGeometry).mock.calls.length).toBeLessThanOrEqual(181);
  });

  it("samples a short clip the uniform grid steps over", async () => {
    const inShortClip = (time: number): boolean => time > 101 && time < 101.8;
    const driver = fakeDriver({
      getDuration: vi.fn(async () => 540),
      getClipEdges: async () => [101, 101.8],
      collectLayout: vi.fn(async (_time: number) => []),
      collectOverlap: vi.fn(async (time: number) =>
        inShortClip(time) ? [layoutIssue("warning", { time, code: "content_overlap" })] : [],
      ),
    });
    const { report } = await runScenario(driver);
    expect(report.layout.findings.some((f) => f.code === "content_overlap")).toBe(true);
  });
});

describe("scoped check", () => {
  it("bounds all runtime seeks, including dense overlap and transition samples", async () => {
    const times: number[] = [];
    const overlapTimes: number[] = [];
    const driver = fakeDriver({
      getDuration: async () => 10,
      getTransitionBoundaries: async () => [1, 7.9, 9],
      seek: async (t) => {
        times.push(t);
      },
      seekGeometry: async (t) => {
        times.push(t);
        overlapTimes.push(t);
      },
    });
    const { report } = await runScenario(driver, { range: [7.8, 8.2], atTransitions: true });
    expect(times.length).toBeGreaterThan(3);
    expect(times.every((t) => t >= 7.8 && t <= 8.2)).toBe(true);
    expect(times).toContain(7.9);
    expect(overlapTimes.every((time) => (String(time).split(".")[1]?.length ?? 0) <= 3)).toBe(true);
    expect(report.scope?.range).toEqual([7.8, 8.2]);
  });
  it("keeps the full-check failure when the only error is hidden by filtering", async () => {
    const driver = fakeDriver({
      collectLayout: async () => [layoutIssue("error")],
      matchComponents: async (_c, f) => f.map(() => false),
    });
    const { report } = await runScenario(driver, {
      components: ["#selected"],
      collapseStatic: false,
    });
    expect(report.ok).toBe(false);
    expect(report.layout.findings).toHaveLength(0);
    expect(report.layout.errorCount).toBe(1);
    expect(report.runtime.findings).toHaveLength(0);
    expect(report.scope?.hiddenFindings).toBe(1);
  });
  it.each([
    {
      flag: "--caption-zone",
      options: {
        range: [1, 2] as [number, number],
        captionZone: { x0: 0, y0: 0.5, x1: 1, y1: 0.7 },
      },
    },
    {
      flag: "--frame-check",
      options: { range: [0, 1] as [number, number], frameCheck: {} },
    },
  ])(
    "refuses $flag when none of its gate samples lie within --range",
    async ({ flag, options }) => {
      const { report } = await runScenario(fakeDriver({ getDuration: async () => 4 }), options);
      expect(report.ok).toBe(false);
      expect(report.browserSkipped).toBe(true);
      expect(report.runtime.findings).toEqual([
        expect.objectContaining({ message: expect.stringContaining(`No ${flag} seek samples`) }),
      ]);
    },
  );
  it("marks a motion spec disabled when a range skips whole-timeline assertions", async () => {
    const motion: MotionSpecResolution = {
      kind: "valid",
      path: "/project/index.motion.json",
      spec: { assertions: [] },
    };
    const { report } = await runScenario(
      fakeDriver({ getDuration: async () => 4 }),
      { range: [1, 2] },
      { motion },
    );
    expect(report.motion).toEqual(
      expect.objectContaining({
        enabled: false,
        specPath: "/project/index.motion.json",
        samples: 0,
      }),
    );
  });
  it("rejects a range outside the film rather than passing an empty check", async () => {
    const { report } = await runScenario(fakeDriver({ getDuration: async () => 2 }), {
      range: [3, 4],
    });
    expect(report.ok).toBe(false);
    expect(report.browserSkipped).toBe(true);
    expect(report.runtime.findings[0]?.message).toContain("2 seconds");
  });
});

it("validates range syntax before running a check", () => {
  expect(parseCheckRange("7.8,8.2")).toEqual([7.8, 8.2]);
  expect(parseCheckRange("7.8:8.2")).toEqual([7.8, 8.2]);
  for (const value of ["", "1", "1,1", "2,1", "-1,2", "NaN,2", "1,Infinity", ",2", "1,2,3"])
    expect(() => parseCheckRange(value)).toThrow();
});

it("applies transition sample limits within the requested range", async () => {
  const driver = fakeDriver({
    getDuration: async () => 10,
    getTransitionBoundaries: async () => [0, 1, 2, 3, 4, 5, 6, 7.8, 7.9, 8, 9, 10],
  });
  const { report } = await runScenario(driver, {
    range: [7.8, 8],
    atTransitions: true,
    maxTransitionSamples: 2,
  });
  expect(report.layout.transitionSamples).toEqual([7.8, 8]);
  expect(report.layout.transitionSamplesDropped).toBe(3);
});
