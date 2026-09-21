// Fails when the committed docs/public/catalog, which the docs build serves as-is, differs from generator output.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsCommand } from "./entrypoint.ts";
import { discoverItems, primarySource } from "./generate-catalog-pages.ts";

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

/** One item's stale-codeLines message, or null when there's nothing to compare (no source file,
 * no committed page, or a page with no code fence). */
function codeLinesMismatch(
  item: ReturnType<typeof discoverItems>[number],
  committedCatalogDir: string,
): string | null {
  const file = primarySource(item.kind, item.manifest);
  if (!file) return null;
  const dir = item.kind === "block" ? "blocks" : "components";
  const pagePath = join(committedCatalogDir, dir, `${item.manifest.name}.mdx`);
  if (!existsSync(pagePath)) return null; // an absent page is treeDifferences' job, not this one's
  const match = readFileSync(pagePath, "utf-8").match(/"codeLines":(\d+)/);
  if (!match || !match[1]) return null; // page has no code fence, nothing to compare
  const committed = Number(match[1]);
  const real = file.source.split("\n").length;
  if (committed === real) return null;
  return `stale codeLines: catalog/${dir}/${item.manifest.name}.mdx says ${committed}, source is ${real} lines`;
}

export function codeLinesDrift(committedCatalogDir: string): string[] {
  return discoverItems()
    .map((item) => codeLinesMismatch(item, committedCatalogDir))
    .filter((line) => line !== null);
}

function generateInto(outRoot: string): number {
  const run = spawnSync("npx", ["tsx", "scripts/generate-catalog-payloads.ts"], {
    cwd: repoRoot,
    env: { ...process.env, CATALOG_PAYLOAD_ROOT: outRoot },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return run.status ?? 1;
}

/** A tree as `git` holds it, so a file the working tree has but a .gitignore rule keeps out cannot hide drift. */
function extractCommitted(gitPath: string, into: string): string {
  const archive = spawnSync("git", ["archive", "HEAD", gitPath], {
    cwd: repoRoot,
    maxBuffer: 2 ** 31 - 1,
  });
  if (archive.status !== 0) throw new Error(`git archive of ${gitPath} failed.`);
  mkdirSync(into, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", into], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`could not unpack the committed ${gitPath}.`);
  return join(into, gitPath);
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "catalog-drift-"));
  const outRoot = join(base, "generated");
  try {
    if (generateInto(outRoot) !== 0) throw new Error("The catalog payload generator failed.");
    const committedPayloadRoot = extractCommitted(
      "docs/public/catalog",
      join(base, "committed-payload"),
    );
    const differences = treeDifferences(outRoot, committedPayloadRoot);
    const committedCatalogDir = extractCommitted("docs/catalog", join(base, "committed-catalog"));
    const staleCodeLines = codeLinesDrift(committedCatalogDir);
    if (differences.length === 0 && staleCodeLines.length === 0) {
      return console.log("docs/public/catalog and every page's codeLines match the generator.");
    }
    const sections = [
      {
        items: differences,
        header: (n: number) => `docs/public/catalog differs from the generator in ${n} file(s):`,
        regenCmd:
          "Regenerate with `tsx scripts/generate-catalog-payloads.ts` and commit the result.",
      },
      {
        items: staleCodeLines,
        header: (n: number) => `${n} page(s) have a stale codeLines:`,
        regenCmd: "Regenerate with `tsx scripts/generate-catalog-pages.ts` and commit the result.",
      },
    ];
    const lines = sections.flatMap(({ items, header, regenCmd }) =>
      items.length === 0
        ? []
        : [
            header(items.length),
            ...items.slice(0, MAX_LISTED).map((line) => `  ${line}`),
            regenCmd,
          ],
    );
    throw new Error(lines.join("\n"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

runAsCommand(import.meta.url, main);
