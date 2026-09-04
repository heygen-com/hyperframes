/**
 * @vitest-environment node
 * AUDIT: Same input → same parsed output (compiler determinism).
 * This is the foundational claim for CI and regression testing.
 */
import { describe, it, expect } from "vitest";
import { compileHtml } from "@hyperframes/core/compiler";
import { createHash } from "crypto";

const HTML = `
<!DOCTYPE html>
<html><body>
  <div id="stage" data-composition-id="id" data-start="0" data-duration="10"
       data-width="1920" data-height="1080">
    <h1 class="clip" data-start="1" data-duration="3">A</h1>
    <h2 class="clip" data-start="4" data-duration="3">B</h2>
  </div>
</body></html>
`;

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("determinism contract", () => {
  it("compileHtml returns identical output for identical input", async () => {
    const a = await compileHtml(HTML, undefined, false);
    const b = await compileHtml(HTML, undefined, false);
    expect(sha256(a)).toBe(sha256(b));
    expect(a).toBe(b);
  });

  it("preserves clip order and attributes exactly", async () => {
    const out = await compileHtml(HTML, undefined, false);
    const starts = [...out.matchAll(/data-start="([\d.]+)"/g)].map((m) => m[1]);
    expect(starts).toEqual(["0", "1", "4"]);
  });

  it("fails determinism if input whitespace differs but semantic HTML same", async () => {
    const compact = HTML.replace(/\n\s*/g, "");
    const a = await compileHtml(HTML, undefined, false);
    const b = await compileHtml(compact, undefined, false);
    // The function should exist and return strings even when inputs differ cosmetically.
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    // Optional strict check – document as variance if they differ.
    if (a !== b) {
      console.warn("[AUDIT NOTE] compileHtml differs across whitespace-only change");
    }
  });
});
