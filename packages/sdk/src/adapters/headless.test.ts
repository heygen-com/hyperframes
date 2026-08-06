import { describe, it, expect } from "vitest";

import { createHeadlessAdapter } from "./headless.js";

describe("createHeadlessAdapter", () => {
  it("answers paintsAt with null, not false", () => {
    // The two queries read the same value differently: for elementAtPoint null means
    // "nothing there", for paintsAt it means "not knowable" and callers treat it as
    // painted. Returning false here would tell a host that a composition it cannot
    // see puts down no ink, which is the direction that makes content vanish.
    expect(createHeadlessAdapter().paintsAt?.(10, 10)).toBeNull();
    expect(createHeadlessAdapter().elementAtPoint(10, 10)).toBeNull();
  });
});
