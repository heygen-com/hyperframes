// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./useFileTree", () => ({
  useFileTree: () => ({
    projectDir: "",
    fileTree: [],
    setFileTree: vi.fn(),
    fileTreeLoaded: true,
    refreshFileTree: vi.fn(async () => {}),
    compositions: [],
    assets: [],
    fontAssets: [],
  }),
}));

vi.mock("./useEditorSave", () => ({
  useEditorSave: () => ({
    saveRafRef: { current: null },
    handleContentChange: vi.fn(),
  }),
}));

import { useFileManager } from "./useFileManager";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useFileManager project ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps delayed callbacks bound to the project that created them", async () => {
    let resolveProjectARead: ((value: Response) => void) | undefined;
    const projectARead = new Promise<Response>((resolve) => {
      resolveProjectARead = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("project-a") && !init?.method) return projectARead;
      if (!init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ content: "PROJECT_B" }),
        } as Response);
      }
      return Promise.resolve({ ok: true } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const captured: { manager: ReturnType<typeof useFileManager> | null } = { manager: null };
    function Probe({ projectId }: { projectId: string }) {
      captured.manager = useFileManager({
        projectId,
        showToast: vi.fn(),
        recordEdit: vi.fn(async () => {}),
        domEditSaveTimestampRef: { current: 0 },
        setRefreshKey: vi.fn(),
      });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a/../other?x=1" />));
    const managerA = captured.manager;
    if (!managerA) throw new Error("project A manager did not render");
    const delayedRead = managerA.readProjectFile("index.html");

    await act(async () => root.render(<Probe projectId="project-b#fragment" />));
    const managerB = captured.manager;
    if (!managerB) throw new Error("project B manager did not render");
    expect(managerB.writeProjectFile).not.toBe(managerA.writeProjectFile);

    resolveProjectARead?.({
      ok: true,
      json: async () => ({ content: "PROJECT_A" }),
    } as Response);
    await expect(delayedRead).resolves.toBe("PROJECT_A");
    await managerA.writeProjectFile("index.html", "A_AFTER");
    await expect(managerB.readProjectFile("index.html")).resolves.toBe("PROJECT_B");
    await expect(managerB.readOptionalProjectFile("index.html")).resolves.toBe("PROJECT_B");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-a%2F..%2Fother%3Fx%3D1/files/index.html",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-a%2F..%2Fother%3Fx%3D1/files/index.html",
      expect.objectContaining({ method: "PUT", body: "A_AFTER" }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/project-b%23fragment/files/index.html");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-b%23fragment/files/index.html?optional=1",
    );

    await act(async () => root.unmount());
  });
});
