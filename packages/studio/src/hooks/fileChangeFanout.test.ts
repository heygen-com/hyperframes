import { describe, expect, it, vi } from "vitest";
import { announceExternalFileChange, onExternalFileChange } from "./fileChangeFanout";

describe("fileChangeFanout", () => {
  it("hands every announced change to each listener until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onExternalFileChange(first);
    const stopSecond = onExternalFileChange(second);
    announceExternalFileChange({ path: "boards/storyboard.html" });
    stopFirst();
    announceExternalFileChange({ path: "index.html" });
    stopSecond();
    expect(first.mock.calls).toEqual([[{ path: "boards/storyboard.html" }]]);
    expect(second.mock.calls).toEqual([
      [{ path: "boards/storyboard.html" }],
      [{ path: "index.html" }],
    ]);
  });
});
