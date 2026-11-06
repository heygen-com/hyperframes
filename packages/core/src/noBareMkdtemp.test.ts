import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = /\.(ts|mjs)$/;
const NOT_SOURCE = /\.(test|fixture)\.|[\\/](tests?|node_modules|dist)[\\/]/;
const MKDTEMP = /\bmkdtemp(Sync)?\(/;

// Not beside a project or output path: a system temp root, a standalone skill script, a cloud function's scratch root.
const ALLOWED = new Set([
  "cli/src/media-use/lib/lut-preset-provider.mjs",
  "producer/src/server.ts",
  "producer/src/regression-harness.ts",
  "aws-lambda/src/s3PlanV2Publisher.ts",
  "gcp-cloud-run/src/gcsPlanV2Publisher.ts",
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (NOT_SOURCE.test(path)) return [];
    return statSync(path).isDirectory() ? sources(path) : SOURCE.test(name) ? [path] : [];
  });
}

it("no package makes a staging folder beside a project path with mkdtemp, which fails past 260 characters on Windows", () => {
  const offenders = readdirSync(packagesDir).flatMap((pkg) => {
    const src = join(packagesDir, pkg, "src");
    try {
      statSync(src);
    } catch {
      return [];
    }
    return sources(src).flatMap((file) => {
      const rel = relative(packagesDir, file).split("\\").join("/");
      if (ALLOWED.has(rel)) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          MKDTEMP.test(line) && !/tmpdir|^\s*(\/\/|\*)/.test(line) ? [`${rel}:${i + 1}`] : [],
        );
    });
  });
  expect(offenders, "use createStagingDir from @hyperframes/core/atomic-file").toEqual([]);
});
