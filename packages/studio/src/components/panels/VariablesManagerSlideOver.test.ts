/**
 * resolveManagerOverridePath: decides whether the Variables manager opens a
 * dedicated session for a targeted sub-composition file (bound-chip open) or
 * reuses the host session (header trigger / same-file target).
 */

import { describe, it, expect } from "vitest";
import { resolveManagerOverridePath } from "./VariablesManagerSlideOver";

describe("resolveManagerOverridePath", () => {
  it("returns null when the manager is closed", () => {
    expect(resolveManagerOverridePath(false, "frames/card.html", "index.html")).toBeNull();
  });

  it("returns null when there is no target (header trigger)", () => {
    expect(resolveManagerOverridePath(true, null, "index.html")).toBeNull();
  });

  it("returns null when the target is the active composition", () => {
    expect(resolveManagerOverridePath(true, "index.html", "index.html")).toBeNull();
  });

  it("returns the target file when it differs from the active composition", () => {
    expect(resolveManagerOverridePath(true, "frames/card.html", "index.html")).toBe(
      "frames/card.html",
    );
  });

  it("overrides even when there is no active composition (master view)", () => {
    expect(resolveManagerOverridePath(true, "frames/card.html", null)).toBe("frames/card.html");
  });
});
