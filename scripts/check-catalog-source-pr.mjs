import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isGeneratedCatalogPath } from "./catalog-generated-paths.mjs";

const ITEM_FILE = /^registry\/(blocks|components|examples)\/[^/]+\//;
const ITEM_MANIFEST = /^registry\/[^/]+\/[^/]+\/registry-item\.json$/;
const INDEX = "registry/registry.json";

export function committedCatalogOutputs(paths, removalOnlyIndex = false) {
  if (!paths.some((path) => ITEM_FILE.test(path))) return [];
  return paths.filter(isGeneratedCatalogPath).filter((path) => path !== INDEX || !removalOnlyIndex);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function sourceFiles(ref) {
  return git("ls-tree", "-r", "--name-only", "-z", ref, "--", "registry")
    .split("\0")
    .filter((path) => ITEM_FILE.test(path));
}

function removedItems(base) {
  const before = sourceFiles(base);
  const after = new Set(sourceFiles("HEAD"));
  const remainingDirectories = new Set([...after].map((path) => ITEM_FILE.exec(path)[0]));
  return before
    .filter((path) => ITEM_MANIFEST.test(path) && !after.has(path))
    .map((path) => {
      const directory = ITEM_FILE.exec(path)[0];
      if (remainingDirectories.has(directory))
        throw new Error(
          `Remove the complete item directory when deleting its manifest: ${directory}`,
        );
      return JSON.parse(git("show", `${base}:${path}`));
    });
}

function checkIndexRemovals(base, indexChanged) {
  const removed = new Set(removedItems(base).map((item) => `${item.type}/${item.name}`));
  const before = JSON.parse(git("show", `${base}:${INDEX}`));
  const after = JSON.parse(git("show", `HEAD:${INDEX}`));
  const items = before.items.filter((item) => !removed.has(`${item.type}/${item.name}`));
  const hasRemovals = items.length < before.items.length;
  if (!isDeepStrictEqual(after, { ...before, items }))
    throw new Error(
      "Source PRs must remove deleted items from registry/registry.json in the same commit. " +
        "Do not add entries or change index metadata; automation publishes those changes.",
    );
  if (indexChanged && !hasRemovals)
    throw new Error(
      "Only removal of entries whose item directories are deleted may edit registry/registry.json.",
    );
  return hasRemovals;
}

function main() {
  const requestedBase = process.argv[2] ?? "origin/main";
  const base = git("merge-base", requestedBase, "HEAD").trim();
  const paths = git("diff", "--name-only", "-z", base, "HEAD").split("\0").filter(Boolean);
  if (!paths.some((path) => ITEM_FILE.test(path))) return;
  const removalOnly = checkIndexRemovals(base, paths.includes(INDEX));
  const outputs = committedCatalogOutputs(paths, removalOnly);
  if (outputs.length > 0)
    throw new Error(
      `Catalog PRs commit item sources only, with a removal-only index exception for deleted items. Restore these generated files:\n${outputs.join("\n")}`,
    );
  console.log("Catalog source PR contains only item sources and any required index removals.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
