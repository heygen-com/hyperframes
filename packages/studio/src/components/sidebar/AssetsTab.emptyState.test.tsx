// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsTab } from "./AssetsTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../utils/studioApiFetch", () => ({
  studioApiFetch: vi.fn(async () => new Response("", { status: 404 })),
}));

function chooseFilesButton(container: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Choose files",
  );
}

describe("AssetsTab empty state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("tells a new user what to do and offers a native Choose files action", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await act(async () => {
      root.render(<AssetsTab projectId="demo" assets={[]} onImport={vi.fn()} />);
    });

    expect(container.textContent).toContain("Drop media files here or choose files to get started");
    const button = chooseFilesButton(container);
    expect(button).toBeDefined();
    // A native button is keyboard-focusable and activatable by default.
    expect(button?.type).toBe("button");
    expect(button?.tabIndex).toBe(0);

    await act(async () => {
      button?.click();
    });
    expect(inputClick).toHaveBeenCalledTimes(1);
  });

  it("omits the Choose files action when imports are not supported", async () => {
    await act(async () => {
      root.render(<AssetsTab projectId="demo" assets={[]} />);
    });

    expect(container.textContent).toContain("Drop media files here or choose files to get started");
    expect(chooseFilesButton(container)).toBeUndefined();
  });
});
