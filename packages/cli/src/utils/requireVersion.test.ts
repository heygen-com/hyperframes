import { describe, expect, it } from "vitest";
import { UNRESOLVED_VERSION } from "@hyperframes/engine";
import { checkRequiredVersion } from "./requireVersion.js";

describe("checkRequiredVersion", () => {
  it("passes when the running renderer is exactly the required version", () => {
    expect(checkRequiredVersion("0.8.72", "0.8.72")).toBeNull();
  });

  it("tolerates surrounding whitespace in the flag value", () => {
    expect(checkRequiredVersion("  0.8.72  ", "0.8.72")).toBeNull();
  });

  it("refuses a mismatch and names both versions", () => {
    const msg = checkRequiredVersion("0.8.72", "0.8.71");
    expect(msg).toContain("0.8.72");
    expect(msg).toContain("0.8.71");
  });

  // The load-bearing case. An unresolved version means nothing here can say
  // which renderer ran, so passing would hand back exactly the unfalsifiable
  // claim the flag exists to remove -- and it would do it while looking green.
  it("FAILS CLOSED when the build cannot resolve its own version", () => {
    const msg = checkRequiredVersion("0.8.72", UNRESOLVED_VERSION);
    expect(msg).not.toBeNull();
    expect(msg).toContain("cannot be checked");
  });

  // Never range semantics: npm already gives the caller ranges. This answers
  // "did the version I named run", and a caret would let it pass on one the
  // caller never named.
  it("is exact, not a range: a newer patch does not satisfy the requirement", () => {
    expect(checkRequiredVersion("0.8.72", "0.8.73")).not.toBeNull();
    expect(checkRequiredVersion("0.8.72", "0.8.720")).not.toBeNull();
    expect(checkRequiredVersion("0.8.7", "0.8.72")).not.toBeNull();
  });

  it("refuses an empty value rather than passing vacuously", () => {
    expect(checkRequiredVersion("", "0.8.72")).toContain("needs a version");
    expect(checkRequiredVersion("   ", "0.8.72")).toContain("needs a version");
  });

  // The sentinel must not be satisfiable by asking for it by name: that would
  // be a gate that passes precisely when the version is unknown.
  it("does not let the caller require the sentinel itself", () => {
    expect(checkRequiredVersion(UNRESOLVED_VERSION, UNRESOLVED_VERSION)).not.toBeNull();
  });
});
