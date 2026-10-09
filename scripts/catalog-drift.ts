// Source PRs validate generated output; the publish PR also checks its committed snapshot.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCatalog } from "./generate-catalog.ts";
import { GENERATED_CATALOG_PATHS } from "./catalog-generated-paths.mjs";
import { runAsCommand } from "./entrypoint.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LISTED = 40;
// The embedding model's float output differs slightly between CPUs, so vectors are compared by direction, not bytes.
const VECTORS = /-vectors\.bin$/;
const MIN_ROW_COSINE = 0.99;

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
    (file) => committed.has(file) && !sameContent(generatedRoot, committedRoot, file),
  );
  return [
    ...missing.map((file) => `not committed: ${file}`),
    ...extra.map((file) => `no longer generated: ${file}`),
    ...changed.map((file) => `stale: ${file}`),
  ];
}

function sameContent(generatedRoot: string, committedRoot: string, file: string): boolean {
  const generated = readFileSync(join(generatedRoot, file));
  const committed = readFileSync(join(committedRoot, file));
  if (generated.equals(committed)) return true;
  if (!VECTORS.test(file)) return false;
  const meta = join(generatedRoot, file.replace(/\.bin$/, ".json"));
  const { dimensions } = JSON.parse(readFileSync(meta, "utf8")) as { dimensions: number };
  return vectorsAgree(generated, committed, dimensions);
}

/** Same row count, and every row of Float32 vectors points the same way within MIN_ROW_COSINE. */
export function vectorsAgree(a: Buffer, b: Buffer, dimensions: number): boolean {
  const rowBytes = 4 * dimensions;
  if (a.length !== b.length || a.length % rowBytes !== 0) return false;
  return Array.from({ length: a.length / rowBytes }, (_, row) =>
    rowCosine(a, b, row * rowBytes, (row + 1) * rowBytes),
  ).every((cosine) => cosine >= MIN_ROW_COSINE);
}

function rowCosine(a: Buffer, b: Buffer, start: number, end: number): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = start; i < end; i += 4) {
    const x = a.readFloatLE(i);
    const y = b.readFloatLE(i);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return dot / Math.sqrt(normA * normB);
}

async function main(): Promise<void> {
  await generateCatalog();
  for (const script of [
    "scripts/check-docs-catalog.mjs",
    "scripts/catalog/check-artifact-coverage.ts",
  ])
    execFileSync("bun", [script], { cwd: repoRoot, stdio: "inherit" });
  if (process.argv.includes("--committed")) checkCommittedCatalog();
  else
    console.log("Catalog sources generate successfully; derived files belong to the publish PR.");
}

function checkCommittedCatalog(): void {
  const base = mkdtempSync(join(tmpdir(), "catalog-drift-"));
  try {
    const committed = join(base, "committed");
    const generated = join(base, "generated");
    mkdirSync(committed);
    mkdirSync(generated);
    const archive = execFileSync("git", ["archive", "HEAD", ...GENERATED_CATALOG_PATHS], {
      cwd: repoRoot,
      maxBuffer: 2 ** 31 - 1,
    });
    execFileSync("tar", ["-x", "-C", committed], { input: archive });
    for (const path of GENERATED_CATALOG_PATHS) {
      mkdirSync(dirname(join(generated, path)), { recursive: true });
      cpSync(join(repoRoot, path), join(generated, path), { recursive: true });
    }
    const differences = treeDifferences(generated, committed);
    if (differences.length > 0)
      throw new Error(
        `Published catalog differs from generation:\n${differences.slice(0, MAX_LISTED).join("\n")}`,
      );
    console.log("Committed catalog matches generation.");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

runAsCommand(import.meta.url, main);
