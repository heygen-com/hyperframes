import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repoRoot = resolve(import.meta.dirname, "..");
const PAYLOAD = /<div[^>]*data-hf-primitive-data[^>]*>([\s\S]*?)<\/div>/g;

describe("registry primitive payloads", () => {
  it("stay parseable JSON in the shipped source", () => {
    const files = globSync("registry/**/*.html", { cwd: repoRoot });
    const broken: string[] = [];
    for (const file of files) {
      const html = readFileSync(resolve(repoRoot, file), "utf-8");
      for (const [, payload] of html.matchAll(PAYLOAD)) {
        try {
          JSON.parse(payload);
        } catch (error) {
          // A line wrap inside a JSON string literal is the way this breaks:
          // the file still looks fine, and the composition dies at JSON.parse
          // in the browser, after the preview has already been captured.
          broken.push(`${file}: ${(error as Error).message}`);
        }
      }
    }
    assert.deepEqual(broken, []);
  });
});
