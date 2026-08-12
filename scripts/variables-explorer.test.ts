/**
 * The geometry behind the catalog panel's SVG import.
 *
 * This is the half of the feature that fails silently. A file picker that does
 * not open is obvious; a path fitted to the wrong box is a preview that renders
 * blank, or microscopic, or off the edge, and every one of those looks like a
 * composition that was always broken rather than an import that got the numbers
 * wrong. Nothing here touches the DOM, which is exactly the split: the browser
 * is trusted to resolve `transform` chains and measure bounding boxes, and
 * every number this file computes itself is asserted.
 *
 * The rejection paths are covered too, because "no shapes found" has to arrive
 * as a message rather than as an empty import.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The geometry, read out of the snippet and evaluated.
 *
 * Importing it would be better and is not available. Mintlify compiles a
 * snippet as MDX and carries each exported binding into the page on its own, so
 * a second `export const` beside `VariablesExplorer` is not in scope inside it:
 * the panel throws `isSvgPathData is not defined` and the page loses the whole
 * explorer. Verified on the running site, not assumed.
 *
 * So the functions live inside the component, between two markers, and this
 * reads the source between them. It is a real evaluation of the shipped bytes
 * rather than a copy that can drift, and it is plain JavaScript with no JSX,
 * which is what makes `new Function` enough. Renaming one of them fails here
 * loudly, which is the intent.
 */
const geometry = (() => {
  const snippet = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "docs",
    "snippets",
    "variables-explorer.jsx",
  );
  const source = readFileSync(snippet, "utf8");
  const open = source.indexOf("// >>> svg-import geometry");
  const close = source.indexOf("// <<< svg-import geometry");
  assert.ok(open !== -1 && close > open, "the svg-import geometry markers are missing");
  const names = [
    "isSvgPathData",
    "parsePathData",
    "normalisePathData",
    "arcToCubics",
    "transformPathData",
    "fitMatrix",
    "printPathData",
    "shapePathData",
  ];
  const body = `${source.slice(open, close)}\nreturn { ${names.join(", ")} };`;
  return new Function(body)() as Record<string, unknown>;
})();

/** `shapePathData` answers null for a tag it does not draw; every call here passes one it does. */
function drawn(d: string | null): string {
  assert.ok(d, "shapePathData returned null for a shape it should draw");
  return d;
}

/** Positional read that says which index went missing instead of yielding NaN. */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined)
    throw new Error(`index ${index} missing from a ${values.length}-item list`);
  return value;
}

const {
  arcToCubics,
  fitMatrix,
  isSvgPathData,
  normalisePathData,
  parsePathData,
  printPathData,
  shapePathData,
  transformPathData,
} = geometry as {
  arcToCubics: (...args: number[]) => { code: string; args: number[] }[];
  fitMatrix: (
    source: { x: number; y: number; width: number; height: number },
    target: { x: number; y: number; width: number; height: number },
  ) => { a: number; b: number; c: number; d: number; e: number; f: number };
  isSvgPathData: (value: unknown) => boolean;
  normalisePathData: (commands: unknown) => { code: string; args: number[] }[];
  parsePathData: (d: string) => { code: string; args: number[] }[];
  printPathData: (segments: { code: string; args: number[] }[]) => string;
  shapePathData: (tag: string, attrs: Record<string, string>) => string | null;
  transformPathData: (
    segments: { code: string; args: number[] }[],
    matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
  ) => { code: string; args: number[] }[];
};

/** Path data reduced to numbers, so an assertion can be about geometry. */
const points = (d: string): number[] =>
  normalisePathData(parsePathData(d)).flatMap((segment) => segment.args);

const codes = (d: string): string =>
  normalisePathData(parsePathData(d))
    .map((segment) => segment.code)
    .join("");

