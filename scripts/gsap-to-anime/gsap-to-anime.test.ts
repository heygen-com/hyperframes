import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { transformHtml } from "./index.ts";

const FIXTURES = join(import.meta.dirname, "__fixtures__");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

function reasonCodes(result: ReturnType<typeof transformHtml>): string[] {
  return result.classification.reasons.map((reason) => reason.code);
}

function warningCodes(result: ReturnType<typeof transformHtml>): string[] {
  return result.classification.warnings.map((warning) => warning.code);
}

describe("gsap-to-anime transform", () => {
  it("converts a simple to chain", () => {
    const result = transformHtml(fixture("simple-to.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.changed, true);
    assert.equal(result.html, fixture("simple-to.after.html"));
  });

  it("converts fromTo and set calls", () => {
    const result = transformHtml(fixture("fromto-set.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("fromto-set.after.html"));
  });

  it("uses absolute millisecond positions for labels and relative GSAP positions", () => {
    const result = transformHtml(fixture("positions.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("positions.after.html"));
  });

  it("converts a stagger grid to anime.stagger", () => {
    const result = transformHtml(fixture("stagger-grid.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("stagger-grid.after.html"));
  });

  it("converts supported ease families and warns for expo or steps shim divergence", () => {
    const result = transformHtml(fixture("eases.before.html"));

    assert.equal(result.classification.status, "converted-with-warnings");
    assert.deepEqual(warningCodes(result), ["ease-shim-divergence"]);
    assert.equal(result.html, fixture("eases.after.html"));
  });

  it("converts repeat and yoyo to loop and alternate", () => {
    const result = transformHtml(fixture("repeat-yoyo.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("repeat-yoyo.after.html"));
  });

  it("ignores unrelated .add calls outside the parsed timeline", () => {
    const result = transformHtml(fixture("unrelated-add.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("unrelated-add.after.html"));
  });

  it("passes through arbitrary properties and unwraps GSAP attr wrappers", () => {
    const result = transformHtml(fixture("passthrough-properties.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("passthrough-properties.after.html"));
  });

  it("preserves a trailing IIFE close after timeline registration", () => {
    const result = transformHtml(fixture("iife-postamble.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("iife-postamble.after.html"));
  });

  it("scopes callback and delay scans to GSAP tween arguments", () => {
    const result = transformHtml(fixture("unrelated-callback-config.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("unrelated-callback-config.after.html"));
  });

  it("classifies motionPath as manual and leaves the file unchanged", () => {
    const before = fixture("motionpath-manual.before.html");
    const result = transformHtml(before);

    assert.equal(result.classification.status, "manual");
    assert.deepEqual(reasonCodes(result), ["motionPath"]);
    assert.equal(result.changed, false);
    assert.equal(result.html, before);
  });

  it("classifies a mixed convertible and SplitText script as manual as a whole", () => {
    const before = fixture("splittext-manual.before.html");
    const result = transformHtml(before);

    assert.equal(result.classification.status, "manual");
    assert.deepEqual(reasonCodes(result), ["splitText"]);
    assert.equal(result.changed, false);
    assert.equal(result.html, before);
  });

  it("classifies real tween callbacks as manual", () => {
    const before = fixture("onupdate-manual.before.html");
    const result = transformHtml(before);

    assert.equal(result.classification.status, "manual");
    assert.equal(result.changed, false);
    assert.ok(reasonCodes(result).includes("computed-timeline"));
    assert.ok(reasonCodes(result).includes("non-selector-target"));
    assert.equal(result.html, before);
  });

  it("is idempotent on already-converted anime code", () => {
    const html = fixture("simple-to.after.html");
    const result = transformHtml(html);

    assert.equal(result.classification.status, "converted");
    assert.equal(result.changed, false);
    assert.equal(result.html, html);
  });
});
