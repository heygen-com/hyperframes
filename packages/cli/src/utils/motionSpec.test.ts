import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMotionSpec, parseMotionSpec, readMotionSpec, type MotionSpec } from "./motionSpec.js";

const RFC_SPEC = {
  duration: 6,
  assertions: [
    { kind: "appearsBy", selector: "#headline", bySec: 0.5 },
    { kind: "before", a: "#headline", b: "#cta" },
    { kind: "staysInFrame", selector: ".card" },
    { kind: "keepsMoving", withinSelector: ".scene" },
  ],
};

function expectOk(result: ReturnType<typeof parseMotionSpec>): MotionSpec {
  if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join(", ")}`);
  return result.spec;
}

describe("parseMotionSpec", () => {
  it("parses the RFC four-assertion spec", () => {
    const spec = expectOk(parseMotionSpec(RFC_SPEC));
    expect(spec.duration).toBe(6);
    expect(spec.assertions).toHaveLength(4);
    expect(spec.assertions[0]).toEqual({ kind: "appearsBy", selector: "#headline", bySec: 0.5 });
    expect(spec.assertions[3]).toEqual({ kind: "keepsMoving", withinSelector: ".scene" });
  });

  it("allows a missing duration", () => {
    const spec = expectOk(
      parseMotionSpec({ assertions: [{ kind: "staysInFrame", selector: ".card" }] }),
    );
    expect(spec.duration).toBeUndefined();
  });

  it("rejects an unknown assertion kind", () => {
    const result = parseMotionSpec({ assertions: [{ kind: "onBeat", selector: "#x" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("unknown assertion kind");
  });

  it("reports per-field errors for missing required fields", () => {
    const result = parseMotionSpec({
      assertions: [
        { kind: "appearsBy", selector: "#h" },
        { kind: "before", a: "#a" },
        { kind: "staysInFrame" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toContain("bySec");
      expect(result.errors[1]).toContain('"b"');
      expect(result.errors[2]).toContain("selector");
    }
  });

  it("rejects a non-object spec and an empty assertion list", () => {
    expect(parseMotionSpec(42).ok).toBe(false);
    expect(parseMotionSpec({ assertions: [] }).ok).toBe(false);
    expect(parseMotionSpec({}).ok).toBe(false);
  });

  it("rejects a non-positive maxStaticSec", () => {
    const result = parseMotionSpec({
      assertions: [{ kind: "keepsMoving", maxStaticSec: 0 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unsupported spec version", () => {
    const result = parseMotionSpec({
      version: 2,
      assertions: [{ kind: "staysInFrame", selector: ".card" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("version");
  });

  it("rejects NaN as duration", () => {
    const result = parseMotionSpec({
      duration: NaN,
      assertions: [{ kind: "staysInFrame", selector: ".card" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("duration");
  });

  it('rejects "*" as withinSelector', () => {
    const result = parseMotionSpec({
      assertions: [{ kind: "keepsMoving", withinSelector: "*" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('"*"');
  });
});

describe("findMotionSpec", () => {
  it("returns null when no sidecar is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-none-"));
    writeFileSync(join(dir, "main.html"), "<div></div>");
    expect(findMotionSpec(dir)).toBeNull();
  });

  it("finds the single sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-one-"));
    writeFileSync(join(dir, "anything.motion.json"), "{}");
    expect(findMotionSpec(dir)).toBe(join(dir, "anything.motion.json"));
  });

  it("prefers the sidecar matching a composition html basename", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-many-"));
    writeFileSync(join(dir, "aaa.motion.json"), "{}");
    writeFileSync(join(dir, "main.motion.json"), "{}");
    writeFileSync(join(dir, "main.html"), "<div></div>");
    expect(findMotionSpec(dir)).toBe(join(dir, "main.motion.json"));
  });

  it("throws when multiple sidecars each match a different composition", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-ambig-"));
    writeFileSync(join(dir, "hero.motion.json"), "{}");
    writeFileSync(join(dir, "landing.motion.json"), "{}");
    writeFileSync(join(dir, "hero.html"), "<div></div>");
    writeFileSync(join(dir, "landing.html"), "<div></div>");
    expect(() => findMotionSpec(dir)).toThrow("ambiguous motion sidecars");
  });
});

describe("readMotionSpec", () => {
  it("returns error for a nonexistent file", () => {
    const result = readMotionSpec("/tmp/__nonexistent_motion_spec__.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("could not read");
  });

  it("returns error for a file with invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-bad-"));
    const path = join(dir, "bad.motion.json");
    writeFileSync(path, "not json {{");
    const result = readMotionSpec(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("could not read");
  });

  it("returns error for a file with a valid JSON but invalid spec", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-invalid-"));
    const path = join(dir, "invalid.motion.json");
    writeFileSync(path, JSON.stringify({ assertions: [] }));
    const result = readMotionSpec(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("no assertions");
  });

  it("parses a valid sidecar file", () => {
    const dir = mkdtempSync(join(tmpdir(), "motion-valid-"));
    const path = join(dir, "main.motion.json");
    writeFileSync(
      path,
      JSON.stringify({ assertions: [{ kind: "staysInFrame", selector: ".card" }] }),
    );
    const result = readMotionSpec(path);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.assertions).toHaveLength(1);
  });
});
