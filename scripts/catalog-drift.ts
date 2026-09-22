// Fails when the committed docs/public/catalog, which the docs build serves as-is, differs from generator output.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsCommand } from "./entrypoint.ts";

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
function extractCommittedCatalog(into: string): string {
  const archive = spawnSync("git", ["archive", "HEAD", "docs/public/catalog"], {
    cwd: repoRoot,
    maxBuffer: 2 ** 31 - 1,
  });
  if (archive.status !== 0) throw new Error("git archive of docs/public/catalog failed.");
  mkdirSync(into, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", into], { input: archive.stdout });
  if (untar.status !== 0) throw new Error("could not unpack the committed catalog.");
  return join(into, "docs/public/catalog");
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "catalog-drift-"));
  const outRoot = join(base, "generated");
  try {
    if (generateInto(outRoot) !== 0) throw new Error("The catalog payload generator failed.");
    const committedRoot = extractCommittedCatalog(join(base, "committed"));
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
