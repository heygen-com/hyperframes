import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleWithLocalizedFonts } from "./bundleWithLocalizedFonts.js";
import { runCheckPipeline, DEFAULT_CHECK_OPTIONS, checkExitCode } from "./checkPipeline.js";
import { runBrowserCheck } from "./checkBrowser.js";
import { createCheckCommand } from "../commands/check.js";
import { consumeCommandResult } from "./commandResult.js";
import type { CheckDependencies } from "./checkTypes.js";
vi.mock("../capture/captureCompositionFrame.js", async (original) => ({
  ...(await original<typeof import("../capture/captureCompositionFrame.js")>()),
  openSettledCompositionPage: vi.fn(async () => {
    throw new Error("Chrome unavailable");
  }),
}));
vi.mock("./staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({ url: "http://localhost:1", close: vi.fn() })),
}));
vi.mock("./producer.js", () => ({
  loadProducer: vi.fn(async () => ({ injectDeterministicFontFaces: async (html: string) => html })),
}));
const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.restoreAllMocks();
  consumeCommandResult();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "check-compile-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "index.html"),
    `<!DOCTYPE html><html><head></head><body><div data-composition-id="main" data-width="640" data-height="360" data-duration="2" data-color-grading='{"lut":"gone.cube"}'><div data-composition-id="child" data-composition-src="gone.html" data-start="0" data-duration="2"></div></div></body></html>`,
  );
  return { dir, name: "compile fixture", indexPath: join(dir, "index.html") };
}
function dependencies(): CheckDependencies {
  return {
    lintProject: vi.fn(async () => ({
      results: [],
      totalErrors: 0,
      totalWarnings: 0,
      totalInfos: 0,
    })),
    resolveMotionSpec: vi.fn(() => ({ kind: "none" as const })),
    runBrowserCheck: (project, options, motion, compile) =>
      runBrowserCheck(project, options, motion, vi.fn(), compile),
    writeSnapshot: vi.fn(),
    captureFindingCrops: vi.fn(),
  };
}
it("forwards real missing LUT and sub-composition warnings through the font bundler", async () => {
  const diagnostics: unknown[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await bundleWithLocalizedFonts(fixture().dir, async (html) => html, {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "static_guard_invalid",
        source: "index.html",
        severity: "warning",
      }),
      expect.objectContaining({
        code: "color_grading_lut_not_inlined",
        source: "gone.cube",
        severity: "warning",
      }),
      expect.objectContaining({
        code: "sub_composition_skipped",
        source: "gone.html",
        severity: "warning",
      }),
    ]),
  );
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('Could not inline color grading LUT "gone.cube"'),
  );
});
it("keeps completed compile warnings in CLI JSON when Chrome later fails", async () => {
  const project = fixture();
  const deps = dependencies();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const command = createCheckCommand({
    withMeta: (value) => value,
    resolveProject: () => project,
    runPipeline: (p, options) => runCheckPipeline(p, { ...options, autoProxy: false }, deps),
  });
  await command.run!({ rawArgs: ["--json"], args: {}, cmd: command } as never);
  const report = JSON.parse(
    log.mock.calls.find(([line]) => typeof line === "string" && line.startsWith("{"))![0],
  );
  expect(report.compile.status).toBe("completed");
  expect(report.compile.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "color_grading_lut_not_inlined" }),
      expect.objectContaining({ code: "sub_composition_skipped" }),
    ]),
  );
  expect(report.runtime.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("Chrome unavailable") }),
    ]),
  );
});
it.each(["lint_errors", "motion_spec_invalid", "lint_failure"] as const)(
  "truthfully skips compile for %s",
  async (reason) => {
    const deps = dependencies();
    const browser = vi.fn(deps.runBrowserCheck);
    deps.runBrowserCheck = browser;
    if (reason === "lint_errors")
      deps.lintProject = vi.fn(async () => ({
        results: [],
        totalErrors: 1,
        totalWarnings: 0,
        totalInfos: 0,
      }));
    if (reason === "lint_failure")
      deps.lintProject = vi.fn(async () => {
        throw new Error("lint crashed");
      });
    if (reason === "motion_spec_invalid")
      deps.resolveMotionSpec = () => ({
        kind: "invalid",
        path: "index.motion.json",
        message: "invalid motion",
      });
    const report = await runCheckPipeline(fixture(), DEFAULT_CHECK_OPTIONS, deps);
    expect(report.compile).toEqual({ status: "not_run", reason, diagnostics: [] });
    expect(browser).not.toHaveBeenCalled();
  },
);

it("marks a real bundling failure failed rather than completed", async () => {
  const project = fixture();
  rmSync(join(project.dir, "index.html"));
  const report = await runCheckPipeline(
    project,
    { ...DEFAULT_CHECK_OPTIONS, autoProxy: false },
    dependencies(),
  );
  expect(report.compile).toEqual({ status: "failed", diagnostics: [] });
  expect(report.runtime.findings[0]?.message).toContain("index.html not found");
  expect(checkExitCode(report)).not.toBe(0);
});