const close = (actual: number, expected: number, tolerance = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const closeAll = (actual: number[], expected: number[], tolerance = 1e-6): void => {
  assert.equal(
    actual.length,
    expected.length,
    `expected ${actual.length} numbers to be ${expected.length}`,
  );
  actual.forEach((value, index) => close(value, at(expected, index), tolerance));
};

/**
 * The bounding box the browser would measure, computed here from the tight
 * extremes of each segment. Cubic and quadratic extremes come from the roots of
 * the derivative, not from the control hull, because the hull is wider than the
 * curve and a fit computed from it would leave a visible margin.
 */
const boundsOf = (d: string): { x: number; y: number; width: number; height: number } => {
  const segments = normalisePathData(parsePathData(d));
  let x = 0;
  let y = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (px: number, py: number): void => {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  const cubicAt = (t: number, a: number, b: number, c: number, dd: number): number => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * dd;
  };

  for (const { code, args } of segments) {
    if (code === "M" || code === "L") {
      see(at(args, 0), at(args, 1));
      x = at(args, 0);
      y = at(args, 1);
    } else if (code === "Q") {
      // A quadratic is the cubic with both controls two thirds of the way out.
      const c1x = x + (2 / 3) * (at(args, 0) - x);
      const c1y = y + (2 / 3) * (at(args, 1) - y);
      const c2x = at(args, 2) + (2 / 3) * (at(args, 0) - at(args, 2));
      const c2y = at(args, 3) + (2 / 3) * (at(args, 1) - at(args, 3));
      for (let t = 0; t <= 1.0001; t += 0.002) {
        see(cubicAt(t, x, c1x, c2x, at(args, 2)), cubicAt(t, y, c1y, c2y, at(args, 3)));
      }
      x = at(args, 2);
      y = at(args, 3);
    } else if (code === "C") {
      for (let t = 0; t <= 1.0001; t += 0.002) {
        see(
          cubicAt(t, x, at(args, 0), at(args, 2), at(args, 4)),
          cubicAt(t, y, at(args, 1), at(args, 3), at(args, 5)),
        );
      }
      x = at(args, 4);
      y = at(args, 5);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

test("the control lands on path data and on nothing that merely looks like it", () => {
  // The two variables in the registry that carry path data today.
  assert.equal(
    isSvgPathData(
      "M 92 328 C 178 142 292 138 366 276 C 430 396 500 414 558 262 C 622 94 724 112 786 274 C 836 406 894 376 930 194",
    ),
    true,
  );
  assert.equal(
    isSvgPathData(
      "M -90 390 C 150 490 190 70 430 185 C 650 300 720 105 850 145 C 970 180 1030 85 1090 35",
    ),
    true,
  );
  assert.equal(isSvgPathData("m0 0l10 10"), true);
  assert.equal(isSvgPathData("  M.5.5 L1 1"), true);

  // Every other registry variable whose name or value could be mistaken for it.
  assert.equal(isSvgPathData("sweep"), false);
  assert.equal(isSvgPathData("bulb"), false);
  assert.equal(isSvgPathData("Marketing"), false);
  assert.equal(isSvgPathData("Momentum"), false);
  assert.equal(isSvgPathData("medium"), false);
  assert.equal(isSvgPathData(12), false);
  assert.equal(isSvgPathData(undefined), false);
});

test("relative commands become absolute", () => {
  closeAll(points("m 10 10 l 5 0 l 0 5 z"), [10, 10, 15, 10, 15, 15]);
  // A close returns the pen to the start of the subpath, so what follows is
  // measured from there and not from the last drawn point.
  closeAll(points("M 10 10 L 20 20 Z l 5 5"), [10, 10, 20, 20, 15, 15]);
});

test("a repeated coordinate pair after a moveto is a lineto", () => {
  assert.equal(codes("M 0 0 10 0 10 10"), "MLL");
  closeAll(points("M 0 0 10 0 10 10"), [0, 0, 10, 0, 10, 10]);
  // Relative, where the second pair is measured from the first.
  closeAll(points("m 5 5 5 0"), [5, 5, 10, 5]);
});

test("horizontal and vertical commands keep the coordinate they do not carry", () => {
  closeAll(points("M 10 20 H 40 V 60 h -10 v -10"), [10, 20, 40, 20, 40, 60, 30, 60, 30, 50]);
});

test("a smooth curve reflects the previous control point", () => {
  const smooth = normalisePathData(parsePathData("M 0 0 C 10 10 20 10 30 0 S 50 -10 60 0"));
  assert.deepEqual(
    smooth.map((segment) => segment.code),
    ["M", "C", "C"],
  );
  // Reflection of (20, 10) through the current point (30, 0).
  closeAll(at(smooth, 2).args, [40, -10, 50, -10, 60, 0]);

  // With no cubic in front of it, the reflection is the current point itself.
  const orphan = normalisePathData(parsePathData("M 5 5 S 20 20 30 5"));
  closeAll(at(orphan, 1).args, [5, 5, 20, 20, 30, 5]);
});

test("a smooth quadratic reflects the previous quadratic control point", () => {
  const smooth = normalisePathData(parsePathData("M 0 0 Q 10 20 20 0 T 40 0"));
  assert.deepEqual(
    smooth.map((segment) => segment.code),
    ["M", "Q", "Q"],
  );
  closeAll(at(smooth, 2).args, [30, -20, 40, 0]);
});

test("an arc becomes cubics that stay on the ellipse", () => {
  // A half circle of radius 50, left to right over the top.
  const segments = normalisePathData(parsePathData("M 0 0 A 50 50 0 0 1 100 0"));
  assert.deepEqual(
    segments.map((segment) => segment.code),
    ["M", "C", "C"],
  );
  // The endpoint is the authored one exactly, so a closed shape still closes.
  closeAll(at(segments, 2).args.slice(4), [100, 0]);

  const bounds = boundsOf("M 0 0 A 50 50 0 0 1 100 0");
  close(bounds.x, 0, 0.01);
  close(bounds.width, 100, 0.01);
  // Sweep 1 with y down is the arc below the chord.
  close(bounds.height, 50, 0.02);

  // A zero radius is a straight line, and coincident endpoints draw nothing.
  assert.deepEqual(arcToCubics(0, 0, 0, 10, 0, 0, 1, 10, 10), [{ code: "L", args: [10, 10] }]);
  assert.deepEqual(arcToCubics(5, 5, 10, 10, 0, 0, 1, 5, 5), []);

  // Radii too small to reach the far endpoint are grown until they just do,
  // which keeps the curve passing through both ends instead of falling short.
  const stretched = arcToCubics(0, 0, 1, 1, 0, 0, 1, 100, 0);
  closeAll(at(stretched, stretched.length - 1).args.slice(4), [100, 0]);
});

test("scale to fit preserves aspect ratio and centres", () => {
  // A 100 x 50 source into a 400 x 400 box: width is the binding dimension.
  const matrix = fitMatrix(
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 0, y: 0, width: 400, height: 400 },
  );
  close(matrix.a, 4);
  close(matrix.d, 4);
  assert.equal(matrix.b, 0);
  assert.equal(matrix.c, 0);
  // Centred: 50 units of height scale to 200, leaving 100 above and below.
  close(matrix.e, 0);
  close(matrix.f, 100);

  // The source's own origin is subtracted, so a shape that sits far from (0, 0)
  // arrives in the middle rather than in the same corner it started in.
  const offset = fitMatrix(
    { x: 900, y: 900, width: 100, height: 100 },
    { x: 0, y: 0, width: 200, height: 200 },
  );
  close(offset.a, 2);
  close(offset.e, 100 - 950 * 2);
  close(offset.f, 100 - 950 * 2);

  // The target's own origin is honoured too, which is what puts an import
  // inside the box a primitive's default occupies rather than at the top left.
  const placed = fitMatrix(
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 100, y: 200, width: 10, height: 10 },
  );
  close(placed.e, 100);
  close(placed.f, 200);
});

test("a flat source is sized by the dimension it has", () => {
  // A horizontal route has no height. Taking the smaller of the two ratios
  // blindly would scale it by zero and import an empty path.
  const matrix = fitMatrix(
    { x: 0, y: 10, width: 100, height: 0 },
    { x: 0, y: 0, width: 500, height: 300 },
  );
  close(matrix.a, 5);
  close(matrix.f, 150 - 10 * 5);
});

test("the two shipped defaults keep their own geometry when refitted to themselves", () => {
  const defaults = [
    "M 92 328 C 178 142 292 138 366 276 C 430 396 500 414 558 262 C 622 94 724 112 786 274 C 836 406 894 376 930 194",
    "M -90 390 C 150 490 190 70 430 185 C 650 300 720 105 850 145 C 970 180 1030 85 1090 35",
  ];
  for (const d of defaults) {
    const source = boundsOf(d);
    const refitted = printPathData(
      transformPathData(normalisePathData(parsePathData(d)), fitMatrix(source, source)),
    );
    const after = boundsOf(refitted);
    close(after.x, source.x, 0.01);
    close(after.y, source.y, 0.01);
    close(after.width, source.width, 0.01);
    close(after.height, source.height, 0.01);
  }
});

test("an import lands inside the box the default occupies", () => {
  // A 24 unit icon, the size a real file arrives at, into the stroke trace's
  // own default. Lifted verbatim it would be a speck in the top left corner.
  const target = boundsOf(
    "M 92 328 C 178 142 292 138 366 276 C 430 396 500 414 558 262 C 622 94 724 112 786 274 C 836 406 894 376 930 194",
  );
  const icon = "M 2 2 L 22 2 L 22 22 L 2 22 Z";
  const source = boundsOf(icon);
  const fitted = boundsOf(
    printPathData(
      transformPathData(normalisePathData(parsePathData(icon)), fitMatrix(source, target)),
    ),
  );

  // Square in, square out.
  close(fitted.width, fitted.height, 0.01);
  // Bound by the shorter dimension of the target, and centred in the longer.
  close(fitted.height, target.height, 0.01);
  close(fitted.x + fitted.width / 2, target.x + target.width / 2, 0.01);
  close(fitted.y + fitted.height / 2, target.y + target.height / 2, 0.01);
  // Inside the target box on both axes, which is what "not clipped" means here.
  assert.ok(
    fitted.x >= target.x - 0.01 && fitted.x + fitted.width <= target.x + target.width + 0.01,
  );
});

test("a matrix moves every point of every command", () => {
  const segments = normalisePathData(parsePathData("M 1 2 L 3 4 C 5 6 7 8 9 10 Q 11 12 13 14 Z"));
  // A rotation and a mirror, which is where a command carrying anything other
  // than x/y pairs would go wrong.
  const moved = transformPathData(segments, { a: 0, b: 1, c: -1, d: 0, e: 100, f: 200 });
  closeAll(at(moved, 0).args, [98, 201]);
  closeAll(at(moved, 1).args, [96, 203]);
  closeAll(at(moved, 2).args, [94, 205, 92, 207, 90, 209]);
  closeAll(at(moved, 3).args, [88, 211, 86, 213]);
  assert.deepEqual(at(moved, 4), { code: "Z", args: [] });
});

test("rect, circle, ellipse, line, polyline and polygon become path data", () => {
  assert.equal(
    drawn(shapePathData("rect", { x: "10", y: "20", width: "30", height: "40" })),
    "M 10 20 H 40 V 60 H 10 Z",
  );

  // A rounded rect: eight corners' worth of geometry, and the corners survive
  // the reduction as cubics.
  const rounded = drawn(shapePathData("rect", { width: "100", height: "60", rx: "10" }));
  assert.equal(codes(rounded), "MLCLCLCLCZ");
  const roundedBounds = boundsOf(rounded);
  closeAll(
    [roundedBounds.x, roundedBounds.y, roundedBounds.width, roundedBounds.height],
    [0, 0, 100, 60],
    0.01,
  );

  // One radius declared defines both, which is what a file exported with only
  // `rx` relies on, and a radius past half the side is clamped to it.
  const clamped = boundsOf(drawn(shapePathData("rect", { width: "40", height: "40", ry: "500" })));
  closeAll([clamped.width, clamped.height], [40, 40], 0.01);

  const circle = boundsOf(drawn(shapePathData("circle", { cx: "50", cy: "50", r: "25" })));
  closeAll([circle.x, circle.y, circle.width, circle.height], [25, 25, 50, 50], 0.05);

  const ellipse = boundsOf(
    drawn(shapePathData("ellipse", { cx: "0", cy: "0", rx: "40", ry: "10" })),
  );
  closeAll([ellipse.width, ellipse.height], [80, 20], 0.05);

  assert.equal(
    drawn(shapePathData("line", { x1: "0", y1: "0", x2: "10", y2: "5" })),
    "M 0 0 L 10 5",
  );
  assert.equal(
    drawn(shapePathData("polyline", { points: "0,0 10,10 20,0" })),
    "M 0 0 L 10 10 L 20 0",
  );
  assert.equal(
    drawn(shapePathData("polygon", { points: "0 0 10 10 20 0" })),
    "M 0 0 L 10 10 L 20 0 Z",
  );
  assert.equal(drawn(shapePathData("path", { d: "M 0 0 L 1 1" })), "M 0 0 L 1 1");
});

test("a shape with nothing to draw is refused rather than imported as nothing", () => {
  assert.equal(shapePathData("rect", { width: "0", height: "10" }), null);
  assert.equal(shapePathData("circle", { r: "0" }), null);
  assert.equal(shapePathData("ellipse", { rx: "10" }), null);
  assert.equal(shapePathData("line", { x1: "5", y1: "5", x2: "5", y2: "5" }), null);
  assert.equal(shapePathData("polygon", { points: "1,1" }), null);
  assert.equal(shapePathData("path", { d: "   " }), null);
  // Not a shape at all. `<text>` is the one the panel names in its message.
  assert.equal(shapePathData("text", { x: "0" }), null);
  assert.equal(shapePathData("image", { href: "a.png" }), null);
});

test("malformed path data throws instead of producing half a path", () => {
  assert.throws(() => parsePathData("10 20 30"), /must open with a command/);
  assert.throws(() => parsePathData("M 10"), /expected a number/);
  assert.throws(() => parsePathData("M 0 0 X 1 2"), /unknown command/);
  assert.throws(() => parsePathData("M 0 0 A 5 5 0 9 1 10 10"), /expected an arc flag/);
  assert.throws(() => parsePathData("M 0 0 Z 5 5"), /expected a command/);
  assert.throws(() => parsePathData("   "), /empty/);
});

test("the grammar's compact spellings are read the way a browser reads them", () => {
  // No separator between a number and the next sign, and a leading dot.
  closeAll(points("M0 0L-1-2L.5.25"), [0, 0, -1, -2, 0.5, 0.25]);
  // Exponents, which the number scanner has to take and the command scanner
  // has to not mistake for an `e` command.
  closeAll(points("M 1e2 2E1 L 1.5e-1 0"), [100, 20, 0.15, 0]);
  // Arc flags written as bare adjacent digits, which is legal and common in
  // minified output: rx=1 ry=1 rotation=0 largeArc=0 sweep=1 x=1 y=1.
  const arc = normalisePathData(parsePathData("M 0 0 a1 1 0 011 1"));
  closeAll(at(arc, arc.length - 1).args.slice(4), [1, 1]);
});

test("printing keeps two decimals and drops a negative zero", () => {
  assert.equal(printPathData([{ code: "M", args: [1.23456, -0.001] }]), "M 1.23 0");
  assert.equal(printPathData([{ code: "Z", args: [] }]), "Z");
  // Spaces, which is the reason the query encoding on this path had to be
  // fixed: form encoding turns each of these into a `+` and the `d` is invalid.
  assert.ok(printPathData([{ code: "M", args: [0, 0] }]).includes(" "));
});
