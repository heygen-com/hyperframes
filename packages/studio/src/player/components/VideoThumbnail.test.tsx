// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbnailScheduler } from "../lib/thumbnailScheduler";
import { decodeVideoThumbnail } from "../lib/thumbnailVideoDecoder";
import { VideoThumbnail } from "./VideoThumbnail";

vi.mock("../lib/thumbnailVideoDecoder", () => ({ decodeVideoThumbnail: vi.fn() }));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  thumbnailScheduler.invalidateProject("p");
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

async function render(width = 0) {
  Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <VideoThumbnail
        videoSrc="/api/projects/p/preview/assets/clip.mp4"
        label=""
        labelColor="#fff"
        projectId="p"
        sessionEpoch={1}
        priority="visible"
      />,
    );
    await Promise.resolve();
  });
}

describe("VideoThumbnail", () => {
  it("does not acquire a thumbnail lease before the clip is measured", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "image", url: "blob:poster", aspect: 16 / 9 },
      weight: 128,
    });

    await render();

    expect(decodeVideoThumbnail).not.toHaveBeenCalled();
  });

  it("requests a geometry-sized filmstrip by default", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "filmstrip", urls: ["blob:a", "blob:b"], aspect: 16 / 9 },
      weight: 256,
    });

    await render(500);

    expect(decodeVideoThumbnail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ frameCount: 1 }),
      expect.any(AbortSignal),
    );
    expect(decodeVideoThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ frameCount: 8 }),
      expect.any(AbortSignal),
    );
    expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("spreads the frames across every tile so the strip reaches the clip's end", async () => {
    const urls = Array.from({ length: 8 }, (_, index) => `blob:${index}`);
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "filmstrip", urls, aspect: 16 / 9 },
      weight: 256,
    });

    await render(500);

    const tiles = [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(tiles).toEqual(["blob:0", "blob:2", "blob:4", "blob:5", "blob:7"]);
  });

  it("issues a single decode job for a narrow clip", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "image", url: "blob:poster", aspect: 16 / 9 },
      weight: 128,
    });

    await render(100);

    expect(decodeVideoThumbnail).toHaveBeenCalledTimes(1);
  });

  it("clears the loading shimmer when the scheduled decode fails", async () => {
    vi.mocked(decodeVideoThumbnail).mockRejectedValue(new Error("decode failed"));

    await render();
    await vi.waitFor(() => expect(thumbnailScheduler.getDiagnostics().active).toBe(0));

    expect(host.querySelector(".animate-pulse")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
  });
});
