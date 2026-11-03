import { afterEach, describe, expect, it, vi } from "vitest";
import { watchSceneWebglContexts } from "./webglContextRecovery";

function canvas() {
  const el = document.createElement("canvas");
  document.body.appendChild(el);
  return el;
}

describe("watchSceneWebglContexts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("lets a scene canvas restore, then repaints once after its own restore handler", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    const order: string[] = [];
    const repaint = vi.fn(() => order.push("repaint"));
    const stop = watchSceneWebglContexts(repaint);
    const scene = canvas();
    scene.addEventListener("webglcontextrestored", () => order.push("scene"));

    const lost = new Event("webglcontextlost", { cancelable: true });
    scene.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);

    scene.dispatchEvent(new Event("webglcontextrestored"));
    canvas().dispatchEvent(new Event("webglcontextrestored"));
    expect(repaint).not.toHaveBeenCalled();
    frames.splice(0).forEach((cb) => cb(0));
    expect(order).toEqual(["scene", "repaint"]);
    stop();
  });

  it("does nothing after it is stopped", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const repaint = vi.fn();
    watchSceneWebglContexts(repaint)();
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas().dispatchEvent(lost);
    canvas().dispatchEvent(new Event("webglcontextrestored"));
    expect(lost.defaultPrevented).toBe(false);
    expect(raf).not.toHaveBeenCalled();
  });
});
