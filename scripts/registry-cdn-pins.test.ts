import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Registry items load npm packages from a CDN only at an exact version, so the bytes cannot change under them. */
const ROOT = resolve(import.meta.dirname, "..");
const NPM_CDN =
  /(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/((?:@[^/@"'`\s]+\/)?[^/@"'`\s)]+)(@[^/"'`\s)]*)?/g;
const EXACT = /^@\d+\.\d+\.\d+(?:-[\w.]+)?$/;

function floatingCdnReferences(text: string): string[] {
  return [...text.matchAll(NPM_CDN)]
    .filter((match) => !EXACT.test(match[2] ?? ""))
    .map((match) => match[0]);
}

test("a range, tag or missing version is reported", () => {
  assert.deepEqual(
    floatingCdnReferences(
      `<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
       fetch("https://unpkg.com/us-atlas/states-10m.json");
       import x from "https://cdn.jsdelivr.net/npm/@scope/pkg@latest/+esm";
       <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`,
    ),
    ["cdn.jsdelivr.net/npm/d3@7", "unpkg.com/us-atlas", "cdn.jsdelivr.net/npm/@scope/pkg@latest"],
  );
});

test("every npm CDN reference in a registry item names an exact version", () => {
  const files = execFileSync("git", ["ls-files", "-z", "registry"], {
    cwd: ROOT,
    encoding: "utf-8",
  })
    .split("\0")
    .filter((file) => /\.(html|js|mjs|json)$/.test(file));
  const floating = files.flatMap((file) =>
    floatingCdnReferences(readFileSync(join(ROOT, file), "utf-8")).map((ref) => `${file}: ${ref}`),
  );
  assert.deepEqual(floating, []);
});
