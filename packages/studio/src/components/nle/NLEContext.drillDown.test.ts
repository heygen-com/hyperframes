// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { previewRequest } from "../../player/lib/previewChannel";
import { hostCompositionSrc } from "./NLEContext";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return { ...actual, previewRequest: vi.fn(async () => null) };
});

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

describe("hostCompositionSrc", () => {
  it("reads a sealed preview's host for the composition over its editing port", async () => {
    const iframe = sealedPreview();
    vi.mocked(previewRequest).mockImplementation((async (_frame: HTMLIFrameElement, kind: string) =>
      kind === "query"
        ? { matches: [{ handle: "host" }], truncated: false }
        : {
            elements: [
              {
                attributes: [
                  ["data-composition-id", "intro"],
                  ["data-composition-src", "compositions/intro.html"],
                ],
              },
            ],
          }) as unknown as typeof previewRequest);
    await expect(hostCompositionSrc(iframe, 'in"tro')).resolves.toBe("compositions/intro.html");
    expect(vi.mocked(previewRequest)).toHaveBeenCalledWith(iframe, "query", {
      selector: `[data-composition-id="in\\"tro"][data-composition-src]`,
    });
    expect(vi.mocked(previewRequest)).toHaveBeenCalledWith(iframe, "describe", {
      handles: ["host"],
    });
  });

  it("answers nothing when the preview has no such host or cannot answer", async () => {
    vi.mocked(previewRequest).mockResolvedValue(null);
    await expect(hostCompositionSrc(sealedPreview(), "intro")).resolves.toBeUndefined();
    vi.mocked(previewRequest).mockResolvedValue({ matches: [], truncated: false });
    await expect(hostCompositionSrc(sealedPreview(), "intro")).resolves.toBeUndefined();
  });
});
