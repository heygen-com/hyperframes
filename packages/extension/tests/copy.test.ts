import { describe, expect, it, vi } from "vitest";
import { copySelectedText, type ClipboardTextControl } from "../src/clipboard/copy";

describe("copySelectedText", () => {
  it("selects the exact text once and clears the control after the copy command", () => {
    const control: ClipboardTextControl = { value: "", select: vi.fn() };
    const executeCopy = vi.fn(() => {
      expect(control.value).toBe("canonical capture");
      return true;
    });

    expect(copySelectedText("canonical capture", control, executeCopy)).toBe(true);
    expect(control.select).toHaveBeenCalledTimes(1);
    expect(executeCopy).toHaveBeenCalledTimes(1);
    expect(control.value).toBe("");
  });
});
