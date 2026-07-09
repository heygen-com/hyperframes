import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { classifyGsapScript } from "./classifier.ts";
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

function assertManualUnchangedFixture(name: string, expectedCodes: string[]): void {
  const before = fixture(name);
  const result = transformHtml(before);

  assert.equal(result.classification.status, "manual");
  for (const code of expectedCodes) assert.ok(reasonCodes(result).includes(code));
  assert.equal(result.changed, false);
  assert.equal(result.html, before);
}

function assertConvertedIdempotentFixture(name: string): void {
  const html = fixture(name);
  const result = transformHtml(html);

  assert.equal(result.classification.status, "converted");
  assert.equal(result.changed, false);
  assert.equal(result.html, html);
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

  it("converts forEach over a named const array of selectors", () => {
    const result = transformHtml(fixture("foreach-named-const-array.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("foreach-named-const-array.after.html"));
  });

  it("converts direct window.__timelines member registration through a synthetic timeline id", () => {
    const result = transformHtml(fixture("direct-registration.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("direct-registration.after.html"));
  });

  it("keeps env-conditional direct registration with a WebGL update timeline manual", () => {
    assertManualUnchangedFixture("direct-registration-webgl-manual.before.html", [
      "computed-timeline",
    ]);
  });

  it("converts empty timeline calls into no-op anime anchors", () => {
    const result = transformHtml(fixture("call-label.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("call-label.after.html"));
  });

  it("keeps timeline calls with side effects manual", () => {
    assertManualUnchangedFixture("call-side-effect-manual.before.html", ["computed-timeline"]);
  });

  it("keeps zero-animation parses manual when raw source appears to contain tweens", () => {
    const result = classifyGsapScript(
      `const tl = gsap.timeline({ paused: true });
       tl.to("#box", { opacity: 1 }, 0);
       window.__timelines = window.__timelines || {};
       window.__timelines["main"] = tl;`,
      {
        animations: [],
        timelineVar: "tl",
        preamble: "",
        postamble: `window.__timelines = window.__timelines || {};
          window.__timelines["main"] = tl;`,
      },
    );

    assert.equal(result.status, "manual");
    assert.ok(result.reasons.some((reason) => reason.code === "computed-timeline"));
  });

  it("scopes callback and delay scans to GSAP tween arguments", () => {
    const result = transformHtml(fixture("unrelated-callback-config.before.html"));

    assert.equal(result.classification.status, "converted");
    assert.equal(result.html, fixture("unrelated-callback-config.after.html"));
  });

  it("classifies motionPath as manual and leaves the file unchanged", () => {
    assertManualUnchangedFixture("motionpath-manual.before.html", ["motionPath"]);
  });

  it("classifies a mixed convertible and SplitText script as manual as a whole", () => {
    assertManualUnchangedFixture("splittext-manual.before.html", ["splitText"]);
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
    assertConvertedIdempotentFixture("simple-to.after.html");
  });

  it("is idempotent on already-converted anime code with no-op anchors", () => {
    assertConvertedIdempotentFixture("call-label.after.html");
  });
});
