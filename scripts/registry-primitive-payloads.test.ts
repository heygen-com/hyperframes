import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repoRoot = resolve(import.meta.dirname, "..");
// Any element, not just the <div> this started as: a payload that moved to a
// <script type="application/json"> to survive the formatter must stay guarded.
const PAYLOAD = /<(\w+)[^>]*\sdata-hf-primitive-data[^>]*>([\s\S]*?)<\/\1>/g;

describe("registry primitive payloads", () => {
  it("stay parseable JSON in the shipped source", () => {
    const files = globSync("registry/**/*.html", { cwd: repoRoot });
    const broken: string[] = [];
    for (const file of files) {
      const html = readFileSync(resolve(repoRoot, file), "utf-8");
      for (const match of html.matchAll(PAYLOAD)) {
        const payload = match[2] ?? "";
        try {
          // Same normalization the compositions apply: this is inert text in
          // HTML, so the formatter may reflow it, and whitespace is not
          // significant. A payload that fails even after this is genuinely
          // malformed rather than merely wrapped.
          JSON.parse(payload.replace(/\s*[\r\n]+\s*/g, " "));
        } catch (error) {
          broken.push(`${file}: ${(error as Error).message}`);
        }
      }
    }
    assert.deepEqual(broken, []);
  });
});
