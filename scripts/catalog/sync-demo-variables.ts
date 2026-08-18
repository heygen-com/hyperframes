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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { layerVariablesOntoDemo, snippetOwnsItsMotion } from "./component-variables.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const componentsDir = join(repoRoot, "registry/components");

interface Manifest {
  name: string;
  variables?: unknown[];
  files?: { path?: string; type?: string }[];
}

export interface DemoSyncResult {
  name: string;
  status: "synced" | "already" | "not-applicable";
  detail?: string;
}

export function syncDemoVariables(write: boolean): DemoSyncResult[] {
  const results: DemoSyncResult[] = [];

  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(componentsDir, entry.name);
    const manifestPath = join(dir, "registry-item.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
    if (!Array.isArray(manifest.variables) || manifest.variables.length === 0) continue;

    const snippetPath = (manifest.files ?? []).find((f) => f.type === "hyperframes:snippet")?.path;
    const demoPath = join(dir, "demo.html");
    if (!snippetPath || !existsSync(join(dir, snippetPath)) || !existsSync(demoPath)) continue;

    const snippet = readFileSync(join(dir, snippetPath), "utf-8");
    if (snippetOwnsItsMotion(snippet)) {
      results.push({
        name: manifest.name,
        status: "not-applicable",
        detail: "preview uses the snippet",
      });
      continue;
    }

    const demo = readFileSync(demoPath, "utf-8");
    const layered = layerVariablesOntoDemo(demo, snippet);
    if (!layered.applied) {
      const already = layered.reason === "demo already declares its variables";
      results.push({
        name: manifest.name,
        status: already ? "already" : "not-applicable",
        detail: layered.reason,
      });
      continue;
    }

    if (write) writeFileSync(demoPath, layered.html, "utf-8");
    results.push({ name: manifest.name, status: "synced" });
  }

  return results;
}

function main(): void {
  const check = process.argv.includes("--check");
  const results = syncDemoVariables(!check);
  const synced = results.filter((r) => r.status === "synced");

  for (const r of results.filter(
    (r) => r.status === "not-applicable" && r.detail !== "preview uses the snippet",
  )) {
    console.log(`  · ${r.name}: ${r.detail}`);
  }

  if (check) {
    if (synced.length === 0) {
      console.log(
        `Every component demo carries its snippet's variables (${results.length} checked).`,
      );
      return;
    }
    console.error(
      `\n${synced.length} demo(s) have drifted from their snippet and would render a dead ` +
        `variables panel:\n${synced.map((r) => `  ${r.name}`).join("\n")}\n\n` +
        `Run: npx tsx scripts/catalog/sync-demo-variables.ts`,
    );
    process.exit(1);
  }

  console.log(
    `Synced ${synced.length} demo(s); ` +
      `${results.filter((r) => r.status === "already").length} already carried their variables.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
