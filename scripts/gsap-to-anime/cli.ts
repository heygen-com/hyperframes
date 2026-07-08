#!/usr/bin/env tsx

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertTotalsReconcile,
  renderMarkdownReport,
  scanRegistryTree,
  transformHtml,
} from "./index.ts";

interface Options {
  target: string;
  dryRun: boolean;
  write: boolean;
  reportJson: string;
  reportMd: string;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const target = resolve(options.target);
  if (!existsSync(target)) fail(`Path not found: ${target}`);
  if (statSync(target).isDirectory()) {
    runDirectory(target, options);
    return;
  }
  runFile(target, options);
}

function parseArgs(args: string[]): Options {
  let target = "";
  let dryRun = false;
  let write = false;
  let reportJson = "scripts/gsap-to-anime/dry-run-report.json";
  let reportMd = "scripts/gsap-to-anime/dry-run-report.md";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--write") write = true;
    else if (arg === "--report-json") reportJson = readValue(args, (index += 1), arg);
    else if (arg === "--report-md") reportMd = readValue(args, (index += 1), arg);
    else if (arg && !arg.startsWith("--") && target === "") target = arg;
    else fail(`Unknown argument: ${arg ?? ""}`);
  }
  if (!target)
    fail(
      "Usage: node --import tsx scripts/gsap-to-anime/cli.ts <file-or-registry-dir> [--dry-run] [--write]",
    );
  return { target, dryRun, write, reportJson, reportMd };
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) fail(`${flag} requires a value`);
  return value;
}

function runFile(path: string, options: Options): void {
  const html = readFileSync(path, "utf-8");
  const result = transformHtml(html);
  console.log(JSON.stringify(result.classification, null, 2));
  if (options.write && !options.dryRun && result.changed) {
    writeFileSync(path, result.html, "utf-8");
  }
}

function runDirectory(path: string, options: Options): void {
  if (!options.dryRun) fail("Directory mode is dry-run only for this codemod unit");
  const report = scanRegistryTree(path);
  assertTotalsReconcile(report);
  writeFileSync(resolve(options.reportJson), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  writeFileSync(resolve(options.reportMd), renderMarkdownReport(report), "utf-8");
  console.log(JSON.stringify(report.totals));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
