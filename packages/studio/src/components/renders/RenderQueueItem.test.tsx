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

describe("RenderQueueItem directory renders", () => {
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

  it("keeps the open action and the direct file download for a file render", () => {
    const host = mount({ ...base, filename: "demo_2026.mp4" });

    expect(host.querySelector('[aria-label="Open demo_2026.mp4 in a new tab"]')).not.toBeNull();
    const anchor = captureDownload(host, "Download demo_2026.mp4");
    expect(anchor?.getAttribute("href")).toContain("/renders/file/demo_2026.mp4");
  });
});
