import { describe, it, expect } from "vitest";
import { CodeMorpher } from "./codeMorpher";

describe("CodeMorpher", () => {
  it("diffs correctly", () => {
    const oldCode = "line 1\nline 2\nline 3";
    const newCode = "line 1\nline 2a\nline 3";

    const result = CodeMorpher.diff(oldCode, newCode);

    expect(result).toEqual([
      { text: "line 1", type: "unchanged" },
      { text: "line 2a", type: "added" },
      { text: "line 2", type: "removed" },
      { text: "line 3", type: "unchanged" },
    ]);
  });
});
