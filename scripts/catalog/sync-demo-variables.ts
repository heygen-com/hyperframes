#!/usr/bin/env tsx
/**
 * Keep a component's demo carrying the variables its snippet declares.
 *
 * A component ships a snippet, which is what the catalog hands you to paste,
 * and a `demo.html`, which stages it and animates it. The demo was authored as
 * a copy of the snippet rather than as a reference to it, and copies drift:
 * almost every demo had lost the `data-composition-variables` block, the script
 * that turns a chosen value into a CSS custom property, and the CSS written
 * against those properties. The catalog preview is built from the demo, so the
 * variables panel on those pages could not change anything.
 *
 * This writes the missing pieces back into the demo, once, in the registry,
 * rather than patching them in every time a payload is built. `--check` reports
 * drift without writing, which is what CI runs: a demo edited later that drops
 * the declaration fails the build instead of silently producing a dead panel.
 *
 * Only components whose snippet does not own its motion are handled here. The
 * ones that register their own timeline have their preview built from the
 * snippet directly, so their demo is not in that path at all.
 *
 * Usage:
 *   npx tsx scripts/catalog/sync-demo-variables.ts          # write
 *   npx tsx scripts/catalog/sync-demo-variables.ts --check  # report only
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isEntrypoint } from "../entrypoint.ts";
import { componentFiles } from "./component-files.ts";
import { layerVariablesOntoDemo, snippetOwnsItsMotion } from "./component-variables.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const componentsDir = join(repoRoot, "registry/components");

export interface DemoSyncResult {
  name: string;
  status: "synced" | "already" | "not-applicable";
  detail?: string;
}

/** A demo left alone: either it was already right, or it cannot be layered. */
function untouched(name: string, reason: string): DemoSyncResult {
  const already = reason === "demo already declares its variables";
  return { name, status: already ? "already" : "not-applicable", detail: reason };
}

function syncPair(name: string, demoPath: string, snippet: string, write: boolean): DemoSyncResult {
  if (snippetOwnsItsMotion(snippet)) return untouched(name, "preview uses the snippet");

  const layered = layerVariablesOntoDemo(readFileSync(demoPath, "utf-8"), snippet);
  if (!layered.applied) return untouched(name, layered.reason);

  if (write) writeFileSync(demoPath, layered.html, "utf-8");
  return { name, status: "synced" };
}

function syncOne(dir: string, write: boolean): DemoSyncResult | null {
  const files = componentFiles(dir);
  if (!files?.demoPath) return null;

  const snippet = readFileSync(files.snippetPath, "utf-8");
  return syncPair(files.name, files.demoPath, snippet, write);
}

export function syncDemoVariables(write: boolean): DemoSyncResult[] {
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => syncOne(join(componentsDir, entry.name), write))
    .filter((result): result is DemoSyncResult => result !== null);
}

/** Name the components that could not be layered, so a refusal is never silent. */
function logRefusal(result: DemoSyncResult): void {
  if (result.status === "not-applicable" && result.detail !== "preview uses the snippet") {
    console.log(`  · ${result.name}: ${result.detail}`);
  }
}

function reportWritten(results: DemoSyncResult[]): void {
  const synced = results.filter((r) => r.status === "synced").length;
  const already = results.filter((r) => r.status === "already").length;
  console.log(`Synced ${synced} demo(s); ${already} already carried their variables.`);
}

function reportDrift(results: DemoSyncResult[]): void {
  const drifted = results.filter((r) => r.status === "synced");
  if (drifted.length === 0) {
    console.log(
      `Every component demo carries its snippet's variables (${results.length} checked).`,
    );
    return;
  }

  console.error(
    `\n${drifted.length} demo(s) have drifted from their snippet and would render a dead ` +
      `variables panel:\n${drifted.map((r) => `  ${r.name}`).join("\n")}\n\n` +
      `Run: npx tsx scripts/catalog/sync-demo-variables.ts`,
  );
  process.exit(1);
}

function report(results: DemoSyncResult[], check: boolean): void {
  for (const result of results) logRefusal(result);
  if (check) reportDrift(results);
  else reportWritten(results);
}

if (isEntrypoint(import.meta.url)) {
  const check = process.argv.includes("--check");
  report(syncDemoVariables(!check), check);
}
