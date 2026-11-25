import { describe, expect, it, vi } from "vitest";
import { applyColorGradingScopeUpdate } from "./studioColorGradingScope";

function project(files: Record<string, string>) {
  const showToast = vi.fn();
  return {
    files,
    showToast,
    options: {
      selectedSourceFile: "index.html",
      compositionPaths: Object.keys(files),
      projectId: "p",
      waitForPendingDomEditSaves: async () => {},
      readProjectFile: async (path: string) => files[path] ?? "",
      writeProjectFile: async (path: string, content: string) => {
        files[path] = content;
      },
      recordEdit: async () => {},
      reloadPreview: () => {},
      showToast,
    },
  };
}

describe("applyColorGradingScopeUpdate", () => {
  it("copies a grading to every composition without its unknown preset or color space", async () => {
    const { files, options } = project({
      "index.html": `<video src="a.mp4"></video>`,
      "compositions/b.html": `<img src="b.png" data-color-grading='{"preset":"clean-studio"}'>`,
    });
    const value = JSON.stringify({
      preset: "made-up$'look",
      colorSpace: "made-up-space",
      adjust: { exposure: 0.2 },
    });
    const result = await applyColorGradingScopeUpdate({ ...options, scope: "project", value });
    expect(result).toEqual({ changedFiles: 2, changedElements: 2 });
    const written = JSON.stringify({ adjust: { exposure: 0.2 } }).replace(/"/g, "&quot;");
    expect(files["index.html"]).toBe(`<video src="a.mp4" data-color-grading="${written}"></video>`);
    expect(files["compositions/b.html"]).toBe(`<img src="b.png" data-color-grading="${written}">`);
    expect(Object.values(files).join("")).not.toContain("made-up");
  });

  it("writes nothing when the value is not a serialized grading", async () => {
    const before = `<video src="a.mp4"></video>`;
    const { files, options, showToast } = project({ "index.html": before });
    await applyColorGradingScopeUpdate({ ...options, scope: "project", value: "not json" });
    expect(files["index.html"]).toBe(before);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("could not be read"), "error");
  });
});
