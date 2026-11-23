// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  htmlInCanvasForm,
  markCaptureCanvas,
  markCaptured,
  unmarkCaptured,
  CAPTURE_CANVAS_SELECTOR,
} from "./htmlInCanvas";
import { supportsCaptureMotionBlur } from "./pageMotionBlur";

const canvasProto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
const CANVAS_MEMBERS = ["requestPaint", "layoutSubtree", "updateElementGeometry"];

function install(canvasMembers: string[], drawElementImage = true): void {
  vi.stubGlobal(
    "CanvasRenderingContext2D",
    drawElementImage
      ? class {
          drawElementImage(): void {}
        }
      : class {},
  );
  for (const name of canvasMembers) canvasProto[name] = () => {};
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of CANVAS_MEMBERS) delete canvasProto[name];
});

describe("htmlInCanvasForm", () => {
  it("is layoutsubtree where the canvas has layoutSubtree, even if it also has updateElementGeometry", () => {
    install(["requestPaint", "layoutSubtree", "updateElementGeometry"]);
    expect(htmlInCanvasForm()).toBe("layoutsubtree");
  });

  it("is drawable where layoutSubtree is gone and updateElementGeometry is there", () => {
    install(["requestPaint", "updateElementGeometry"]);
    expect(htmlInCanvasForm()).toBe("drawable");
  });

  it("is null when neither form is there", () => {
    install(["requestPaint"]);
    expect(htmlInCanvasForm()).toBeNull();
  });

  it("is null without drawElementImage or without requestPaint", () => {
    install(["requestPaint", "layoutSubtree"], false);
    expect(htmlInCanvasForm()).toBeNull();
    vi.unstubAllGlobals();
    delete canvasProto.requestPaint;
    install(["layoutSubtree"]);
    expect(htmlInCanvasForm()).toBeNull();
  });
});

describe("supportsCaptureMotionBlur", () => {
  it.each([
    ["old form", ["requestPaint", "layoutSubtree"], true],
    ["new form", ["requestPaint", "updateElementGeometry"], true],
    ["API present but no known form", ["requestPaint"], false],
  ])("%s", (_name, members, expected) => {
    install(members);
    expect(supportsCaptureMotionBlur()).toBe(expected);
  });
});

describe("marking", () => {
  it("marks the old form with layoutsubtree and leaves children alone", () => {
    const canvas = document.createElement("canvas");
    const child = document.createElement("div");
    markCaptureCanvas(canvas, "layoutsubtree");
    markCaptured(child, "layoutsubtree");
    expect(canvas.hasAttribute("layoutsubtree")).toBe(true);
    expect(canvas.hasAttribute("content")).toBe(false);
    expect(child.hasAttribute("drawable")).toBe(false);
  });

  it("marks the new form with content=drawable and drawable children, and unmarks them", () => {
    const canvas = document.createElement("canvas");
    const child = document.createElement("div");
    markCaptureCanvas(canvas, "drawable");
    markCaptured(child, "drawable");
    expect(canvas.getAttribute("content")).toBe("drawable");
    expect(canvas.hasAttribute("layoutsubtree")).toBe(false);
    expect(child.hasAttribute("drawable")).toBe(true);
    unmarkCaptured(child, "drawable");
    expect(child.hasAttribute("drawable")).toBe(false);
  });

  it("finds a nested capture canvas of either form", () => {
    for (const mark of [
      (c: HTMLElement) => c.setAttribute("layoutsubtree", ""),
      (c: HTMLElement) => c.setAttribute("content", "drawable"),
    ]) {
      const root = document.createElement("div");
      const canvas = document.createElement("canvas");
      mark(canvas);
      root.append(canvas);
      expect(root.querySelector(CAPTURE_CANVAS_SELECTOR)).toBe(canvas);
    }
    const plain = document.createElement("div");
    plain.append(document.createElement("canvas"));
    expect(plain.querySelector(CAPTURE_CANVAS_SELECTOR)).toBeNull();
  });
});
