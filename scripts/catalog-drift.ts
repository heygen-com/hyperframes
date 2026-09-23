// Fails when the committed docs/public/catalog, which the docs build serves as-is, differs from generator output.
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsCommand } from "./entrypoint.ts";
import { generateCatalog, GENERATED_CATALOG_PATHS } from "./generate-catalog.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LISTED = 40;

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

/** One line per file that is missing, extra or different between the generated and committed trees. */
export function treeDifferences(generatedRoot: string, committedRoot: string): string[] {
  const generated = new Set(filesUnder(generatedRoot));
  const committed = new Set(filesUnder(committedRoot));
  const missing = [...generated].filter((file) => !committed.has(file));
  const extra = [...committed].filter((file) => !generated.has(file));
  const changed = [...generated].filter(
    (file) =>
      committed.has(file) &&
      !readFileSync(join(generatedRoot, file)).equals(readFileSync(join(committedRoot, file))),
  );
  return [
    ...missing.map((file) => `not committed: ${file}`),
    ...extra.map((file) => `no longer generated: ${file}`),
    ...changed.map((file) => `stale: ${file}`),
  ];
}

function generateInto(outRoot: string): number {
  const run = spawnSync("npx", ["tsx", "scripts/generate-catalog-payloads.ts"], {
    cwd: repoRoot,
    env: { ...process.env, CATALOG_PAYLOAD_ROOT: outRoot },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return run.status ?? 1;
}

/** The catalog as `git` holds it, so a file the working tree has but a .gitignore rule keeps out cannot hide drift. */
function extractCommittedTree(into: string, paths: readonly string[], root = repoRoot): void {
  mkdirSync(into, { recursive: true });
  const tracked = execFileSync("git", ["ls-tree", "--name-only", "HEAD", "--", ...paths], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (tracked.length === 0) return;
  const archive = spawnSync("git", ["archive", "HEAD", ...tracked], {
    cwd: root,
    maxBuffer: 2 ** 31 - 1,
  });
  if (archive.status !== 0) throw new Error(`git archive failed for ${paths.join(", ")}.`);
  mkdirSync(into, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", into], { input: archive.stdout });
  if (untar.status !== 0) throw new Error("could not unpack the committed catalog.");
}

function copyPaths(from: string, into: string, paths: readonly string[]): void {
  mkdirSync(into, { recursive: true });
  for (const path of paths) {
    if (!existsSync(join(from, path))) continue;
    mkdirSync(dirname(join(into, path)), { recursive: true });
    cpSync(join(from, path), join(into, path), { recursive: true });
  }
}

export function generatedCatalogDifferences(root = repoRoot): string[] {
  const base = mkdtempSync(join(tmpdir(), "generated-catalog-drift-"));
  try {
    const generated = join(base, "generated");
    copyPaths(root, generated, [
      "registry",
      "docs/docs.json",
      "docs/catalog/blocks",
      "docs/catalog/components",
      "docs/public/catalog",
    ]);
    mkdirSync(join(generated, "docs/snippets"), { recursive: true });
    generateCatalog(generated);
    const actual = join(base, "actual");
    extractCommittedTree(actual, GENERATED_CATALOG_PATHS, root);
    const expected = join(base, "expected");
    copyPaths(generated, expected, GENERATED_CATALOG_PATHS);
    return treeDifferences(expected, actual);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const catalogDrift = generatedCatalogDifferences();
  if (catalogDrift.length > 0) {
    throw new Error(
      `Generated catalog differs in ${catalogDrift.length} file(s):\n${catalogDrift.slice(0, MAX_LISTED).join("\n")}\nRun \`bun run generate:catalog\` and commit the result.`,
    );
  }
  const base = mkdtempSync(join(tmpdir(), "catalog-drift-"));
  const outRoot = join(base, "generated");
  try {
    if (generateInto(outRoot) !== 0) throw new Error("The catalog payload generator failed.");
    const committed = join(base, "committed");
    extractCommittedTree(committed, ["docs/public/catalog"]);
    const committedRoot = join(committed, "docs/public/catalog");
    const differences = treeDifferences(outRoot, committedRoot);
    if (differences.length === 0) return console.log("docs/public/catalog matches the generator.");
    const listed = differences.slice(0, MAX_LISTED).map((line) => `  ${line}`);
    throw new Error(
      `docs/public/catalog differs from the generator in ${differences.length} file(s):\n${listed.join("\n")}\nRegenerate with \`tsx scripts/generate-catalog-payloads.ts\` and commit the result.`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

runAsCommand(import.meta.url, main);
