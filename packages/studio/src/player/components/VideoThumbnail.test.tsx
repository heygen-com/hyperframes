// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockResizeObserver, reportResize } from "../../hooks/resizeObserverTestUtils";
import { thumbnailScheduler } from "../lib/thumbnailScheduler";
import { decodeVideoThumbnail } from "../lib/thumbnailVideoDecoder";
import { VideoThumbnail } from "./VideoThumbnail";

vi.mock("../lib/thumbnailVideoDecoder", () => ({ decodeVideoThumbnail: vi.fn() }));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

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

async function render(width = 0, height = 40) {
  Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
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

  it("requests a filmstrip sized by the measured clip height", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "filmstrip", urls: ["blob:a", "blob:b"], aspect: 16 / 9 },
      weight: 256,
    });

    await render(440);

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

    await render(300);

    const tiles = [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(tiles).toEqual(["blob:0", "blob:2", "blob:4", "blob:5", "blob:7"]);
  });

  it("issues a single decode job for a narrow clip", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "image", url: "blob:poster", aspect: 16 / 9 },
      weight: 128,
    });

    await render(60);

    expect(decodeVideoThumbnail).toHaveBeenCalledTimes(1);
  });

  it("tiles a wide picture at the clip's measured height, whole", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "image", url: "blob:wide", aspect: 2.7 },
      weight: 128,
    });

    await render(500, 40);

    expect(host.querySelector("img")?.parentElement?.style.width).toBe("108px");
  });

  it("re-tiles at the height the resize observer reports", async () => {
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "image", url: "blob:wide", aspect: 2.7 },
      weight: 128,
    });
    await render(0, 0);

    await act(async () => {
      reportResize(500, 40);
      await Promise.resolve();
    });

    expect(host.querySelector("img")?.parentElement?.style.width).toBe("108px");
  });

  it("clears the loading shimmer when the scheduled decode fails", async () => {
    vi.mocked(decodeVideoThumbnail).mockRejectedValue(new Error("decode failed"));

    await render();
    await vi.waitFor(() => expect(thumbnailScheduler.getDiagnostics().active).toBe(0));

    expect(host.querySelector(".animate-pulse")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
  });
});
