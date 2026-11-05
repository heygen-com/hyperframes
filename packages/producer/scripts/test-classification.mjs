// fallow-ignore-file complexity
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The tests that need host capabilities such as Chrome, ffmpeg, worker threads or local sockets, one path per
// line, so adding one never edits (or re-pins) the selection logic below.
const INTEGRATION_TEST_FILES = new Set(
  JSON.parse(readFileSync(resolve(PRODUCER_ROOT, "scripts/integration-tests.json"), "utf8")),
);

function collectTestFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) collectTestFiles(entryPath, files);
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(entryPath);
  }
  return files;
}

export function classifyTestSource(filePath, source, integrationFiles = INTEGRATION_TEST_FILES) {
  const importsBun = /\bfrom\s+["']bun:test["']/.test(source);
  const importsVitest = /\bfrom\s+["']vitest["']/.test(source);
  if (importsBun === importsVitest) {
    const detail = importsBun ? "imports both bun:test and vitest" : "imports neither runner";
    throw new Error(`${filePath}: ${detail}`);
  }
  return {
    file: filePath,
    runner: importsBun ? "bun" : "vitest",
    lane: integrationFiles.has(filePath) ? "integration" : "unit",
  };
}

export function discoverProducerTests(producerRoot = PRODUCER_ROOT) {
  const roots = ["src", "tests"].map((directory) => resolve(producerRoot, directory));
  const files = roots
    .flatMap((directory) => collectTestFiles(directory))
    .map((absolutePath) => ({
      absolutePath,
      filePath: relative(producerRoot, absolutePath).replaceAll("\\", "/"),
    }));
  const discoveredFiles = new Set(files.map((test) => test.filePath));
  const staleEntries = [...INTEGRATION_TEST_FILES].filter((file) => !discoveredFiles.has(file));
  if (staleEntries.length > 0) {
    throw new Error(`Integration test manifest contains missing files: ${staleEntries.join(", ")}`);
  }
  return files
    .map(({ absolutePath, filePath }) => {
      return classifyTestSource(filePath, readFileSync(absolutePath, "utf8"));
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function summarizeTests(tests) {
  const summary = {
    total: tests.length,
    unit: { bun: 0, vitest: 0 },
    integration: { bun: 0, vitest: 0 },
  };
  for (const test of tests) summary[test.lane][test.runner] += 1;
  return summary;
}
