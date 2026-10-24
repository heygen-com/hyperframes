import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

const ROOT = join(import.meta.dirname, "..");

// A file URL's pathname is "/D:/a/x" on Windows, which opens "D:\D:\a\x".
it("package code turns file URLs into paths with fileURLToPath, not .pathname", () => {
  const files = execFileSync("git", ["ls-files", "packages/*.mjs", "packages/*.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && !/\.test\.|\/tests?\//.test(file));
  const offenders = files.filter((file) =>
    /import\.meta\.url\)\.pathname/.test(readFileSync(join(ROOT, file), "utf8")),
  );
  assert.deepEqual(offenders, []);
});
