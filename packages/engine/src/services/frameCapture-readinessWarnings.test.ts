import { describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { collectMediaReadinessWarnings } from "./frameCapture.js";

function makePage(input: {
  images?: Array<{ src: string; complete: boolean; naturalWidth: number }>;
  media?: Array<{
    id?: string;
    tagName: "VIDEO" | "AUDIO";
    src: string;
    readyState: number;
    networkState?: number;
    error?: unknown;
  }>;
}): Page {
  return {
    evaluate: async (fn: (skipIds: readonly string[]) => unknown, skipIds: readonly string[]) => {
      const previousDocument = Reflect.get(globalThis, "document");
      const previousMedia = Reflect.get(globalThis, "HTMLMediaElement");
      Reflect.set(globalThis, "HTMLMediaElement", {
        NETWORK_NO_SOURCE: 3,
        HAVE_CURRENT_DATA: 2,
      });
      Reflect.set(globalThis, "document", {
        querySelectorAll: (selector: string) => {
          if (selector === "img") {
            return (input.images ?? []).map((image) => ({
              ...image,
              getAttribute: (name: string) => (name === "src" ? image.src : null),
            }));
          }
          const media =
            selector === "video"
              ? (input.media ?? []).filter((element) => element.tagName === "VIDEO")
              : (input.media ?? []);
          return media.map((media) => ({
            id: media.id ?? "",
            tagName: media.tagName,
            currentSrc: media.src,
            readyState: media.readyState,
            networkState: media.networkState ?? 1,
            error: media.error ?? null,
            getAttribute: (name: string) => (name === "src" ? media.src : null),
          }));
        },
      });
      try {
        return await fn(skipIds);
      } finally {
        Reflect.set(globalThis, "document", previousDocument);
        Reflect.set(globalThis, "HTMLMediaElement", previousMedia);
      }
    },
  } as unknown as Page;
}

describe("collectMediaReadinessWarnings", () => {
  it("returns stable warnings for visual media and ignores out-of-band audio", async () => {
    const page = makePage({
      images: [
        { src: "/pending.png", complete: false, naturalWidth: 0 },
        { src: "/broken.png", complete: true, naturalWidth: 0 },
      ],
      media: [
        { tagName: "VIDEO", src: "/broken.mp4", readyState: 0, error: new Error("decode") },
        { tagName: "AUDIO", src: "/pending.mp3", readyState: 1 },
        { id: "injected", tagName: "VIDEO", src: "/injected.mp4", readyState: 0 },
      ],
    });

    const warnings = await collectMediaReadinessWarnings(page, ["injected"], 45000);

    expect(warnings.map((warning) => [warning.code, warning.details?.mediaType])).toEqual([
      ["media_readiness_timeout", "image"],
      ["media_load_failed", "image"],
      ["media_load_failed", "video"],
    ]);
    expect(warnings.every((warning) => warning.details?.timeoutMs === 45000)).toBe(true);
  });

  it("returns no warnings when every relevant resource is ready", async () => {
    const page = makePage({
      images: [{ src: "/ready.png", complete: true, naturalWidth: 100 }],
      media: [
        { tagName: "VIDEO", src: "/ready.mp4", readyState: 2 },
        { tagName: "AUDIO", src: "/ready.mp3", readyState: 2 },
      ],
    });

    await expect(collectMediaReadinessWarnings(page, [], 1000)).resolves.toEqual([]);
  });
});
