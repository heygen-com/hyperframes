import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMoverFrames } from "./frames";
import { type Affine, IDENTITY, translate } from "./pose";

/** Fixed layout for jsdom: an element's offset box and its client rect. */
function laidOut(el: HTMLElement, w: number, h: number, rect: [number, number, number, number]) {
  Object.defineProperty(el, "offsetWidth", { value: w, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: h, configurable: true });
  const [left, top, right, bottom] = rect;
  el.getBoundingClientRect = () =>
    ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;
}

const rect = ([left, top, right, bottom]: [number, number, number, number]) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;

/** jsdom has no Range rects: the text inside a node measures as `of(node)`. */
function textRects(of: (node: Node) => [number, number, number, number]) {
  let node: Node | null = null;
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto.selectNodeContents = (n: Node) => {
    node = n;
  };
  proto.getBoundingClientRect = () => rect(node ? of(node) : [0, 0, 0, 0]);
}

function read(mover: HTMLElement, scene: HTMLElement, pose: Affine) {
  return readMoverFrames({
    movers: [mover],
    reader: { pose: () => pose, reset: () => {} } as never,
    seek: () => {},
    t: 0.5,
    reads: 2,
    shutterSeconds: 1 / 45,
    taps: 4,
    frameW: 1920,
    frameH: 1080,
    scene,
  }).frames[0];
}

const RANGE_STUBS = ["selectNodeContents", "getBoundingClientRect"];
const realRange = RANGE_STUBS.map(
  (k) => (Range.prototype as unknown as Record<string, unknown>)[k],
);

