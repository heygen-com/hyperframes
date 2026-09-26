// @vitest-environment node
// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { type Page } from "puppeteer-core";
import { createFrameLookupTable, type ExtractedFrames } from "./videoFrameExtractor.js";
import { createVideoFrameInjector } from "./videoFrameInjector.js";

function frames(videoId: string): ExtractedFrames {
  const fps = 30;
  const totalFrames = 30;
  return {
    videoId,
    srcPath: `${videoId}.webm`,
    outputDir: `/tmp/${videoId}`,
    framePattern: "frame-%05d.jpg",
    fps,
    totalFrames,
    metadata: {
      durationSeconds: totalFrames / fps,
      width: 320,
      height: 180,
      fps,
      hasAudio: false,
      videoCodec: "vp9",
      colorSpace: { colorTransfer: "bt709", colorPrimaries: "bt709", colorSpace: "bt709" },
      isVFR: false,
      hasAlpha: false,
    },
    framePaths: new Map(Array.from({ length: totalFrames }, (_, i) => [i, `${videoId}-${i}`])),
  };
}

const globals = globalThis as unknown as { window?: unknown; document?: unknown };
const previous = { window: globals.window, document: globals.document };

afterEach(() => {
  globals.window = previous.window;
  globals.document = previous.document;
});

function mountPage(): { page: Page; paintedFrames: () => Record<string, string> } {
  const { window, document } = parseHTML(
    `<html><body>
      <div><video id="a" data-start="0.1" data-duration="0.2"></video></div>
      <div><video id="b" data-start="0.3" data-duration="0.2"></video></div>
    </body></html>`,
  );
  Object.defineProperty(window.HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      objectFit: "fill",
      objectPosition: "50% 50%",
      zIndex: "auto",
      getPropertyValue: () => "",
    }),
  });
  for (const video of document.querySelectorAll("video")) {
    video.getBoundingClientRect = () => ({ width: 320, height: 180 }) as DOMRect;
  }
  globals.window = window;
  globals.document = document;
  const page = {
    evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
  } as unknown as Page;
  const paintedFrames = () =>
    Object.fromEntries(
      Array.from(document.querySelectorAll("img.__render_frame__"))
        .filter((img) => (img as HTMLImageElement).style.visibility === "visible")
        .map((img) => [img.previousElementSibling?.id ?? "", img.getAttribute("src") ?? ""]),
    );
  return { page, paintedFrames };
}

describe("export frame injection at a shared clip boundary", () => {
  it("paints only the incoming clip at the instant the outgoing one ends", async () => {
    const table = createFrameLookupTable(
      [
        {
          id: "a",
          src: "a.webm",
          start: 0.1,
          end: 0.1 + 0.2,
          mediaStart: 0,
          loop: false,
          hasAudio: false,
        },
        {
          id: "b",
          src: "b.webm",
          start: 0.3,
          end: 0.5,
          mediaStart: 0,
          loop: false,
          hasAudio: false,
        },
      ],
      [frames("a"), frames("b")],
    );
    const inject = createVideoFrameInjector(table, { frameSrcResolver: (path) => `data:${path}` })!;
    const { page, paintedFrames } = mountPage();

    await inject(page, 8 / 30);
    expect(paintedFrames()).toEqual({ a: "data:a-5" });

    await inject(page, 9 / 30);
    expect(paintedFrames()).toEqual({ b: "data:b-0" });
  });
});
