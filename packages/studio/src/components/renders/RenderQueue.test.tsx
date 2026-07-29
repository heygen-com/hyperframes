// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderQueue } from "./RenderQueue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mountRenderQueue(onStartRender: ReturnType<typeof vi.fn>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <RenderQueue
        jobs={[]}
        projectId="demo"
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
        onStartRender={onStartRender}
        isRendering={false}
        compositionDimensions={{ width: 1920, height: 1080 }}
      />,
    );
  });
  return host;
}

describe("RenderQueue resolution submission", () => {
  it("submits the canonical landscape 4K preset selected by the user", () => {
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const resolutionSelect = [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.textContent?.startsWith("4K")),
    );
    if (!resolutionSelect) throw new Error("resolution selector did not render");

    act(() => {
      resolutionSelect.value = "4k";
      resolutionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const exportButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Export",
    );
    if (!exportButton) throw new Error("export button did not render");
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "landscape-4k", 30);
  });
});
