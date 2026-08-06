import { describe, it, expect } from "vitest";

import { createHeadlessAdapter } from "./headless.js";

describe("createHeadlessAdapter", () => {
  it("is never provably empty", () => {
    // An adapter with no surface cannot establish that a point is free of ink. Answering
    // true would tell a host it is safe to click through a composition nobody can see.
    expect(createHeadlessAdapter().isProvablyEmptyAt?.(10, 10)).toBe(false);
    expect(createHeadlessAdapter().elementAtPoint(10, 10)).toBeNull();
  });
});
