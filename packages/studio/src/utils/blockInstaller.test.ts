// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { addBlockToProject } from "./blockInstaller";
import { parseCompositionSource } from "../player/lib/timelineElementHelpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const componentPath = "compositions/camcorder-hud.html";
const targetPath = "compositions/scene.html";

async function installHud(
  targetSource: string,
  placement: { start: number; duration: number; track: number },
) {
  const files = new Map([
    [
      componentPath,
      `<body><div data-composition-id="camcorder-hud"><div class="hud"></div></div></body>`,
    ],
    [targetPath, targetSource],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: [componentPath],
        block: {
          name: "camcorder-hud",
          title: "Camcorder HUD",
          description: "HUD",
          type: "hyperframes:block",
          files: [],
          dimensions: { width: 1920, height: 1080 },
          duration: 4,
        },
      }),
    }),
  );
  const writeProjectFile = vi.fn(async (path: string, content: string) => {
    files.set(path, content);
  });

  const result = await addBlockToProject({
    projectId: "project",
    blockName: "camcorder-hud",
    activeCompPath: targetPath,
    placement,
    timelineElements: [],
    readProjectFile: async (path) => files.get(path) ?? "",
    writeProjectFile,
    recordEdit: vi.fn().mockResolvedValue(undefined),
    refreshFileTree: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    showToast: vi.fn(),
  });
  return { result, source: files.get(targetPath) };
}

describe("addBlockToProject", () => {
  it("uses an explicit selected-media duration and track for a Registry overlay block", async () => {
    const { result, source } = await installHud(
      `<main data-composition-id="scene" data-duration="10" data-width="1920" data-height="1080"></main>`,
      { start: 2.5, duration: 4.25, track: 3 },
    );

    expect(result?.block.name).toBe("camcorder-hud");
    expect(source).toContain('data-composition-src="compositions/camcorder-hud.html"');
    expect(source).toContain('data-start="2.5"');
    expect(source).toContain('data-duration="4.25"');
    expect(source).toContain('data-track-index="3"');
    // hostKey addresses the new element the same way the timeline selects
    // clips (sourceFile#domId), so the caller can select and reveal it.
    expect(result?.hostKey).toBe("compositions/scene.html#camcorder-hud");
    expect(source).toContain('id="camcorder-hud"');
  });

  it("installs into a registry scene's root inside the template its <html> wraps", async () => {
    const { source } = await installHud(
      `<html data-composition-id="scene"><body><template><div data-composition-id="scene" data-duration="2"></div></template></body></html>`,
      { start: 0, duration: 4, track: 1 },
    );

    const root = parseCompositionSource(source ?? "").querySelector("[data-composition-id]");
    expect(root?.querySelector(`[data-composition-src="${componentPath}"]`)).not.toBeNull();
    expect(root?.getAttribute("data-duration")).toBe("4");
  });
});
