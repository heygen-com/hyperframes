import { describe, it, expect } from "vitest";
import { parseStoryboard } from "./parseStoryboard.js";
import { setFrameStatus, setFrameVoiceover } from "./editStoryboard.js";

const DOC = `---
message: Hi
---

## Frame 1 — Hook
- status: outline
- voiceover: "old line"

Hook narrative.

## Frame 2 — Close
- duration: 3s

Close narrative.
`;

describe("setFrameVoiceover / setFrameStatus", () => {
  it("replaces an existing voiceover line in place, leaving other frames untouched", () => {
    const next = setFrameVoiceover(DOC, 1, "new line");
    const parsed = parseStoryboard(next);
    expect(parsed.frames[0].voiceover).toBe("new line");
    expect(parsed.frames[1].duration).toBe("3s");
    expect(next).toContain('- voiceover: "new line"');
  });

  it("matches voiceover aliases (vo)", () => {
    const doc = "## Frame 1\n- vo: original\n\nBody.";
    const next = setFrameVoiceover(doc, 1, "updated");
    // The aliased key is preserved, only the value changes.
    expect(next).toContain("- vo: ");
    expect(parseStoryboard(next).frames[0].voiceover).toBe("updated");
  });

  it("inserts the field after the heading when absent", () => {
    const next = setFrameVoiceover("## Frame 1 — Hook\n\nBody.", 1, "hi");
    const lines = next.split("\n");
    expect(lines[0]).toBe("## Frame 1 — Hook");
    expect(lines[1]).toBe('- voiceover: "hi"');
    expect(parseStoryboard(next).frames[0].voiceover).toBe("hi");
  });

  it("advances status in place", () => {
    const next = setFrameStatus(DOC, 1, "built");
    expect(parseStoryboard(next).frames[0].status).toBe("built");
    expect(parseStoryboard(next).frames[1].status).toBe("outline");
  });

  it("round-trips a voiceover containing double quotes (always wraps)", () => {
    const next = setFrameVoiceover("## Frame 1\n- voiceover: x\n", 1, 'she said "hi"');
    expect(parseStoryboard(next).frames[0].voiceover).toBe('she said "hi"');
  });

  it("round-trips an empty voiceover and a fully-quoted phrase", () => {
    const cleared = setFrameVoiceover("## Frame 1\n- voiceover: x\n", 1, "");
    expect(parseStoryboard(cleared).frames[0].voiceover).toBe("");
    const quoted = setFrameVoiceover("## Frame 1\n- voiceover: x\n", 1, '"hello"');
    expect(parseStoryboard(quoted).frames[0].voiceover).toBe('"hello"');
  });

  it("collapses newlines in a multi-line voiceover to a single line", () => {
    const next = setFrameVoiceover(
      "## Frame 1\n- voiceover: x\n\nNarrative.",
      1,
      "line one\nline two",
    );
    expect(parseStoryboard(next).frames[0].voiceover).toBe("line one line two");
    expect(parseStoryboard(next).frames[0].narrative).toBe("Narrative.");
  });

  it("throws for an out-of-range frame", () => {
    expect(() => setFrameStatus(DOC, 9, "built")).toThrow(/not found/);
  });
});
