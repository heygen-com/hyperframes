// @vitest-environment jsdom
import html2canvas from "html2canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureScene } from "./capture.js";

vi.mock("html2canvas", () => ({
  default: vi.fn(() => Promise.resolve(document.createElement("canvas"))),
}));

async function captureCache() {
  document.body.innerHTML = '<div id="scene"><img src="cutout.png"></div>';
  await captureScene(document.getElementById("scene") as HTMLElement, "#000", 4, 4);
  return vi.mocked(html2canvas).mock.calls.at(-1)?.[1]?.cache;
}

function recordImages(): HTMLImageElement[] {
  const created: HTMLImageElement[] = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, options?: ElementCreationOptions) => {
      const element = createElement(tag, options);
      if (element instanceof HTMLImageElement) created.push(element);
      return element;
    },
  );
  return created;
}

describe("captureScene pictures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(html2canvas).mockClear();
  });

  it("leaves html2canvas's own picture loading to a document with an origin", async () => {
    expect(await captureCache()).toBeUndefined();
  });

  it("asks for pictures with CORS in an opaque document, and loads a refused one as before", async () => {
    vi.stubGlobal("origin", "null");
    const cache = await captureCache();
    if (!cache) throw new Error("Expected a picture cache for an opaque document");
    const created = recordImages();

    const readable = "http://127.0.0.1/p/cutout.png";
    await cache.addImage(readable);
    created[0]?.dispatchEvent(new Event("load"));
    expect(await cache.match(readable)).toBe(created[0]);
    expect(created[0]?.crossOrigin).toBe("anonymous");

    const refused = "http://127.0.0.1/p/other.png";
    await cache.addImage(refused);
    created[1]?.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(created).toHaveLength(3));
    created[2]?.dispatchEvent(new Event("load"));
    expect(await cache.match(refused)).toBe(created[2]);
    expect(created[2]?.crossOrigin).toBeNull();
  });
});
