import { WEB_CAPTURE_ROUTE_PREFIX } from "@hyperframes/core/web-capture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStillCapture, validateCaptureText } from "../src/capture/envelope";

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ4nWQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

afterEach(() => vi.unstubAllGlobals());

describe("buildStillCapture", () => {
  it("uses the shared v2 builder and preserves a cropped diagnostic", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close() {} }));
    const result = await buildStillCapture(
      {
        mime: "image/png",
        bytes: ONE_PIXEL_PNG,
        dataUrl: "data:image/png;base64,fixture",
        width: 1,
        height: 1,
        completeness: "cropped",
      },
      {
        left: -1,
        top: 0,
        width: 2,
        height: 1,
        viewportWidth: 1,
        viewportHeight: 1,
        devicePixelRatio: 1,
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.startsWith(`${WEB_CAPTURE_ROUTE_PREFIX}\n`)).toBe(true);
    const parsed = await validateCaptureText(result.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.artifact).toEqual({
      kind: "still",
      resourceId: "selected-still",
      width: 1,
      height: 1,
      completeness: "cropped",
    });
    expect(parsed.envelope.diagnostics).toEqual([{ code: "still.cropped", count: 1 }]);
  });
});
