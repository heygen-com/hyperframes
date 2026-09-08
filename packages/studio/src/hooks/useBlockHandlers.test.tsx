// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlockHandlers, type UseBlockHandlersResult } from "./useBlockHandlers";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const addBlockToProject = vi.hoisted(() => vi.fn());
vi.mock("../utils/blockInstaller", () => ({ addBlockToProject }));

/** One handle per render, so the assertions read a list instead of a mutated binding. */
const rendered: UseBlockHandlersResult[] = [];
const showToast = vi.fn();

const PLACEMENT = { start: 0, track: 0, compositionPath: "index.html" };

function makeDeps() {
  return {
    activeCompPath: "index.html",
    timelineElements: [],
    readProjectFile: vi.fn(async () => ""),
    writeProjectFile: vi.fn(async () => {}),
    recordEdit: vi.fn(async () => {}),
    refreshFileTree: vi.fn(async () => {}),
    reloadPreview: vi.fn(),
    showToast,
  };
}

function Probe({ deps }: { deps: ReturnType<typeof makeDeps> }) {
  rendered.push(
    useBlockHandlers({
      projectId: "p1",
      blockCtxDeps: deps,
      previewIframeRef: { current: null },
      setRightCollapsed: vi.fn(),
      setRightPanelTab: vi.fn(),
    }),
  );
  return null;
}

function latest(): UseBlockHandlersResult {
  const handle = rendered[rendered.length - 1];
  if (!handle) throw new Error("hook did not render");
  return handle;
}

let unmount: () => void;

beforeEach(() => {
  rendered.length = 0;
  vi.clearAllMocks();
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe deps={makeDeps()} />));
  unmount = () => act(() => root.unmount());
});

afterEach(() => unmount());

describe("useBlockHandlers install latch", () => {
  it("refuses a second install while the first is still in flight", async () => {
    let release = () => {};
    addBlockToProject.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(undefined))),
    );

    const first = latest().handleAddMediaOverlay("fade-in", PLACEMENT);
    await act(async () => {
      await latest().handleAddMediaOverlay("fade-in", PLACEMENT);
    });

    expect(addBlockToProject).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("A block is already installing — one moment…", "info");

    await act(async () => {
      release();
      await first;
    });
  });

  it("lowers the latch when the install rejects, so the next drop still installs", async () => {
    addBlockToProject.mockRejectedValueOnce(new Error("install failed"));

    await act(async () => {
      await latest().handleAddMediaOverlay("fade-in", PLACEMENT);
    });

    addBlockToProject.mockResolvedValueOnce(undefined);
    await act(async () => {
      await latest().handleAddMediaOverlay("fade-in", PLACEMENT);
    });

    expect(addBlockToProject).toHaveBeenCalledTimes(2);
  });

  it("reports a failed install instead of leaving the rejection unhandled", async () => {
    addBlockToProject.mockRejectedValueOnce(new Error("install failed"));

    // Every caller drops this promise, so a rejection reaches nothing that can
    // report it: the user gets "Adding fade-in…" and then silence.
    await act(async () => {
      await expect(latest().handleAddMediaOverlay("fade-in", PLACEMENT)).resolves.toBeUndefined();
    });

    expect(showToast).toHaveBeenCalledWith("install failed");
  });

  it("names the block when the failure carries no message", async () => {
    addBlockToProject.mockRejectedValueOnce("nope");

    await act(async () => {
      await latest().handleAddMediaOverlay("fade-in", PLACEMENT);
    });

    expect(showToast).toHaveBeenCalledWith("Failed to add fade-in");
  });
});
