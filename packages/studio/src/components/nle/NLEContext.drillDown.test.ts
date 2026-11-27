// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { previewRequest } from "../../player/lib/previewChannel";
import { hostCompositionSrc } from "./NLEContext";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return { ...actual, previewRequest: vi.fn(async () => null) };
});

afterEach(() => vi.mocked(previewRequest).mockReset());

const HANDLE = "0123456789abcdef:1";
const NO_SOURCE = { file: null, compositionId: null, originalCompositionId: null };

function sealedPreview(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentDocument", {
    get() {
      throw new DOMException(
        "Blocked a frame from accessing a cross-origin frame.",
        "SecurityError",
      );
    },
  });
  return iframe;
}

function preview(attributes: unknown) {
  vi.mocked(previewRequest).mockImplementation((async (_frame: HTMLIFrameElement, kind: string) =>
    kind === "query"
      ? { matches: [{ handle: HANDLE, source: NO_SOURCE }], truncated: false }
      : {
          elements: [
            {
              handle: HANDLE,
              parent: null,
              tag: "div",
              id: "intro",
              selector: null,
              matchesBefore: null,
              source: NO_SOURCE,
              locked: false,
              attributes,
              inlineStyles: {},
              text: "",
              children: [],
              rect: { x: 0, y: 0, width: 1, height: 1 },
              truncated: false,
            },
          ],
        }) as unknown as typeof previewRequest);
}

describe("hostCompositionSrc", () => {
  it("reads a sealed preview's host for the composition over its editing port", async () => {
    const iframe = sealedPreview();
    preview([
      ["data-composition-id", "intro"],
      ["data-composition-src", "compositions/intro.html"],
    ]);
    await expect(hostCompositionSrc(iframe, 'in"tro')).resolves.toBe("compositions/intro.html");
    expect(vi.mocked(previewRequest)).toHaveBeenCalledWith(iframe, "query", {
      selector: `[data-composition-id="in\\"tro"][data-composition-src]`,
    });
    expect(vi.mocked(previewRequest)).toHaveBeenCalledWith(
      iframe,
      "describe",
      { handles: [HANDLE] },
      undefined,
      "now",
    );
  });

  it("answers nothing for a reply the frame got wrong, rather than passing it on", async () => {
    preview([["data-composition-src", { evil: 1 }]]);
    await expect(hostCompositionSrc(sealedPreview(), "intro")).resolves.toBeUndefined();
    preview("x");
    await expect(hostCompositionSrc(sealedPreview(), "intro")).resolves.toBeUndefined();
  });

  it("answers nothing when the preview has no such host or cannot answer", async () => {
    vi.mocked(previewRequest).mockResolvedValue(null);
    await expect(hostCompositionSrc(sealedPreview(), "intro")).resolves.toBeUndefined();
    vi.mocked(previewRequest).mockResolvedValue({ matches: [], truncated: false });
    await expect(hostCompositionSrc(sealedPreview(), "intro")).resolves.toBeUndefined();
  });
});
