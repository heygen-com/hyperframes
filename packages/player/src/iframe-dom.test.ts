import { afterEach, describe, expect, it, vi } from "vitest";

/** Makes every iframe report the viewport and pixel ratio an engine gives a frame zoomed by its style. */
function engineFrames(viewport: (zoom: number) => [number, number], ratioFollowsZoom: boolean) {
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockImplementation(
    function (this: HTMLIFrameElement) {
      const zoom = Number(this.style.zoom) || 1;
      const [innerWidth, innerHeight] = viewport(zoom);
      const devicePixelRatio = window.devicePixelRatio * (ratioFollowsZoom ? zoom : 1);
      return { innerWidth, innerHeight, devicePixelRatio } as unknown as Window;
    },
  );
}

async function fit() {
  vi.resetModules(); // the engine probe is cached per module
  const { scaleIframeToFit } = await import("./iframe-dom.js");
  const player = document.body.appendChild(document.createElement("div"));
  Object.defineProperty(player, "offsetWidth", { value: 528 });
  Object.defineProperty(player, "offsetHeight", { value: 297 });
  const iframe = player.appendChild(document.createElement("iframe"));
  expect(scaleIframeToFit(player, iframe, 1920, 1080)).toBe(true);
  return iframe;
}

describe("scaleIframeToFit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("zooms the frame when the engine keeps its viewport, so content rasters at the size shown", async () => {
    engineFrames(() => [1920, 1080], true);
    const iframe = await fit();
    expect(Number(iframe.style.zoom)).toBeCloseTo(0.275, 6);
    expect(iframe.style.transform).toBe("translate(-50%, -50%)");
    expect(iframe.style.width).toBe("1920px");
  });

  it("zooms when the frame's viewport only snaps to a whole device pixel", async () => {
    engineFrames(() => [1919, 1080], true);
    const iframe = await fit();
    expect(Number(iframe.style.zoom)).toBeCloseTo(0.275, 6);
  });

  it("keeps the transform where zoom leaves the pixel ratio and shifts the viewport", async () => {
    engineFrames((zoom) => (zoom === 1 ? [1920, 1080] : [1925, 1084]), false);
    const iframe = await fit();
    expect(iframe.style.zoom).toBe("");
    expect(iframe.style.transform).toBe("translate(-50%, -50%) scale(0.275)");
  });
});
