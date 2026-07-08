import { defineCommand } from "citty";
import {
  validateHtmlInBrowser,
  type ConsoleEntry,
  type ContrastEntry,
} from "@hyperframes/validate";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import type { ProjectLintResult } from "../utils/lintProject.js";
import { c } from "../ui/colors.js";
import { withMeta } from "../utils/updateCheck.js";

/**
 * Pull the `missing_or_empty_sub_composition` lint findings out of a
 * `lintProject` result and shape them as `ConsoleEntry`s. Extracted as a
 * pure function so it's testable without a headless browser or a real
 * project directory — see validate.test.ts.
 */
export function extractCompositionErrorsFromLint(
  lintResult: Pick<ProjectLintResult, "results">,
): ConsoleEntry[] {
  return lintResult.results
    .flatMap((r) => r.result.findings)
    .filter((f) => f.code === "missing_or_empty_sub_composition" && f.severity === "error")
    .map((f) => ({ level: "error" as const, text: f.message }));
}

async function validateInBrowser(
  project: ProjectDir,
  opts: { timeout?: number; contrast?: boolean },
): Promise<{ errors: ConsoleEntry[]; warnings: ConsoleEntry[]; contrast?: ContrastEntry[] }> {
  const projectDir = project.dir;
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { lintProject } = await import("../utils/lintProject.js");
  const { ensureBrowser } = await import("../browser/manager.js");

  // Fail fast on missing/empty/unparsable data-composition-src references
  // before spending time bundling and launching a browser. The bundler
  // (bundleToSingleHtml → inlineSubCompositions) is intentionally tolerant of
  // these — it skips the broken scene and keeps going, silently, with only a
  // console.warn — so validate would otherwise report "No console errors"
  // for a project that renders a materially broken video. Surface it as a
  // real validate failure instead.
  const lintResult = await lintProject(projectDir);
  const compositionErrors = extractCompositionErrorsFromLint(lintResult);

  // `bundleToSingleHtml` now inlines the runtime IIFE by default, so the
  // previous post-bundle regex substitution (which matched `src="..."` on the
  // runtime tag) is no longer needed — there's no `src` attribute to match.
  const html = await bundleToSingleHtml(projectDir);
  const browser = await ensureBrowser();
  return validateHtmlInBrowser(html, {
    browserExecutablePath: browser.executablePath,
    projectDir,
    timeout: opts.timeout,
    contrast: opts.contrast,
    prependErrors: compositionErrors,
  });
}

function printContrastFailures(failures: ContrastEntry[]) {
  console.log();
  console.log(`  ${c.warn("⚠")} WCAG AA contrast warnings (${failures.length}):`);
  for (const cf of failures) {
    const threshold = cf.large ? "3" : "4.5";
    console.log(
      `    ${c.warn("·")} ${cf.selector} ${c.dim(`"${cf.text}"`)} — ${c.warn(cf.ratio + ":1")} ${c.dim(`(need ${threshold}:1, t=${cf.time}s)`)}`,
    );
  }
}

function emitJsonReport(
  errors: ConsoleEntry[],
  warnings: ConsoleEntry[],
  contrast: ContrastEntry[] | undefined,
  contrastFailures: ContrastEntry[],
): void {
  console.log(
    JSON.stringify(
      withMeta({
        ok: errors.length === 0,
        errors,
        warnings,
        contrast,
        contrastFailures: contrastFailures.length,
      }),
      null,
      2,
    ),
  );
}

function formatConsoleEntry(prefix: string, e: ConsoleEntry): string {
  return `  ${prefix} ${e.text}${e.line ? c.dim(` (line ${e.line})`) : ""}`;
}

function formatTotals(
  errors: ConsoleEntry[],
  warnings: ConsoleEntry[],
  contrastFailures: ContrastEntry[],
): string {
  const parts = [`${errors.length} error(s)`, `${warnings.length} warning(s)`];
  if (contrastFailures.length > 0) parts.push(`${contrastFailures.length} contrast warning(s)`);
  return parts.join(", ");
}

function emitTextReport(
  errors: ConsoleEntry[],
  warnings: ConsoleEntry[],
  contrastFailures: ContrastEntry[],
  contrastPassed: ContrastEntry[],
): void {
  const hasIssues = errors.length > 0 || warnings.length > 0 || contrastFailures.length > 0;
  if (!hasIssues) {
    const suffix =
      contrastPassed.length > 0 ? ` · ${contrastPassed.length} text elements pass WCAG AA` : "";
    console.log(`${c.success("◇")}  No console errors${suffix}`);
    return;
  }

  console.log();
  for (const e of errors) console.log(formatConsoleEntry(c.error("✗"), e));
  for (const w of warnings) console.log(formatConsoleEntry(c.warn("⚠"), w));
  if (contrastFailures.length > 0) printContrastFailures(contrastFailures);

  console.log();
  console.log(`${c.accent("◇")}  ${formatTotals(errors, warnings, contrastFailures)}`);
}

function emitFailureReport(message: string, asJson: boolean): void {
  if (asJson) {
    console.log(
      JSON.stringify(withMeta({ ok: false, error: message, errors: [], warnings: [] }), null, 2),
    );
    return;
  }
  console.error(`${c.error("✗")} ${message}`);
}

export default defineCommand({
  meta: {
    name: "validate",
    description: `Load a composition in headless Chrome and report console errors

Examples:
  hyperframes validate
  hyperframes validate ./my-project
  hyperframes validate --json
  hyperframes validate --timeout 5000`,
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
    contrast: {
      type: "boolean",
      description: "WCAG contrast audit (enabled by default)",
      default: true,
    },
    timeout: {
      type: "string",
      description:
        "Ms to wait for scripts to settle and media to load (default: 3000). Also raises the " +
        "page-navigation budget above its 10s floor when a slow external <script> needs longer.",
      default: "3000",
    },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const timeout = parseInt(args.timeout as string, 10) || 3000;
    const useContrast = args.contrast ?? true;
    const asJson = Boolean(args.json);

    if (!asJson) {
      console.log(`${c.accent("◆")}  Validating ${c.accent(project.name)} in headless Chrome`);
    }

    try {
      const result = await validateInBrowser(project, { timeout, contrast: useContrast });
      const exitCode = printValidationResult(result, asJson);
      process.exit(exitCode);
    } catch (err: unknown) {
      const message = normalizeErrorMessage(err);
      emitFailureReport(message, asJson);
      process.exit(1);
    }
  },
});

function printValidationResult(
  result: { errors: ConsoleEntry[]; warnings: ConsoleEntry[]; contrast?: ContrastEntry[] },
  asJson: boolean,
): number {
  const { errors, warnings, contrast } = result;
  const contrastFailures = (contrast ?? []).filter((e) => !e.wcagAA);
  const contrastPassed = (contrast ?? []).filter((e) => e.wcagAA);

  if (asJson) {
    emitJsonReport(errors, warnings, contrast, contrastFailures);
  } else {
    emitTextReport(errors, warnings, contrastFailures, contrastPassed);
  }
  return errors.length > 0 ? 1 : 0;
}
