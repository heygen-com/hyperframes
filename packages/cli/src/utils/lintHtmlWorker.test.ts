import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { runCancellableProcess, runRenderSetupWorker } from "./cancellableProcess.js";
import { lintHtmlOutOfProcess } from "./lintHtmlWorker.js";

const PAGE = `<html><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080"></div></body></html>`;
const OPTS = { filePath: "index.html", host: "studio" as const };
const withoutTimings = ({ timings: _timings, ...rest }: Record<string, unknown>) => rest;

describe("lintHtmlOutOfProcess", () => {
  // The second page is past the ~128 KB an env var can carry, so it only lints if the page travels in a file.
  it.each([PAGE, PAGE.replace("</body>", `<!-- ${"x".repeat(300_000)} -->\n</body>`)])(
    "lints a %#-th page in a child to what the linter returns in process",
    async (html) => {
      let pageDir = "";
      const run = ((mode, input, options) => {
        pageDir = dirname((input as { htmlPath: string }).htmlPath);
        return runRenderSetupWorker(mode, input, options);
      }) as typeof runRenderSetupWorker;
      const result = await lintHtmlOutOfProcess(html, OPTS, { run });
      expect(withoutTimings({ ...result })).toEqual(
        withoutTimings({ ...(await lintHyperframeHtml(html, OPTS)) }),
      );
      expect(existsSync(pageDir)).toBe(false);
    },
    30_000,
  );

  it("answers a child that never answers with the lint_aborted error, and does not lint here", async () => {
    // A real child that never exits, stopped by the runner's own time limit.
    const hang = ((_mode, _input, options) =>
      runCancellableProcess(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], {
        timeoutMs: options.timeoutMs,
      })) as typeof runRenderSetupWorker;
    const began = performance.now();
    const result = await lintHtmlOutOfProcess(PAGE, OPTS, { run: hang, timeoutMs: 300 });
    expect(performance.now() - began).toBeLessThan(10_000);
    expect([result.ok, result.errorCount, result.warningCount, result.infoCount]).toEqual([
      false,
      1,
      0,
      0,
    ]);
    expect(result.findings.map(({ code, severity, file }) => [code, severity, file])).toEqual([
      ["lint_aborted", "error", "index.html"],
    ]);
  });
});
