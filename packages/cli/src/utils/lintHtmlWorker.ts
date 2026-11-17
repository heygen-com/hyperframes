import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HyperframeLinterOptions, HyperframeLintResult } from "@hyperframes/lint";
import { runRenderSetupWorker } from "./cancellableProcess.js";

/** A real composition lints in about a second at a few tens of MB of heap; this is where a runaway is stopped. */
const LINT_HTML_HEAP_MB = 512;
const LINT_HTML_TIMEOUT_MS = 15_000;

type LintHtmlTestHooks = { run?: typeof runRenderSetupWorker; timeoutMs?: number };

/** The linter's own result shape for a page it could not check: one error, never linted in this process. */
function abortedLintResult(
  opts: HyperframeLinterOptions | undefined,
  afterMs: number,
): HyperframeLintResult {
  return {
    ok: false,
    errorCount: 1,
    warningCount: 0,
    infoCount: 0,
    findings: [
      {
        code: "lint_aborted",
        severity: "error",
        message:
          "This composition's script could not be checked: linting it ran too long or out of memory, so it was stopped. A very large or deeply nested script is the usual cause.",
        ...(opts?.filePath && { file: opts.filePath }),
      },
    ],
    timings: { totalMs: afterMs, groupMs: {}, slowestRule: "", slowestRuleMs: 0 },
  };
}

/**
 * Lints one page in a child process with a heap cap and a time limit, so a long-lived host (Studio)
 * survives a page that sends the parser into a runaway: that page's lint is the `lint_aborted`
 * error. The child timing out, dying or exiting without a result never falls back to linting here.
 */
export async function lintHtmlOutOfProcess(
  html: string,
  opts: HyperframeLinterOptions | undefined,
  { run = runRenderSetupWorker, timeoutMs = LINT_HTML_TIMEOUT_MS }: LintHtmlTestHooks = {},
): Promise<HyperframeLintResult> {
  // The runner hands its input over in an env var, which a large page would overflow: the page goes in a file.
  const dir = await mkdtemp(join(tmpdir(), "hf-lint-"));
  const htmlPath = join(dir, "page.html");
  try {
    await writeFile(htmlPath, html);
    const began = performance.now();
    try {
      return await run<HyperframeLintResult>(
        "lint-html",
        { htmlPath, opts },
        {
          execArgv: [`--max-old-space-size=${LINT_HTML_HEAP_MB}`],
          maxBufferBytes: 8 * 1024 * 1024,
          timeoutMs,
        },
      );
    } catch {
      return abortedLintResult(opts, Math.round(performance.now() - began));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
