// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderQueueItem } from "./RenderQueueItem";
import type { RenderJob } from "./useRenderQueue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mount(job: RenderJob): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <RenderQueueItem job={job} projectId="demo" onDelete={vi.fn()} onCancel={vi.fn()} />,
    );
  });
  return host;
}

const base: RenderJob = {
  id: "demo_2026",
  status: "complete",
  progress: 100,
  filename: "demo_2026",
  createdAt: Date.now(),
};

function captureDownload(host: HTMLElement, label: string): HTMLAnchorElement | undefined {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  act(() => button?.click());
  const anchor: unknown = click.mock.contexts[0];
  return anchor instanceof HTMLAnchorElement ? anchor : undefined;
}

describe("GIF render preview", () => {
  it("uses an image instead of video playback, with open, download and delete actions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onDelete = vi.fn();
    try {
      act(() =>
        root.render(
          <RenderQueueItem
            job={{ id: "j1", filename: "j1.gif", status: "complete", progress: 100, createdAt: 0 }}
            projectId="demo"
            onDelete={onDelete}
            onCancel={vi.fn()}
          />,
        ),
      );
      expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/render/j1/view");
      expect(host.querySelector("video")).toBeNull();
      expect(host.querySelector('[aria-label="Open j1.gif in a new tab"]')).not.toBeNull();
      expect(
        host.querySelector<HTMLButtonElement>('[aria-label="Download j1.gif"]')?.disabled,
      ).toBe(false);
      const deleteButton = host.querySelector<HTMLButtonElement>('[aria-label="Delete j1.gif"]');
      act(() => deleteButton?.click());
      const confirm = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Delete?",
      );
      act(() => confirm?.click());
      expect(onDelete).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});

describe("RenderQueueItem directory renders", () => {
  it("uses the output filename, not an opaque identity, as the ZIP filename", () => {
    const host = mount({ ...base, id: ".hf-render~opaque", filename: "intro", kind: "directory" });
    const anchor = captureDownload(host, "Download intro.zip");
    expect(anchor?.getAttribute("href")).toBe("/api/render/.hf-render~opaque/download");
    expect(anchor?.download).toBe("intro.zip");
  });
  it("has no video preview or open action, and downloads the ZIP archive", () => {
    const host = mount({ ...base, kind: "directory", frameCount: 90 });

    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector('[aria-label^="Open "]')).toBeNull();
    expect(host.querySelector('[data-testid="render-sequence-thumbnail"]')).not.toBeNull();
    expect(host.textContent).toContain("90 frames");

    const anchor = captureDownload(host, "Download demo_2026.zip");
    expect(anchor?.getAttribute("href")).toBe("/api/render/demo_2026/download");
    expect(anchor?.download).toBe("demo_2026.zip");
  });

  it("keeps identity-bound open and download actions for a file render", () => {
    const host = mount({ ...base, filename: "demo_2026.mp4" });

    expect(host.querySelector('[aria-label="Open demo_2026.mp4 in a new tab"]')).not.toBeNull();
    const anchor = captureDownload(host, "Download demo_2026.mp4");
    expect(anchor?.getAttribute("href")).toBe("/api/render/demo_2026/download");
  });
});

describe("identity-bound file actions", () => {
  it.each(["mp4", "webm", "mov", "gif"])(
    "uses the opaque ID, not the filename or project ID, for %s actions",
    (extension) => {
      const opened = vi.spyOn(window, "open").mockImplementation(() => null);
      const filename = `intro.${extension}`;
      const host = mount({ ...base, id: ".hf-render~opaque id", filename });
      const button = host.querySelector<HTMLButtonElement>(
        `[aria-label="Open ${filename} in a new tab"]`,
      );
      expect(button).not.toBeNull();
      act(() => button?.click());
      expect.soft(opened).toHaveBeenCalledWith("/api/render/.hf-render~opaque%20id/view", "_blank");
      const anchor = captureDownload(host, `Download ${filename}`);
      expect(anchor?.getAttribute("href")).toBe("/api/render/.hf-render~opaque%20id/download");
      expect(anchor?.download).toBe(filename);
    },
  );
});
