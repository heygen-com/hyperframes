// @vitest-environment happy-dom
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../../tests/chromeTestUtils";

vi.setConfig({ testTimeout: 60_000 });

let browser: Awaited<ReturnType<typeof launchTestChrome>> | undefined;

afterEach(async () => {
  await closeTestChrome(browser);
  browser = undefined;
});

const HALF = 8;
const CORNERS = [
  { x: "left", y: "top", cursor: "nwse-resize" },
  { x: "right", y: "top", cursor: "nesw-resize" },
  { x: "left", y: "bottom", cursor: "nesw-resize" },
  { x: "right", y: "bottom", cursor: "nwse-resize" },
] as const;
const BOXES = [
  { width: 4, height: 4, inset: { top: 0, right: 0, bottom: 0, left: 0 } },
  { width: 14, height: 8, inset: { top: 0, right: 0, bottom: 0, left: 0 } },
  { width: 24, height: 40, inset: { top: 0, right: 0, bottom: 0, left: 0 } },
  { width: 40, height: 40, inset: { top: 12, right: 12, bottom: 12, left: 12 } },
  { width: 10, height: 10, inset: { top: 0, right: 8, bottom: 4, left: 6 } },
  { width: 240, height: 160, inset: { top: 0, right: 0, bottom: 0, left: 0 } },
];

/** Where a handle's top-left sat in the wrapper when Studio computed its slide in pixels. */
function placedByPixels(
  corner: (typeof CORNERS)[number],
  box: (typeof BOXES)[number],
): [number, number] {
  const { width, height, inset } = box;
  const slideX = Math.max(0, HALF - (width - inset.left - inset.right) / 4);
  const slideY = Math.max(0, HALF - (height - inset.top - inset.bottom) / 4);
  const x = corner.x === "left" ? inset.left - HALF - slideX : width - inset.right - HALF + slideX;
  const y = corner.y === "top" ? inset.top - HALF - slideY : height - inset.bottom - HALF + slideY;
  return [x, y];
}

it("lays every handle out where its pixel slide put it, for small and large boxes", async () => {
  const bundle = await build({
    stdin: {
      contents: `export { resizeHandleLayout, rotateHandleLayout } from "./resizeHandleLayout";`,
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "Handles",
    platform: "browser",
    write: false,
  });
  browser = await launchTestChrome();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><body style="margin:0"></body>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text });

  const placed = await page.evaluate(
    (boxes: typeof BOXES, corners: typeof CORNERS) => {
      const api = (window as unknown as { Handles: Record<string, Function> }).Handles;
      return boxes.map((box) => {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = `position:absolute;left:300px;top:300px;width:${box.width}px;height:${box.height}px`;
        document.body.append(wrapper);
        const cornerPos = corners.map((corner) => {
          const handle = document.createElement("div");
          handle.style.cssText = "position:absolute;width:16px;height:16px";
          const { style } = api.resizeHandleLayout!(corner, box, box.inset);
          for (const side of ["left", "right", "top", "bottom"]) {
            if (style[side] !== undefined) handle.style.setProperty(side, String(style[side]));
          }
          wrapper.append(handle);
          const r = handle.getBoundingClientRect();
          return [r.left - 300, r.top - 300];
        });
        const rotate = document.createElement("div");
        rotate.style.cssText =
          "position:absolute;width:22px;height:22px;transform:translateX(-50%)";
        const rotStyle = api.rotateHandleLayout!(box.inset);
        rotate.style.setProperty("left", String(rotStyle.left));
        rotate.style.setProperty("top", String(rotStyle.top));
        wrapper.append(rotate);
        const rr = rotate.getBoundingClientRect();
        return { corners: cornerPos, rotate: [rr.left + rr.width / 2 - 300, rr.top - 300] };
      });
    },
    BOXES,
    CORNERS,
  );

  for (const [b, box] of BOXES.entries()) {
    for (const [c, corner] of CORNERS.entries()) {
      const [x, y] = placedByPixels(corner, box);
      const at = `${box.width}x${box.height} ${corner.y}-${corner.x}`;
      expect(placed[b]!.corners[c]![0], at).toBeCloseTo(x, 3);
      expect(placed[b]!.corners[c]![1], at).toBeCloseTo(y, 3);
    }
    const { width, height, inset } = box;
    const expectedRotX = inset.left + Math.max(0, width - inset.left - inset.right) / 2;
    const expectedRotY = height - inset.bottom + 12;
    expect(placed[b]!.rotate[0], `rotate x ${width}x${height}`).toBeCloseTo(expectedRotX, 3);
    expect(placed[b]!.rotate[1], `rotate y ${width}x${height}`).toBeCloseTo(expectedRotY, 3);
  }
});
