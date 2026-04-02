import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Lint the current project", "hyperframes lint"],
  ["Lint a specific directory", "hyperframes lint ./my-video"],
  ["Output findings as JSON", "hyperframes lint --json"],
  ["Include info-level findings", "hyperframes lint --verbose"],
];
import { formatLintFindings } from "../utils/lintFormat.js";
import { lintProject } from "../utils/lintProject.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export default defineCommand({
  meta: {
    name: "lint",
    description: "Validate a composition for common mistakes",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output findings as JSON",
      default: false,
    },
    verbose: {
      type: "boolean",
      description: "Show info-level findings (hidden by default)",
      default: false,
    },
  },
  async run({ args }) {
    try {
      const project = resolveProject(args.dir);
      const lintResult = lintProject(project);

      if (args.json) {
        const allFindings = lintResult.results.flatMap((r) => r.result.findings);
        const combined = {
          ok: lintResult.totalErrors === 0,
          errorCount: lintResult.totalErrors,
          warningCount: lintResult.totalWarnings,
          infoCount: lintResult.totalInfos,
          findings: args.verbose ? allFindings : allFindings.filter((f) => f.severity !== "info"),
          filesScanned: lintResult.results.length,
        };
        console.log(JSON.stringify(withMeta(combined), null, 2));
        process.exit(combined.ok ? 0 : 1);
      }

      const fileCount = lintResult.results.length;
      const fileLabel =
        fileCount === 1 ? (lintResult.results[0]?.file ?? "index.html") : `${fileCount} files`;
      console.log(`${c.accent("◆")}  Linting ${c.accent(`${project.name}/${fileLabel}`)}`);
      console.log();

      if (lintResult.totalErrors === 0 && lintResult.totalWarnings === 0) {
        console.log(`${c.success("◇")}  ${c.success("0 errors, 0 warnings")}`);
        return;
      }

      const lines = formatLintFindings(lintResult, {
        showElementId: true,
        showSummary: true,
        verbose: args.verbose,
      });
      for (const line of lines) console.log(line);

      process.exit(lintResult.totalErrors > 0 ? 1 : 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({
              ok: false,
              error: message,
              findings: [],
              errorCount: 0,
              warningCount: 0,
              infoCount: 0,
              filesScanned: 0,
            }),
            null,
            2,
          ),
        );
        process.exit(1);
      }
      console.error(message);
      process.exit(1);
    }
  },
});