describe("readMoverFrames", () => {
  beforeEach(() => textRects(() => [0, 0, 0, 0]));
  afterEach(() => {
    RANGE_STUBS.forEach((k, i) => {
      (Range.prototype as unknown as Record<string, unknown>)[k] = realRange[i];
    });
    document.body.innerHTML = "";
  });

  // A wordmark in a 540 px box whose one-line text runs to 1528 px: the box is the layout, the
  // text is the picture. Cropping to the box drew "HyperFra" for "HyperFrames Studio".
  it("sizes the redraw to content that overflows the mover's box", () => {
    const scene = document.createElement("div");
    const brand = document.createElement("div");
    const word = document.createElement("div");
    brand.append(word);
    scene.append(brand);
    document.body.append(scene);
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(brand, 540, 240, [100, 50, 640, 290]);
    laidOut(word, 1528, 240, [100, 50, 1628, 290]);
    const pose = translate(IDENTITY, 100, 50);
    const reader = { pose: () => pose, reset: () => {} };
    let x = 0;
    const { frames } = readMoverFrames({
      movers: [brand],
      reader: reader as never,
      seek: (t) => {
        x = t;
      },
      t: 0.5,
      reads: 2,
      shutterSeconds: 1 / 45,
      taps: 4,
      frameW: 1920,
      frameH: 1080,
      scene,
    });
    expect(x).toBe(0.5);
    expect(frames[0]?.w).toBeGreaterThanOrEqual(1528);
    expect(frames[0]?.h).toBeGreaterThanOrEqual(240);
  });

  it("keeps the box as it is when its content stays inside", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    const child = document.createElement("span");
    box.append(child);
    scene.append(box);
    document.body.append(scene);
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(box, 200, 100, [10, 10, 210, 110]);
    laidOut(child, 50, 20, [20, 20, 70, 40]);
    const pose = translate(IDENTITY, 10, 10);
    const { frames } = readMoverFrames({
      movers: [box],
      reader: { pose: () => pose, reset: () => {} } as never,
      seek: () => {},
      t: 0.5,
      reads: 2,
      shutterSeconds: 1 / 45,
      taps: 4,
      frameW: 1920,
      frameH: 1080,
      scene,
    });
    expect(frames[0]).toMatchObject({ w: 200, h: 100, now: pose });
  });
  // A block child is as wide as the mover however long its text: only the text's own rects show it.
  it("sizes the redraw to text that overflows a block child", () => {
    const scene = document.createElement("div");
    const brand = document.createElement("div");
    const word = document.createElement("div");
    word.textContent = "HyperFrames Studio";
    brand.append(word);
    scene.append(brand);
    document.body.append(scene);
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(brand, 540, 110, [100, 50, 640, 160]);
    laidOut(word, 540, 110, [100, 50, 640, 160]);
    textRects(() => [100, 50, 981, 160]);
    expect(read(brand, scene, translate(IDENTITY, 100, 50))?.w).toBe(881);
  });

  // Upright client rects of a rotated mover's children cover its corners, not its content.
  it("keeps a rotated mover's box when its content stays inside", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    const fill = document.createElement("div");
    box.append(fill);
    scene.append(box);
    document.body.append(scene);
    const c = Math.SQRT1_2;
    const upright: [number, number, number, number] = [1059, 600, 1341, 883];
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(box, 200, 200, upright);
    laidOut(fill, 200, 200, upright);
    textRects(() => upright);
    const frame = read(box, scene, { a: c, b: c, c: -c, d: c, e: 1200, f: 600 });
    expect(frame).toMatchObject({ w: 200, h: 200 });
  });

  // Its unrotated text at local y 90-110 runs to x 260; rotated, that lands in the upright rect's corner.
  it("sizes a rotated mover's redraw to text that overflows it", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    box.setAttribute("style", "transform: rotate(45deg)");
    box.textContent = "HyperFrames";
    scene.append(box);
    document.body.append(scene);
    const c = Math.SQRT1_2;
    const rotated: Affine = { a: c, b: c, c: -c, d: c, e: 1200, f: 600 };
    const unrotated = translate(IDENTITY, 1100, 600);
    const off = () => box.getAttribute("style")?.includes("transform: none") ?? false;
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(box, 200, 200, [0, 0, 0, 0]);
    box.getBoundingClientRect = () => rect(off() ? [1100, 600, 1300, 800] : [1059, 600, 1341, 883]);
    textRects(() => (off() ? [1100, 690, 1360, 710] : [1122, 663, 1320, 862]));
    const frame = readMoverFrames({
      movers: [box],
      reader: { pose: () => (off() ? unrotated : rotated), reset: () => {} } as never,
      seek: () => {},
      t: 0.5,
      reads: 2,
      shutterSeconds: 1 / 45,
      taps: 4,
      frameW: 1920,
      frameH: 1080,
      scene,
    }).frames[0];
    expect(frame).toMatchObject({ w: 260, h: 200 });
    expect(box.getAttribute("style")).toBe("transform: rotate(45deg)");
  });

  // transform: none alone would move an absolute child to an outer containing block while measured.
  it("keeps a rotated mover the containing block while it is measured", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    const tag = document.createElement("div");
    box.setAttribute("style", "transform: rotate(45deg)");
    box.append(tag);
    scene.append(box);
    document.body.append(scene);
    const c = Math.SQRT1_2;
    const held = () => box.getAttribute("style")?.includes("will-change: transform") ?? false;
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(box, 200, 200, [1100, 600, 1300, 800]);
    laidOut(tag, 100, 20, [0, 0, 0, 0]);
    tag.getBoundingClientRect = () => rect(held() ? [1400, 690, 1500, 710] : [300, 90, 400, 110]);
    const rotated: Affine = { a: c, b: c, c: -c, d: c, e: 1200, f: 600 };
    const unrotated = translate(IDENTITY, 1100, 600);
    const off = () => box.getAttribute("style")?.includes("transform: none") ?? false;
    const frame = readMoverFrames({
      movers: [box],
      reader: { pose: () => (off() ? unrotated : rotated), reset: () => {} } as never,
      seek: () => {},
      t: 0.5,
      reads: 2,
      shutterSeconds: 1 / 45,
      taps: 4,
      frameW: 1920,
      frameH: 1080,
      scene,
    }).frames[0];
    expect(frame).toMatchObject({ w: 400, h: 200, origin: [0, 0] });
  });

  it("leaves a mover turned only by an ancestor untouched", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    scene.append(box);
    document.body.append(scene);
    const c = Math.SQRT1_2;
    const styles: Array<string | null> = [];
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(box, 200, 200, [1059, 600, 1341, 883]);
    const measure = box.getBoundingClientRect;
    box.getBoundingClientRect = () => {
      styles.push(box.getAttribute("style"));
      return measure();
    };
    read(box, scene, { a: c, b: c, c: -c, d: c, e: 1200, f: 600 });
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((s) => s === null)).toBe(true);
  });
});
