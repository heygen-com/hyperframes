// Fails when the committed docs/public/catalog, which the docs build serves as-is, differs from generator output.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
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

async function main(): Promise<void> {
  const outRoot = mkdtempSync(join(tmpdir(), "catalog-drift-"));
  try {
    if (generateInto(outRoot) !== 0) throw new Error("The catalog payload generator failed.");
    const differences = treeDifferences(outRoot, resolve(repoRoot, "docs/public/catalog"));
    if (differences.length === 0) return console.log("docs/public/catalog matches the generator.");
    const listed = differences.slice(0, MAX_LISTED).map((line) => `  ${line}`);
    throw new Error(
      `docs/public/catalog differs from the generator in ${differences.length} file(s):\n${listed.join("\n")}\nRegenerate with \`tsx scripts/generate-catalog-payloads.ts\` and commit the result.`,
    );
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
}

runAsCommand(import.meta.url, main);
