import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintHyperframeHtml } from "@hyperframes/core/lint";
import type { HyperframeLintFinding } from "@hyperframes/core/lint";
import { walkDir } from "@hyperframes/core/studio-api";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export default defineCommand({
  meta: { name: "lint", description: "Validate a composition for common mistakes" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output findings as JSON", default: false },
  },
  async run({ args }) {
    try {
      const project = resolveProject(args.dir);
      const htmlFiles = walkDir(project.dir).filter((f) => f.endsWith(".html"));

      const allFindings: (HyperframeLintFinding & { file: string })[] = [];
      let totalErrors = 0;
      let totalWarnings = 0;
      let totalInfos = 0;

      for (const file of htmlFiles) {
        const html = readFileSync(join(project.dir, file), "utf-8");
        const result = lintHyperframeHtml(html, { filePath: file });
        for (const f of result.findings) {
          allFindings.push({ ...f, file });
        }
        totalErrors += result.errorCount;
        totalWarnings += result.warningCount;
        totalInfos += result.infoCount;
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({
              ok: totalErrors === 0,
              findings: allFindings,
              errorCount: totalErrors,
              warningCount: totalWarnings,
              infoCount: totalInfos,
              filesScanned: htmlFiles.length,
            }),
            null,
            2,
          ),
        );
        process.exit(totalErrors > 0 ? 1 : 0);
      }

      console.log(
        `${c.accent("◆")}  Linting ${c.accent(project.name)} (${htmlFiles.length} HTML files)`,
      );
      console.log();

      if (allFindings.length === 0) {
        console.log(`${c.success("◇")}  ${c.success("0 errors, 0 warnings")}`);
        return;
      }

      for (const finding of allFindings) {
        const prefix =
          finding.severity === "error"
            ? c.error("✗")
            : finding.severity === "warning"
              ? c.warn("⚠")
              : c.dim("ℹ");
        const loc = finding.elementId ? ` ${c.accent(`[${finding.elementId}]`)}` : "";
        console.log(
          `${prefix}  ${c.bold(finding.code)}${loc}: ${finding.message} ${c.dim(finding.file)}`,
        );
        if (finding.fixHint) {
          console.log(`   ${c.dim(`Fix: ${finding.fixHint}`)}`);
        }
      }

      const summaryIcon = totalErrors > 0 ? c.error("◇") : c.success("◇");
      const summaryParts = [`${totalErrors} error(s)`, `${totalWarnings} warning(s)`];
      if (totalInfos > 0) {
        summaryParts.push(`${totalInfos} info(s)`);
      }
      console.log(`\n${summaryIcon}  ${summaryParts.join(", ")}`);
      process.exit(totalErrors > 0 ? 1 : 0);
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
