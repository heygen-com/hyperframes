#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_ITEM_PATH =
  /^registry\/(?:blocks|components|examples)\/([^/]+)\/registry-item\.json$/;

export function registryItemNamesFromPaths(paths) {
  const names = new Set();
  for (const path of paths) {
    const match = path.match(REGISTRY_ITEM_PATH);
    if (match) names.add(match[1]);
  }
  return names;
}

// A name only counts as an intentional removal or addition when its own
// registry-item.json file was deleted or added in the same diff — a bare
// registry.json edit with no matching file change is never expected.
export function computeRegistrySetDelta({ baseNames, headNames, removed, added }) {
  const expected = new Set([...baseNames].filter((name) => !removed.has(name)));
  for (const name of added) expected.add(name);
  const missing = [...expected].filter((name) => !headNames.has(name)).sort();
  const unexpected = [...headNames].filter((name) => !expected.has(name)).sort();
  return { missing, unexpected };
}

function diffPaths(run, base, filter) {
  return run(["diff", "--name-only", `--diff-filter=${filter}`, base + "...HEAD"])
    .split("\n")
    .filter(Boolean);
}

// IO is injected so the git/fs boundary can be swapped for a fake in tests;
// the actual delta logic lives in computeRegistrySetDelta above.
export function runRegistrySetDeltaCheck(base, { run, readRegistryJson }) {
  const baseManifest = JSON.parse(run(["show", base + ":registry/registry.json"]));
  const headManifest = JSON.parse(readRegistryJson());
  const removed = registryItemNamesFromPaths(diffPaths(run, base, "D"));
  const added = registryItemNamesFromPaths(diffPaths(run, base, "A"));
  const baseNames = new Set(baseManifest.items.map(({ name }) => name));
  const headNames = new Set(headManifest.items.map(({ name }) => name));
  const { missing, unexpected } = computeRegistrySetDelta({ baseNames, headNames, removed, added });
  return { missing, unexpected, removedCount: removed.size, addedCount: added.size };
}

export function formatRegistrySetDeltaResult({
  base,
  missing,
  unexpected,
  removedCount,
  addedCount,
}) {
  const sections = [
    ["missing from registry.json", missing],
    ["unexpected in registry.json", unexpected],
  ].filter(([, names]) => names.length > 0);
  if (sections.length === 0) {
    return {
      ok: true,
      text: `Registry item-set delta matches ${removedCount} removal(s) and ${addedCount} addition(s) against ${base}.`,
    };
  }
  const lines = sections.map(([label, names]) => `  ${label}: ${names.join(", ")}`);
  return {
    ok: false,
    text: ["Registry item-set delta mismatch against " + base + ":", ...lines].join("\n"),
  };
}

function main() {
  const base = process.argv[2] ?? "origin/main";
  const run = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const readRegistryJson = () => readFileSync("registry/registry.json", "utf8");
  const delta = runRegistrySetDeltaCheck(base, { run, readRegistryJson });
  const result = formatRegistrySetDeltaResult({ base, ...delta });
  if (!result.ok) process.exitCode = 1;
  console[result.ok ? "log" : "error"](result.text);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
