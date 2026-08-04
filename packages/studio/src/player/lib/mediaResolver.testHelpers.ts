import { vi } from "vitest";

/**
 * happy-dom's `<video>` / `<canvas>` don't decode media, so stub the seams
 * `extractVideoFrames` depends on and hand back every hidden `<video>` it
 * creates — the request count under test.
 *
 * Call from `beforeEach`; the mocks come off with `vi.restoreAllMocks()`.
 */
export function stubVideoExtraction(): HTMLVideoElement[] {
  const createdVideos: HTMLVideoElement[] = [];
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = origCreate(tag);
    if (tag === "video") createdVideos.push(el as HTMLVideoElement);
    return el;
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D);
  return createdVideos;
}
