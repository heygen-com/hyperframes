import { describe, expect, it } from "vitest";
import { createAutomationGestureKeys } from "./automationGestureKeys";

const keys = () => {
  let n = 0;
  return createAutomationGestureKeys(() => `g${++n}`);
};

describe("createAutomationGestureKeys", () => {
  it("holds one key across every move of a drag", () => {
    // Each move persists; history merges same-key entries inside 300ms. Separate
    // keys, or a window that can expire mid-drag, is what made undo take back a
    // fragment of the move instead of the move.
    const g = keys();
    expect([g.live().key, g.live().key, g.live().key]).toEqual(["g1", "g1", "g1"]);
  });

  it("never lets the window expire", () => {
    expect(keys().live().ms).toBe(Number.POSITIVE_INFINITY);
    expect(keys().commit().ms).toBe(Number.POSITIVE_INFINITY);
  });

  it("ends the gesture on the release, under the same key", () => {
    const g = keys();
    g.live();
    expect(g.commit().key).toBe("g1");
  });

  it("starts a fresh key for the next drag", () => {
    const g = keys();
    g.live();
    g.commit();
    expect(g.live().key).toBe("g2");
  });

  it("gives a standalone commit its own key", () => {
    // Deleting a range, pasting one, typing a value: one write, one step each.
    const g = keys();
    expect(g.commit().key).toBe("g1");
    expect(g.commit().key).toBe("g2");
  });

  it("does not join a commit to a gesture that already ended", () => {
    const g = keys();
    g.live();
    g.commit();
    expect(g.commit().key).toBe("g2");
  });
});
