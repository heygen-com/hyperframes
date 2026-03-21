import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import { lintHyperframeHtml } from "@hyperframes/core/lint";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";

export default defineCommand({
  meta: { name: "lint", description: "Validate a composition for common mistakes" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output findings as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const html = readFileSync(project.indexPath, "utf-8");
    const result = lintHyperframeHtml(html, { filePath: project.indexPath });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    }

    console.log(`${c.accent("◆")}  Linting ${c.accent(project.name + "/index.html")}`);
    console.log();

    if (result.ok) {
      console.log(`${c.success("◇")}  ${c.success("0 errors, 0 warnings")}`);
      return;
    }

    for (const finding of result.findings) {
      const prefix = finding.severity === "error" ? c.error("✗") : c.warn("⚠");
      const loc = finding.elementId ? ` ${c.accent(`[${finding.elementId}]`)}` : "";
      console.log(`${prefix}  ${c.bold(finding.code)}${loc}: ${finding.message}`);
      if (finding.fixHint) {
        console.log(`   ${c.dim(`Fix: ${finding.fixHint}`)}`);
      }
    }

    const summaryIcon = result.errorCount > 0 ? c.error("◇") : c.success("◇");
    console.log(`\n${summaryIcon}  ${result.errorCount} error(s), ${result.warningCount} warning(s)`);
    process.exit(result.errorCount > 0 ? 1 : 0);
  },
});
