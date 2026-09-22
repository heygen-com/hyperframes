#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const base = process.argv[2] ?? "origin/main";
const run = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const baseManifest = JSON.parse(run(["show", base + ":registry/registry.json"]));
const headManifest = JSON.parse(readFileSync("registry/registry.json", "utf8"));
const deletedPaths = run(["diff", "--name-only", "--diff-filter=D", base + "...HEAD"])
  .split("\n")
  .filter((path) =>
    /^registry\/(?:blocks|components|examples)\/[^/]+\/registry-item\.json$/.test(path),
  );
const removed = new Set(deletedPaths.map((path) => path.split("/")[2]));
const baseNames = new Set(baseManifest.items.map(({ name }) => name));
const headNames = new Set(headManifest.items.map(({ name }) => name));
const expected = new Set([...baseNames].filter((name) => !removed.has(name)));
const missing = [...expected].filter((name) => !headNames.has(name)).sort();
const unexpected = [...headNames].filter((name) => !expected.has(name)).sort();
if (missing.length || unexpected.length) {
  console.error("Registry item-set delta mismatch against " + base + ":");
  if (missing.length) console.error("  missing from registry.json: " + missing.join(", "));
  if (unexpected.length) console.error("  unexpected in registry.json: " + unexpected.join(", "));
  process.exit(1);
}
console.log(
  "Registry item-set delta matches " + removed.size + " intentional removals against " + base + ".",
);
