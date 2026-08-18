// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderQueue } from "./RenderQueue";
import type { FfmpegStatus } from "./useFfmpegStatus";

// Encoder availability arrives as a prop (useRenderQueue owns the probe), so
// each case just states the environment it is about.
let ffmpegStatus: FfmpegStatus | null = { ok: true };
const recheck = vi.fn();

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

beforeEach(() => {
  ffmpegStatus = { ok: true };
  recheck.mockClear();
});

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
        ffmpeg={ffmpegStatus}
        ffmpegChecking={false}
        onRecheckFfmpeg={recheck}
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

function exportButtonIn(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Export");
  if (!button) throw new Error("export button did not render");
  return button;
}

describe("RenderQueue FFmpeg gate", () => {
  it("refuses Export and shows the install command when the server reports no FFmpeg", () => {
    ffmpegStatus = {
      ok: false,
      title: "FFmpeg not found",
      detail: "FFmpeg is required to encode video.",
      hint: "brew install ffmpeg",
      command: "brew install ffmpeg",
    };
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);

    expect(host.textContent).toContain("FFmpeg not found");
    expect(host.querySelector("code")?.textContent).toBe("brew install ffmpeg");

    const exportButton = exportButtonIn(host);
    expect(exportButton.disabled).toBe(true);
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onStartRender).not.toHaveBeenCalled();
  });

  it("offers a recheck so installing FFmpeg does not require restarting Studio", () => {
    ffmpegStatus = { ok: false, title: "FFmpeg not found", command: "brew install ffmpeg" };
    const host = mountRenderQueue(vi.fn());

    const recheckButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Recheck",
    );
    if (!recheckButton) throw new Error("recheck button did not render");
    act(() => {
      recheckButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(recheck).toHaveBeenCalledTimes(1);
  });

  // An unreachable or older dev server answers nothing. Treating "no answer"
  // as "not installed" would lock Export for setups that render fine.
  it("leaves Export usable when the probe returns no answer", () => {
    ffmpegStatus = null;
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);

    expect(host.textContent).not.toContain("FFmpeg not found");
    const exportButton = exportButtonIn(host);
    expect(exportButton.disabled).toBe(false);
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onStartRender).toHaveBeenCalledTimes(1);
  });

  it("says nothing when FFmpeg is present", () => {
    const host = mountRenderQueue(vi.fn());

    expect(host.textContent).not.toContain("FFmpeg not found");
    expect(exportButtonIn(host).disabled).toBe(false);
  });
});
