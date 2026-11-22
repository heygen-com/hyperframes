// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { PausedVideoFrameProvider } from "@hyperframes/core";
import { resolveFramePlaybackAdapter } from "../hooks/playbackAdapterResolution";
import { sealedPreviewFrame } from "./sealedPreviewFrame.test-helpers";

const decoder = vi.hoisted(() => ({
  decode: vi.fn(),
  suspend: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./pausedVideoDecoder", () => ({ createPausedVideoDecoder: () => decoder }));
vi.mock("../../utils/studioApiFetch", () => ({
  studioApiFetch: vi.fn(async () => Response.json({ files: ["index.html", "assets/a.mp4"] })),
}));

const TOKEN = "t".repeat(43);
const refs = () => ({ cache: { current: null }, warned: { current: false } });
const runtime = window as unknown as { __hf?: { setPausedVideoFrameProvider?: unknown } };
afterEach(() => {
  delete runtime.__hf;
  vi.unstubAllGlobals();
});

// Node has no ImageBitmap; a MessagePort crosses a port by transfer and closes like one.
const bitmap = () => new MessageChannel().port1;

it("a sealed frame's runtime decodes paused frames through Studio, which reads only the project file", async () => {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap()),
  );
  // happy-dom's MessagePort global is not the class its MessageChannel makes, as a browser's is.
  vi.stubGlobal("MessagePort", bitmap().constructor);
  const install = vi.fn<(provider: PausedVideoFrameProvider) => void>();
  runtime.__hf = { setPausedVideoFrameProvider: install };
  const { iframe } = sealedPreviewFrame();
  Object.defineProperty(iframe, "src", {
    value: `${location.origin}/api/projects/p1/preview/~${TOKEN}/index.html`,
  });

  resolveFramePlaybackAdapter(iframe, refs());
  await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());

  const release = vi.fn();
  decoder.decode.mockResolvedValueOnce([
    { source: bitmap(), timestamp: 0.5, duration: 1 / 30, width: 4, height: 2, release },
  ]);
  const provider = install.mock.calls[0]![0];
  const source = `${location.origin}/api/projects/p1/preview/~${TOKEN}/assets/a.mp4?hf-proxy=h264&other=1`;
  const video = document.createElement("video");
  const frames = await provider.decode(
    [{ video, source, time: 0.5 }],
    new AbortController().signal,
  );

  expect(decoder.decode).toHaveBeenCalledWith(
    [{ source: "/api/projects/p1/preview/assets/a.mp4?hf-proxy=h264", time: 0.5 }],
    expect.any(AbortSignal),
  );
  expect(frames).toMatchObject([{ timestamp: 0.5, duration: 1 / 30, width: 4, height: 2 }]);
  expect(release).toHaveBeenCalledOnce();
  frames[0]!.release();
  provider.dispose();
});
