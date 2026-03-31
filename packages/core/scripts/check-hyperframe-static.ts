import fs from "node:fs";
import path from "node:path";
import { lintHyperframeHtml } from "../src/lint/hyperframeLinter";
import type { HyperframeLintResult } from "../src/lint/types";

function formatCounts(result: HyperframeLintResult): string {
  const parts = [`${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`];
  if (result.infoCount > 0) {
    parts.push(`${result.infoCount} info${result.infoCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

function formatHumanOutput(result: HyperframeLintResult, resolvedPath: string): string {
  const counts = result.ok
    ? formatCounts(result)
    : `${result.errorCount} error${result.errorCount === 1 ? "" : "s"}, ${formatCounts(result)}`;
  const lines = [
    result.ok ? `PASS ${resolvedPath} (${counts})` : `FAIL ${resolvedPath} (${counts})`,
  ];

  for (const finding of result.findings) {
    lines.push(`- [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`);
    if (finding.selector) {
      lines.push(`  selector: ${finding.selector}`);
    }
    if (finding.elementId) {
      lines.push(`  elementId: ${finding.elementId}`);
    }
    if (finding.fixHint) {
      lines.push(`  fix: ${finding.fixHint}`);
    }
  }

  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const jsonOutput = normalizedArgs.includes("--json");
  const positionalArgs = normalizedArgs.filter((arg) => arg !== "--json");
  const inputPath = positionalArgs[0];
  if (!inputPath) {
    console.error(
      "Usage: bun run check:hyperframe-html [--json] <path-to-html>\nExample: bun run check:hyperframe-html core/src/tests/broken-video.html",
    );
    process.exit(2);
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(2);
  }

  const html = fs.readFileSync(resolvedPath, "utf-8");
  const result = lintHyperframeHtml(html, { filePath: resolvedPath });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (result.ok) {
    console.log(formatHumanOutput(result, resolvedPath));
    process.exit(0);
  }

  console.error(formatHumanOutput(result, resolvedPath));
  process.exit(1);
}

main();
