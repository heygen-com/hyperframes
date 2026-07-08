// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contrastScript = readFileSync(join(__dirname, "contrast-audit.browser.js"), "utf-8");

interface RectInput {
  left: number;
  top: number;
  width: number;
  height: number;
}

describe("contrast-audit.browser clip-path visibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (window as unknown as { __contrastAudit?: unknown }).__contrastAudit;
  });

  it("excludes text clipped to nothing by clip-path from contrast reports", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="headline">Hidden text</div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const id = (element as Element).id;
      return {
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: "rgb(0, 0, 0)",
        fontSize: "32px",
        fontWeight: "400",
        clipPath: id === "headline" ? "inset(0px 100% 0px 0px)" : "none",
      } as unknown as CSSStyleDeclaration;
    });

    vi.spyOn(document.getElementById("headline")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 100, top: 100, width: 400, height: 80 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript();

    expect(await runContrastAudit()).toEqual([]);
  });
});

function installContrastScript(): void {
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 360;

    set src(_value: string) {
      this.onload?.();
    }
  }

  vi.stubGlobal("Image", MockImage);
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    drawImage() {},
    getImageData() {
      return { data: new Uint8ClampedArray(640 * 360 * 4).fill(255) };
    },
  } as unknown as CanvasRenderingContext2D);
  window.eval(contrastScript);
}

async function runContrastAudit(): Promise<Array<Record<string, unknown>>> {
  return (
    window as unknown as {
      __contrastAudit: (imgBase64: string, time: number) => Promise<Array<Record<string, unknown>>>;
    }
  ).__contrastAudit("stub", 0);
}

function rect({ left, top, width, height }: RectInput): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}
