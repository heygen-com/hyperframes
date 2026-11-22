// @vitest-environment happy-dom
import { build } from "esbuild";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../../tests/chromeTestUtils";

vi.setConfig({ testTimeout: 60_000 });

let browser: Awaited<ReturnType<typeof launchTestChrome>> | undefined;

afterEach(async () => {
  await closeTestChrome(browser);
  browser = undefined;
});

// Each layer is 200 x 100 CSS px; `own` is the size it paints at along its own edges, null for a layer
// turned out of its plane, which the walk declines so callers use the box Chrome paints.
const LAYERS: Array<{ id: string; style: string; own: [number, number] | null; parent?: string }> =
  [
    { id: "depthScaled", style: "transform: rotate(45deg); scale: 1 1 2", own: [200, 100] },
    { id: "scaleProperty", style: "scale: 2", own: [400, 200] },
    { id: "turnedScaleProperty", style: "rotate: 45deg; scale: 2", own: [400, 200] },
    { id: "matrix", style: "transform: rotate(30deg) scale(2)", own: [400, 200] },
    { id: "mirrored", style: "transform: scaleX(-1); rotate: 20deg", own: [200, 100] },
    { id: "translated", style: "translate: 50% 10px; rotate: 10deg", own: [200, 100] },
    { id: "tipped", style: "rotate: x 60deg", own: null },
    { id: "tippedBack", style: "rotate: x -60deg", own: null, parent: "rotate: x 60deg" },
    {
      id: "projected",
      style: "transform: translateZ(100px) rotate(30deg)",
      own: null,
      parent: "transform: perspective(500px); transform-style: preserve-3d",
    },
    {
      id: "underPerspective",
      style: "transform: translateZ(100px) rotate(30deg)",
      own: null,
      parent: "perspective: 500px",
    },
    {
      id: "inPreserved",
      style: "rotate: 30deg",
      own: null,
      parent: "transform-style: preserve-3d",
    },
    {
      id: "spunFlat",
      style: "transform: matrix3d(0.866, 0.5, 0, 0, -0.5, 0.866, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
      own: [200, 100],
    },
    { id: "nested", style: "scale: 1.5; rotate: 15deg", own: [300, 150], parent: "rotate: 30deg" },
  ];

// fails without the fix: under a parent's `perspective: 500px` a depth-moved child is projected, and the corners
// spanned 223 x 187 where Chrome paints 279 x 233. Any 3D context above a layer now leaves it to the painted box.
it("reads every layer's painted corners as Chrome paints them", async () => {
  const bundle = await build({
    stdin: {
      contents: `export { readElementTransformSnapshot, elementCornerPoints } from "./editingGeometry";`,
      resolveDir: join(import.meta.dirname, "../../../../core/src/runtime"),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "OverlayTransform",
    platform: "browser",
    write: false,
  });
  browser = await launchTestChrome();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });
  const layer = ({ id, style }: (typeof LAYERS)[number]) =>
    `<div id="${id}" style="position:absolute;left:600px;top:500px;width:200px;height:100px;${style}"></div>`;
  await page.setContent(`<!doctype html><body style="margin:0">
    <div data-composition-id="main" style="position:relative;width:1600px;height:1200px">
      ${LAYERS.map((l) => (l.parent ? `<div style="position:absolute;inset:0;${l.parent}">${layer(l)}</div>` : layer(l))).join("")}
    </div></body>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text });

  const measured = await page.evaluate(
    (ids: string[]) => {
      type Point = { x: number; y: number };
      const api = (window as unknown as { OverlayTransform: Record<string, Function> })
        .OverlayTransform;
      const edge = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
      return ids.map((id) => {
        const element = document.getElementById(id)!;
        const snapshot = api.readElementTransformSnapshot!(window, element);
        const corners = snapshot && api.elementCornerPoints!(window, element, snapshot);
        if (!corners) return { id, corners: null };
        const points = Object.values(corners) as Point[];
        const box = element.getBoundingClientRect();
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        return {
          id,
          own: [edge(corners.nw, corners.ne), edge(corners.nw, corners.sw)],
          bounds: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
          painted: [box.width, box.height],
        };
      });
    },
    LAYERS.map((l) => l.id),
  );

  for (const [i, { id, own }] of LAYERS.entries()) {
    const got = measured[i]!;
    if (!own) {
      expect(got.corners, `${id} is declined`).toBeNull();
      continue;
    }
    expect(got.corners, id).not.toBeNull();
    expect(got.own![0], `${id} own width`).toBeCloseTo(own[0], 1);
    expect(got.own![1], `${id} own height`).toBeCloseTo(own[1], 1);
    expect(got.bounds![0], `${id} painted width`).toBeCloseTo(got.painted![0], 1);
    expect(got.bounds![1], `${id} painted height`).toBeCloseTo(got.painted![1], 1);
  }
});
