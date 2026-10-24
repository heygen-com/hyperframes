import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CaptureMotionBlurHost,
  captureMotionBlurBusy,
  initCaptureMotionBlur,
  paintCaptureMotionBlur,
  releaseCaptureMotionBlurFrame,
  resetCaptureMotionBlurForTests,
  setFilterFallbackForTests,
  trackAcceleratedCanvases,
} from ".";

type Win = Window & {
  __HF_PAGE_MOTION_BLUR_OFF__?: unknown;
  __hfMotionBlur?: {
    report: () => {
      state: string;
      reason: string | null;
      shutterDeg: number;
      moverNames: string[];
      failedFrames: number;
    };
    suspend: () => void;
  };
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_resolve?: () => boolean;
};
const win = window as Win;

// Every 2D context (page canvas or offscreen) is this recording fake.
function fakeContext() {
  return {
    reset: vi.fn(),
    drawElementImage: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
}
let contexts: Array<ReturnType<typeof fakeContext>> = [];
const captureContext = () => contexts[0];

function installHtmlInCanvas(form: "old" | "new" = "old"): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const ctx = fakeContext();
    contexts.push(ctx);
    return ctx as never;
  });
  vi.stubGlobal(
    "CanvasRenderingContext2D",
    class {
      drawElementImage(): void {}
    },
  );
  const canvasProto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  canvasProto.requestPaint = () => {};
  if (form === "old") canvasProto.layoutSubtree = false;
  else canvasProto.updateElementGeometry = () => {};
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return fakeContext();
      }
    },
  );
}

function makeRoot(attrs: Record<string, string> = { "data-motion-blur": "on" }): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-composition-id", "main");
  root.setAttribute("data-width", "640");
  root.setAttribute("data-height", "360");
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  document.body.append(root);
  return root;
}

function host(
  root: HTMLElement,
  seek = vi.fn(),
): CaptureMotionBlurHost & { seek: ReturnType<typeof vi.fn> } {
  return { root, fps: 30, durationSeconds: () => 1, timeline: () => "tl", now: () => 0, seek };
}

const captureCanvas = (root: HTMLElement) => root.parentElement as HTMLCanvasElement;

beforeEach(() => {
  setFilterFallbackForTests(false);
  contexts = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetCaptureMotionBlurForTests();
  setFilterFallbackForTests(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const name of ["requestPaint", "layoutSubtree", "updateElementGeometry"]) {
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)[name];
  }
  delete win.__HF_PAGE_MOTION_BLUR_OFF__;
  delete win.__hfMotionBlur;
  delete win.__hf_page_composite_pending;
  delete win.__hf_page_composite_resolve;
  Reflect.deleteProperty(document, "visibilityState");
  document.body.innerHTML = "";
});

/** A root with one 10×10 element that slides 300 px over the 1 s composition (10 px/frame). */
function movingHost(attrs?: Record<string, string>) {
  const root = makeRoot(attrs);
  const el = document.createElement("div");
  el.id = "slider";
  root.append(el);
  for (const [k, v] of Object.entries({
    offsetWidth: 10,
    offsetHeight: 10,
    offsetLeft: 0,
    offsetTop: 0,
    offsetParent: root,
  })) {
    Object.defineProperty(el, k, { value: v, configurable: true });
  }
  const x = () => Number(/,\s*([-\d.]+),\s*0\)$/.exec(el.style.transform)?.[1] ?? 0);
  el.getBoundingClientRect = () =>
    ({ left: x(), top: 0, right: x() + 10, bottom: 10, width: 10, height: 10 }) as DOMRect;
  const seek = vi.fn((t: number) => {
    el.style.transform = `matrix(1, 0, 0, 1, ${300 * t}, 0)`;
  });
  return { root, el, h: host(root, seek) };
}

const PLAY = { playing: true };

describe("opt-in and off switches", () => {
  it("does nothing for a root that has not opted in", () => {
    installHtmlInCanvas();
    const root = makeRoot({});
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
    expect(paintCaptureMotionBlur(0)).toBeNull();
    expect(win.__hfMotionBlur).toBeUndefined();
  });

  it("stays off without html-in-canvas and says why", () => {
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reason: expect.stringContaining("html-in-canvas"),
    });
  });

  it("stays off in a browser with canvas but without drawElementImage (stable Chrome)", () => {
    installHtmlInCanvas();
    vi.stubGlobal("CanvasRenderingContext2D", class {});
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
  });

  it("stays off while the engine's own sub-frame blur is on (never both)", () => {
    installHtmlInCanvas();
    win.__HF_PAGE_MOTION_BLUR_OFF__ = "engine-motion-blur";
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(paintCaptureMotionBlur(0.5, PLAY)).toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().reason).toContain("engine");
  });

  it("names a distributed render as the reason when the renderer turned blur off (R19)", () => {
    installHtmlInCanvas();
    win.__HF_PAGE_MOTION_BLUR_OFF__ = "distributed-render";
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(paintCaptureMotionBlur(0.5, { engineMode: true })).toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reason: "the renderer turned it off (distributed-render)",
      reasonCode: "renderer-off",
    });
  });

  it("says why it is off to a root that asked for it", () => {
    initCaptureMotionBlur(host(makeRoot()));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("html-in-canvas"));
  });

  it("stays off when the composition already nests a capture canvas", () => {
    installHtmlInCanvas();
    const root = makeRoot();
    const inner = document.createElement("canvas");
    inner.setAttribute("layoutsubtree", "");
    root.append(inner);
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
  });

  it("stays off for a WebGL canvas, which html-in-canvas captures frozen, but not for a 2D one", () => {
    installHtmlInCanvas();
    trackAcceleratedCanvases();
    const root = makeRoot();
    const flat = document.createElement("canvas");
    root.append(flat);
    flat.getContext("2d");
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().state).toBe("on");

    resetCaptureMotionBlurForTests();
    const gl = document.createElement("canvas");
    root.append(gl);
    gl.getContext("webgl");
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().reason).toMatch(/WebGL/);
  });

  it("stays off for a canvas handed to an OffscreenCanvas, whose context is out of reach", () => {
    installHtmlInCanvas();
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).transferControlToOffscreen =
      () => ({});
    trackAcceleratedCanvases();
    const root = makeRoot();
    const canvas = document.createElement("canvas");
    root.append(canvas);
    canvas.transferControlToOffscreen();
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reasonCode: "accelerated-canvas",
    });
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
      .transferControlToOffscreen;
  });

  it("turns off instead of wrapping when a WebGL canvas appears after init", () => {
    installHtmlInCanvas();
    trackAcceleratedCanvases();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const late = document.createElement("canvas");
    root.append(late);
    late.getContext("webgl2");
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().reason).toMatch(/WebGL/);
  });

  it("stays off for an iframe in the root, which reloads when the root is wrapped (R9)", () => {
    installHtmlInCanvas();
    const root = makeRoot();
    root.append(document.createElement("iframe"));
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reasonCode: "iframe-in-root",
    });
  });

  it("turns off instead of wrapping when an iframe appears after init (R9)", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    root.append(document.createElement("iframe"));
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().reasonCode).toBe("iframe-in-root");
  });

  it("stays off for a hidden-backface card in a 3D context, but not for a flat one", () => {
    installHtmlInCanvas();
    const flat = makeRoot();
    flat.innerHTML = '<div style="backface-visibility: hidden"></div>';
    initCaptureMotionBlur(host(flat));
    expect(win.__hfMotionBlur?.report().state).toBe("on");

    resetCaptureMotionBlurForTests();
    flat.innerHTML =
      '<div style="transform-style: preserve-3d"><div style="backface-visibility: hidden"></div></div>';
    initCaptureMotionBlur(host(flat));
    expect(win.__hfMotionBlur?.report().state).toBe("off");
    expect(win.__hfMotionBlur?.report().reason).toMatch(/backface-visibility/);
  });

  it("turns off instead of wrapping when the root gets a transform or opacity after init", () => {
    installHtmlInCanvas();
    for (const style of ["transform: scale(0.5)", "opacity: 0.5"]) {
      const { root, h } = movingHost();
      initCaptureMotionBlur(h);
      root.setAttribute("style", style);
      void paintCaptureMotionBlur(0.5, { engineMode: true });
      expect(root.parentElement).toBe(document.body);
      expect(win.__hfMotionBlur?.report().state).toBe("off");
      expect(win.__hfMotionBlur?.report().reason).toMatch(/root/);
      resetCaptureMotionBlurForTests();
      document.body.innerHTML = "";
    }
  });

  it("rescans for a hidden-backface card when the timeline changes", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    let tl = "a";
    initCaptureMotionBlur({ ...h, timeline: () => tl });
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(win.__hfMotionBlur?.report().state).toBe("on");
    root.insertAdjacentHTML(
      "beforeend",
      '<div style="transform-style: preserve-3d"><div style="backface-visibility: hidden"></div></div>',
    );
    tl = "b";
    void paintCaptureMotionBlur(0.6, { engineMode: true });
    expect(win.__hfMotionBlur?.report().reason).toMatch(/backface-visibility/);
  });

  it("blocks from the first frame a root that only starts tweening later", () => {
    installHtmlInCanvas();
    for (const late of [
      (root: HTMLElement) => (root.style.transform = "translateX(8px)"),
      (root: HTMLElement) => (root.style.opacity = "0.4"),
    ]) {
      const { root, h } = movingHost();
      const slide = h.seek;
      initCaptureMotionBlur({
        ...h,
        seek: (t, quiet) => {
          slide(t, quiet);
          if (t >= 0.7) late(root);
          else root.removeAttribute("style");
        },
      });
      void paintCaptureMotionBlur(0, { engineMode: true });
      expect(root.parentElement).toBe(document.body);
      expect(win.__hfMotionBlur?.report()).toMatchObject({
        state: "off",
        reason: expect.stringMatching(/root.*first seen at t=0\.[7-9]s/),
      });
      resetCaptureMotionBlurForTests();
      document.body.innerHTML = "";
    }
  });

  it("restores the playhead after a scan that blocked", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur({
      ...h,
      seek: (t, quiet) => {
        h.seek(t, quiet);
        root.style.opacity = t > 0.5 ? "0.5" : "1";
      },
    });
    void paintCaptureMotionBlur(0.25, { engineMode: true });
    expect(h.seek.mock.calls.at(-1)?.[0]).toBeCloseTo(0.25);
    expect(win.__hfMotionBlur?.report().state).toBe("off");
  });

  it("sees a rotation that a later tween puts on a face with no 3D context at the start", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    const face = document.createElement("div");
    face.setAttribute("style", "backface-visibility: hidden");
    root.append(face);
    initCaptureMotionBlur({
      ...h,
      seek: (t, quiet) => {
        h.seek(t, quiet);
        face.style.transform = t > 0.5 ? "rotateY(120deg)" : "none";
      },
    });
    void paintCaptureMotionBlur(0, { engineMode: true });
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().reason).toMatch(/backface-visibility.*first seen/);
  });

  it("keeps blurring around a flat backface-hidden element that moves in 2D", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    const face = document.createElement("div");
    face.setAttribute("style", "backface-visibility: hidden");
    root.append(face);
    initCaptureMotionBlur({
      ...h,
      seek: (t, quiet) => {
        h.seek(t, quiet);
        face.style.transform = `translateX(${t * 50}px)`;
      },
    });
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(root.parentElement).toBe(captureCanvas(root));
    expect(win.__hfMotionBlur?.report().state).toBe("on");
  });

  describe("a defect the scan missed renders that frame sharp (R10)", () => {
    const sharpLogs = () =>
      vi.mocked(console.info).mock.calls.filter(([m]) => String(m).includes("sharp frame"));

    function engineFrame(h: ReturnType<typeof movingHost>["h"], t: number) {
      h.seek(t, true);
      void paintCaptureMotionBlur(t, { engineMode: true });
    }

    it("a WebGL canvas that appears and goes away: sharp meanwhile, blurred again after", () => {
      installHtmlInCanvas();
      trackAcceleratedCanvases();
      const { root, h } = movingHost();
      initCaptureMotionBlur(h);
      engineFrame(h, 0.1);
      expect(root.parentElement?.tagName).toBe("CANVAS");
      const late = document.createElement("canvas");
      root.append(late);
      late.getContext("webgl2");
      for (const t of [0.2, 0.3, 0.4]) {
        engineFrame(h, t);
        expect(root.parentElement).toBe(document.body);
      }
      late.remove();
      engineFrame(h, 0.5);
      expect(root.parentElement?.tagName).toBe("CANVAS");
      expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failedFrames: 3 });
      expect(sharpLogs()).toHaveLength(1);
      expect(sharpLogs()[0]?.[0]).toContain("accelerated-canvas");
    });

    it("a root shake between scan samples: only the shaken frames are sharp, state stays on", () => {
      installHtmlInCanvas();
      const { root, h } = movingHost();
      initCaptureMotionBlur(h);
      engineFrame(h, 0.1);
      const wrappedAt: Record<string, boolean> = {};
      for (const t of [0.2, 0.25, 0.3, 0.35, 0.4]) {
        root.style.transform = t > 0.22 && t < 0.36 ? "translate(6px, 0px)" : "";
        engineFrame(h, t);
        wrappedAt[t] = root.parentElement?.tagName === "CANVAS";
      }
      expect(wrappedAt).toEqual({ 0.2: true, 0.25: false, 0.3: false, 0.35: false, 0.4: true });
      expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failedFrames: 3 });
      expect(sharpLogs()).toHaveLength(1);
    });

    it("a hidden face flipped between the scan's backface samples", () => {
      installHtmlInCanvas();
      const { root, h } = movingHost();
      const face = document.createElement("div");
      face.setAttribute("style", "backface-visibility: hidden");
      root.append(face);
      const flip = (t: number, suppress: boolean) => {
        h.seek(t, suppress);
        face.style.transform = t > 0.4 && t < 0.5 ? "rotateY(120deg)" : "none";
      };
      initCaptureMotionBlur({ ...h, seek: flip });
      flip(0.2, true);
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hfMotionBlur?.report().state).toBe("on");
      expect(root.parentElement?.tagName).toBe("CANVAS");
      flip(0.45, true);
      void paintCaptureMotionBlur(0.45, { engineMode: true });
      expect(root.parentElement).toBe(document.body);
      flip(0.6, true);
      void paintCaptureMotionBlur(0.6, { engineMode: true });
      expect(root.parentElement?.tagName).toBe("CANVAS");
      expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failedFrames: 1 });
      expect(sharpLogs()[0]?.[0]).toContain("backface-visibility");
    });

    it("an engine frame that is sharp resolves at once and leaves the composite step idle", async () => {
      installHtmlInCanvas();
      trackAcceleratedCanvases();
      const { root, h } = movingHost();
      initCaptureMotionBlur(h);
      engineFrame(h, 0.1);
      const late = document.createElement("canvas");
      root.append(late);
      late.getContext("webgl2");
      win.__hf_page_composite_pending = false;
      h.seek(0.2, true);
      await paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hf_page_composite_pending).toBe(false);
    });
  });

  it("clamps the shutter angle", () => {
    installHtmlInCanvas();
    const root = makeRoot({ "data-motion-blur": "on", "data-motion-blur-shutter": "9999" });
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().shutterDeg).toBe(720);
  });
});

describe("wrapping", () => {
  it("wraps the root itself in a capture canvas, with an output canvas after it", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(root.parentElement).toBe(document.body); // not until it plays
    void paintCaptureMotionBlur(0.5, PLAY);
    const src = captureCanvas(root);
    expect(src.tagName).toBe("CANVAS");
    expect(src.hasAttribute("layoutsubtree")).toBe(true);
    expect(src.hasAttribute("content")).toBe(false);
    expect(root.hasAttribute("drawable")).toBe(false);
    expect(src.hasAttribute("data-hf-ignore")).toBe(true);
    expect([src.width, src.height]).toEqual([640, 360]);
    const out = src.nextElementSibling as HTMLElement;
    expect(out.getAttribute("data-hf-motion-blur")).toBe("output");
    // The output sits over the composition: clicks must reach what is under it.
    expect(out.style.pointerEvents).toBe("none");
  });

  it("marks the canvas and the root for the content=drawable form, and unmarks on unwrap", () => {
    installHtmlInCanvas("new");
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    const src = captureCanvas(root);
    expect(src.getAttribute("content")).toBe("drawable");
    expect(src.hasAttribute("layoutsubtree")).toBe(false);
    expect(root.hasAttribute("drawable")).toBe(true);
    root.removeAttribute("data-motion-blur");
    initCaptureMotionBlur(h);
    expect(root.parentElement).toBe(document.body);
    expect(root.hasAttribute("drawable")).toBe(false);
  });

  it("turns off when a content=drawable capture canvas appears after init", () => {
    installHtmlInCanvas("new");
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const late = document.createElement("canvas");
    late.setAttribute("content", "drawable");
    root.append(late);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().state).toBe("off");
  });

  it("unwraps when the root opts back out", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    root.removeAttribute("data-motion-blur");
    initCaptureMotionBlur(h);
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(win.__hfMotionBlur).toBeUndefined();
  });

  it("turns off instead of wrapping when a capture canvas appears after init", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const late = document.createElement("canvas");
    late.setAttribute("layoutsubtree", "");
    root.append(late);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().state).toBe("off");
  });

  it("never wraps a composition where nothing moves", () => {
    installHtmlInCanvas();
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
  });

  it("hides each move of the root from the runtime and re-seeks right after it (R9)", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    const events: string[] = [];
    const base = h.seek;
    const spied = {
      ...h,
      now: () => 0.5,
      seek: (t: number, suppress: boolean) => {
        base(t, suppress);
        events.push(`seek:${t}:${suppress}`);
      },
      ignoreMutations: (write: () => void) => {
        events.push("quiet:begin");
        write();
        events.push(`quiet:end:${root.parentElement === document.body ? "plain" : "wrapped"}`);
      },
    };
    initCaptureMotionBlur(spied);
    events.length = 0;
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(events.slice(events.indexOf("quiet:begin")).slice(0, 3)).toEqual([
      "quiet:begin",
      "quiet:end:wrapped",
      "seek:0.5:true",
    ]);
    events.length = 0;
    expect(paintCaptureMotionBlur(0.5)).toBeNull(); // paused: unwraps
    expect(events).toEqual(["quiet:begin", "quiet:end:plain", "seek:0.5:true"]);
  });

  it("does not re-seek when there was nothing to unwrap", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    h.seek.mockClear();
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(h.seek).not.toHaveBeenCalled();
  });

  it("unwraps when paused, so Studio can select inside, and wraps again on play", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const inFlight = paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint")); // movers hidden mid-frame
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    await inFlight; // the dropped frame still settles
    expect(root.parentElement).toBe(document.body);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    void paintCaptureMotionBlur(0.6, PLAY);
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });

  it("never unwraps once the engine drives frames", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    // A paused-style request from the transport during a render: it still paints.
    expect(paintCaptureMotionBlur(0.5)).not.toBeNull();
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });

  it("clears the output when wrapping, so the last frame of a previous wrap never shows", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(contexts[1]?.clearRect).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });
});

const HIDE = "data-hf-motion-blur-hide";
const ONLY = "data-hf-motion-blur-only";
const MOVER = "data-hf-motion-blur-mover";

describe("two-phase frames", () => {
  it("hides the movers for a background capture, then reveals them and settles", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(win.__hfMotionBlur?.report().moverNames).toEqual(["div#slider"]);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(2);
  });

  it("captures the movers alone first, then swaps to hiding them for the background", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(root.hasAttribute(ONLY)).toBe(true);
    expect(el.hasAttribute(MOVER)).toBe(true);
    expect(el.hasAttribute(HIDE)).toBe(false);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(root.hasAttribute(ONLY)).toBe(false);
    expect(el.hasAttribute(MOVER)).toBe(false);
    expect(el.hasAttribute(HIDE)).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(root.hasAttribute(ONLY)).toBe(false);
    expect(el.hasAttribute(HIDE)).toBe(false);
  });

  it("clears the isolation if the frame is given up on mid-way", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.hasAttribute(ONLY)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(root.hasAttribute(ONLY)).toBe(false);
    expect(el.hasAttribute(MOVER)).toBe(false);
  });

  it("shows plain DOM, not a half frame, when the engine's step runs before the background capture", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = paintCaptureMotionBlur(0.5, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    win.__hf_page_composite_resolve?.();
    await done;
    expect(win.__hfMotionBlur?.report()).toMatchObject({ failedFrames: 1 });
    expect(root.parentElement).toBe(document.body);
    expect(el.hasAttribute(HIDE)).toBe(false);
  });

  it("is busy from the first paint request until the frame is drawn (R11)", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    expect(captureMotionBlurBusy()).toBe(false);
    initCaptureMotionBlur(h);
    expect(captureMotionBlurBusy()).toBe(false);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(captureMotionBlurBusy()).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(captureMotionBlurBusy()).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(captureMotionBlurBusy()).toBe(false);
  });

  it("is no longer busy when a paused request unwraps a frame in flight", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(captureMotionBlurBusy()).toBe(false);
  });

  it("does not abandon a frame in flight: newer requests collapse into the latest", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const first = paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint")); // movers cropped, now hidden
    const seeksBefore = h.seek.mock.calls.length;
    const second = paintCaptureMotionBlur(0.6, PLAY);
    const third = paintCaptureMotionBlur(0.7, PLAY);
    // Queued, not started: no pose reads yet, and the first frame keeps its movers hidden.
    expect(h.seek.mock.calls.length).toBe(seeksBefore);
    expect(el.hasAttribute(HIDE)).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint")); // first frame done → 0.7 starts
    await first;
    expect(h.seek.mock.calls.at(-1)?.[0]).toBe(0.7);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await Promise.all([second, third]);
    expect(el.hasAttribute(HIDE)).toBe(false);
  });

  it("reveals the movers if the second paint never comes", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(el.hasAttribute(HIDE)).toBe(false);
  });

  it("finishes in one capture when the engine's step runs before any paint", () => {
    installHtmlInCanvas();
    const { el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    win.__hf_page_composite_resolve?.();
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
  });

  it("lets the engine's composite step finish a half-done frame", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    win.__hf_page_composite_resolve?.();
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(2);
  });

  it("starts an engine frame's paint wait on release, so slow video injection cannot drop it", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    await vi.advanceTimersByTimeAsync(5000);
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
  });

  it("gives up on a released engine frame whose paint never comes", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    let settled = false;
    void paintCaptureMotionBlur(0.5, { engineMode: true })?.then(() => (settled = true));
    releaseCaptureMotionBlurFrame();
    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).toBe(true);
  });

  it("leaves the engine's composite step idle when nothing moves", () => {
    installHtmlInCanvas();
    initCaptureMotionBlur(host(makeRoot()));
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(win.__hf_page_composite_pending).toBeUndefined();
  });

  it("holds an engine frame until released, so injected video frames are in its capture", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const requestPaint = vi.fn();
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint = requestPaint;
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(requestPaint).not.toHaveBeenCalled();
    expect(captureContext()?.drawElementImage).not.toHaveBeenCalled();
    releaseCaptureMotionBlurFrame();
    expect(requestPaint).toHaveBeenCalledTimes(1);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
  });
});

describe("painting", () => {
  it("captures the root on the next paint and settles the frame", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(done).not.toBeNull();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(captureContext()?.drawElementImage).toHaveBeenCalledWith(root, 0, 0);
    // Reset before each capture and again after it: the capture canvas sits under the output
    // and must never show its own bitmap (a transparent composition would show it doubled).
    expect(captureContext()?.reset).toHaveBeenCalledTimes(4);
    // The discovery scan's last word is the frame time: the page is left where it was seeked.
    expect(h.seek.mock.calls.at(-1)?.[0]).toBe(0.5);
  });

  it("scans with callbacks on when the root allows events, so callback-driven movers are found", () => {
    installHtmlInCanvas();
    const eventful = movingHost({
      "data-motion-blur": "on",
      "data-motion-blur-events": "on",
    }).h;
    initCaptureMotionBlur(eventful);
    win.__hfMotionBlur?.probe();
    expect(eventful.seek.mock.calls.length).toBeGreaterThan(10);
    expect(eventful.seek.mock.calls.every(([, suppress]) => suppress === false)).toBe(true);
  });

  it("seeks pose reads with events suppressed unless the root allows them", () => {
    installHtmlInCanvas();
    const quiet = host(makeRoot());
    initCaptureMotionBlur(quiet);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(quiet.seek.mock.calls.every(([, suppress]) => suppress === true)).toBe(true);

    resetCaptureMotionBlurForTests();
    const eventful = movingHost({
      "data-motion-blur": "on",
      "data-motion-blur-events": "on",
    }).h;
    initCaptureMotionBlur(eventful);
    void paintCaptureMotionBlur(0.5, PLAY);
    const calls = eventful.seek.mock.calls;
    expect(calls.at(-1)?.[1]).toBe(false);
    expect(calls.some(([, suppress]) => suppress === false)).toBe(true);
  });

  it("fires timeline callbacks during discovery only when the root allows events", () => {
    for (const events of [true, false]) {
      installHtmlInCanvas();
      const attrs: Record<string, string> = { "data-motion-blur": "on" };
      if (events) attrs["data-motion-blur-events"] = "on";
      const { h } = movingHost(attrs);
      const fired: number[] = [];
      const callAtOnePointSeven = (t: number, suppress: boolean) => {
        h.seek(t, suppress);
        if (!suppress && t >= 0.7) fired.push(t);
      };
      initCaptureMotionBlur({ ...h, seek: callAtOnePointSeven });
      void paintCaptureMotionBlur(0.1, PLAY);
      expect(win.__hfMotionBlur?.report().movers).toBe(1);
      expect(fired.length > 0).toBe(events);
      resetCaptureMotionBlurForTests();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      document.body.innerHTML = "";
    }
  });

  it("in engine mode composes with the prior composite owner and draws even without a paint event", () => {
    installHtmlInCanvas();
    const prior = vi.fn(() => true);
    win.__hf_page_composite_resolve = prior;
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(win.__hf_page_composite_pending).toBe(true);
    win.__hf_page_composite_resolve?.();
    expect(prior).toHaveBeenCalled();
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
    expect(win.__hf_page_composite_pending).toBe(false);
  });

  it("re-scans for movers when the runtime binds a different timeline", () => {
    installHtmlInCanvas();
    let timeline = "first";
    const h = { ...host(makeRoot()), timeline: () => timeline };
    initCaptureMotionBlur(h);
    const frame = (t: number): void => {
      void paintCaptureMotionBlur(t, PLAY);
      captureCanvas(h.root).dispatchEvent(new Event("paint"));
    };
    frame(0.5);
    const afterFirst = h.seek.mock.calls.length;
    frame(0.6);
    const steady = h.seek.mock.calls.length - afterFirst;
    timeline = "second";
    frame(0.7);
    // A scan seeks once per frame of the composition (30 here); a plain frame seeks far less.
    expect(h.seek.mock.calls.length - afterFirst - steady).toBeGreaterThan(steady + 30);
  });

  it("gives up on a frame whose paint never comes", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    initCaptureMotionBlur(movingHost().h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    let settled = false;
    void done?.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("rests on plain DOM in a hidden tab, with no paint requests, and resumes when visible (W1)", () => {
    installHtmlInCanvas();
    const requestPaint = vi.fn();
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint = requestPaint;
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const visibility = (v: string) =>
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    visibility("hidden");
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
    expect(requestPaint).not.toHaveBeenCalled();
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(root.parentElement).toBe(captureCanvas(root));
    visibility("visible");
    void paintCaptureMotionBlur(0.6, PLAY);
    expect(root.parentElement).toBe(captureCanvas(root));
    expect(win.__hfMotionBlur?.report().state).toBe("on");
  });

  it("turns itself off and unwraps after repeated capture failures", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    for (let i = 0; i < 3; i++) {
      const done = paintCaptureMotionBlur(i / 30, PLAY);
      captureContext()?.drawElementImage.mockImplementation(() => {
        throw new Error("No cached paint record");
      });
      captureCanvas(root).dispatchEvent(new Event("paint"));
      await done;
    }
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "off" });
  });

  describe("a block that its cause can lift", () => {
    /** A host whose root fades from 0.5 s while `fade.on`: the scan blocks it as root opacity. */
    function fadingHost(fade: { on: boolean }, timeline: () => unknown = () => "tl") {
      const { root, h } = movingHost();
      const slide = h.seek;
      const seek = vi.fn((t: number, quiet: boolean) => {
        slide(t, quiet);
        root.style.opacity = fade.on && t > 0.5 ? "0.5" : "1";
      });
      return { root, host: { ...h, seek, timeline } };
    }

    it("resumes blurring once the cause is gone and the scene is initialised again", () => {
      installHtmlInCanvas();
      const fade = { on: true };
      const { root, host: h } = fadingHost(fade);
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hfMotionBlur?.report()).toMatchObject({
        state: "off",
        reasonCode: "root-opacity",
      });
      fade.on = false;
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", reasonCode: null });
      expect(root.parentElement).toBe(captureCanvas(root));
    });

    it("blocks again, with the reason, when the cause is still there", () => {
      installHtmlInCanvas();
      const { root, host: h } = fadingHost({ on: true });
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(root.parentElement).toBe(document.body);
      expect(win.__hfMotionBlur?.report()).toMatchObject({
        state: "off",
        reasonCode: "root-opacity",
      });
    });

    it("re-evaluates the block when the bound timeline changes", () => {
      installHtmlInCanvas();
      const fade = { on: true };
      let tl = "a";
      const { host: h } = fadingHost(fade, () => tl);
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hfMotionBlur?.report().state).toBe("off");
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hfMotionBlur?.report().state).toBe("off");
      fade.on = false;
      tl = "b";
      void paintCaptureMotionBlur(0.2, { engineMode: true });
      expect(win.__hfMotionBlur?.report().state).toBe("on");
    });

    it("lifts a block raised after a clean scan, too", () => {
      installHtmlInCanvas();
      trackAcceleratedCanvases();
      const { root, h } = movingHost();
      initCaptureMotionBlur(h);
      const late = document.createElement("canvas");
      root.append(late);
      late.getContext("webgl");
      void paintCaptureMotionBlur(0.5, { engineMode: true });
      expect(win.__hfMotionBlur?.report().reasonCode).toBe("accelerated-canvas");
      late.remove();
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.5, PLAY);
      captureCanvas(root).dispatchEvent(new Event("paint"));
      expect(win.__hfMotionBlur?.report().state).toBe("on");
      expect(captureContext()?.drawElementImage).toHaveBeenCalled();
    });

    it("keeps a capture-failure block for the life of the instance", async () => {
      installHtmlInCanvas();
      const { root, h } = movingHost();
      initCaptureMotionBlur(h);
      for (let i = 0; i < 3; i++) {
        const done = paintCaptureMotionBlur(i / 30, PLAY);
        captureContext()?.drawElementImage.mockImplementation(() => {
          throw new Error("No cached paint record");
        });
        captureCanvas(root).dispatchEvent(new Event("paint"));
        await done;
      }
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.5, PLAY);
      expect(root.parentElement).toBe(document.body);
      expect(win.__hfMotionBlur?.report()).toMatchObject({
        state: "off",
        reasonCode: "capture-failures",
      });
    });
  });

  it("counts every frame that fell back to plain DOM, though the failure streak resets", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const frame = async (t: number, fails: boolean): Promise<void> => {
      captureContext()?.drawElementImage.mockImplementation(() => {
        if (fails) throw new Error("No cached paint record");
      });
      const done = paintCaptureMotionBlur(t, { engineMode: true });
      releaseCaptureMotionBlurFrame();
      captureCanvas(root).dispatchEvent(new Event("paint"));
      captureCanvas(root).dispatchEvent(new Event("paint"));
      await done;
    };
    await frame(0.1, true);
    await frame(0.2, false);
    void paintCaptureMotionBlur(0.3, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    await vi.advanceTimersByTimeAsync(2000);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ failures: 0, failedFrames: 2 });
    expect(Object.keys(win.__hfMotionBlur?.report() ?? {})).toContain("failedFrames");
  });

  it("keeps blurring in a render after repeated capture failures, each failed frame plain DOM", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const engineFrame = async (i: number): Promise<void> => {
      const done = paintCaptureMotionBlur(i / 30, { engineMode: true });
      releaseCaptureMotionBlurFrame();
      captureCanvas(root).dispatchEvent(new Event("paint"));
      await done;
    };
    captureContext()?.drawElementImage.mockImplementation(() => {
      throw new Error("No cached paint record");
    });
    for (let i = 0; i < 5; i++) {
      await engineFrame(i);
      expect(root.parentElement).toBe(document.body);
    }
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      failures: 5,
      failedFrames: 5,
    });
    captureContext()?.drawElementImage.mockReset();
    const done = paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(captureCanvas(root).tagName).toBe("CANVAS");
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      failures: 0,
      failedFrames: 5,
      frames: 6,
    });
    expect(contexts[1]?.drawImage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("suspend (R13)", () => {
  it("unwraps a wrapped root, stops all painting, and keeps the reported decision", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement?.tagName).toBe("CANVAS");
    const before = win.__hfMotionBlur?.report();
    win.__hfMotionBlur?.suspend();
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(paintCaptureMotionBlur(0.6, PLAY)).toBeNull();
    expect(paintCaptureMotionBlur(0.7, { engineMode: true })).toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toEqual(before);
  });

  it("is idempotent, and suspends a page that has not wrapped yet", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    win.__hfMotionBlur?.suspend();
    h.seek.mockClear();
    win.__hfMotionBlur?.suspend();
    expect(h.seek).not.toHaveBeenCalled();
    expect(paintCaptureMotionBlur(0.5, { engineMode: true })).toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().state).toBe("on");
  });

  it("outlives a re-init of the same root", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    win.__hfMotionBlur?.suspend();
    initCaptureMotionBlur(h);
    expect(paintCaptureMotionBlur(0.5, PLAY)).toBeNull();
    expect(root.parentElement).toBe(document.body);
  });

  it("opens the shutter 240 degrees unless the root says otherwise", () => {
    installHtmlInCanvas();
    initCaptureMotionBlur(host(makeRoot()));
    expect(win.__hfMotionBlur?.report().shutterDeg).toBe(240);
    resetCaptureMotionBlurForTests();
    document.body.innerHTML = "";
    const root = makeRoot({ "data-motion-blur": "on", "data-motion-blur-shutter": "360" });
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().shutterDeg).toBe(360);
  });

  it("exists, and does nothing, where blur is off", () => {
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    expect(() => win.__hfMotionBlur?.suspend()).not.toThrow();
    expect(win.__hfMotionBlur?.report().state).toBe("off");
  });

  it("lets the probe still decide after suspending", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    win.__hfMotionBlur?.suspend();
    expect(win.__hfMotionBlur?.report().state).toBe("on");
  });
});

describe("device pixel ratio", () => {
  it("sizes the capture and output canvases in device pixels and keeps the CSS size", () => {
    installHtmlInCanvas();
    vi.stubGlobal("devicePixelRatio", 2);
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    const src = captureCanvas(root);
    const out = src.nextElementSibling as HTMLCanvasElement;
    for (const canvas of [src, out]) {
      expect([canvas.width, canvas.height]).toEqual([1280, 720]);
      expect([canvas.style.width, canvas.style.height]).toEqual(["640px", "360px"]);
    }
  });

  it("builds the accumulation buffer in device pixels", () => {
    installHtmlInCanvas();
    vi.stubGlobal("devicePixelRatio", 2);
    const sizes: number[][] = [];
    const Fake = (
      globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => object }
    ).OffscreenCanvas;
    vi.stubGlobal(
      "OffscreenCanvas",
      class extends Fake {
        constructor(w: number, h: number) {
          super(w, h);
          sizes.push([w, h]);
        }
      },
    );
    initCaptureMotionBlur(movingHost().h);
    expect(sizes[0]).toEqual([1280, 720]);
  });

  it("prefers the engine's injected scale over a devicePixelRatio that fell back to 1", () => {
    installHtmlInCanvas();
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("__HF_DEVICE_SCALE_FACTOR__", 2);
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(captureCanvas(root).width).toBe(1280);
  });

  it("rebuilds the canvases when the ratio changes between frames", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const first = paintCaptureMotionBlur(0.5, PLAY);
    expect(captureCanvas(root).width).toBe(640);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    void first;
    vi.stubGlobal("devicePixelRatio", 2);
    void paintCaptureMotionBlur(0.6, PLAY);
    expect(captureCanvas(root).width).toBe(1280);
  });
});

describe("probe", () => {
  const probe = () => {
    const api = win.__hfMotionBlur;
    if (!api) throw new Error("no __hfMotionBlur");
    return api.probe();
  };

  it("finds the movers without any paint, wrap or event and puts the playhead back", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur({ ...h, now: () => 0.4 });
    expect(win.__hfMotionBlur?.report().moverNames).toEqual([]);
    const report = probe();
    expect(report).toMatchObject({
      state: "on",
      reason: null,
      reasonCode: null,
      moverNames: ["div#slider"],
    });
    expect(h.seek.mock.calls.at(-1)?.[0]).toBeCloseTo(0.4);
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("reports no movers for a composition where nothing moves", () => {
    installHtmlInCanvas();
    initCaptureMotionBlur(host(makeRoot()));
    expect(probe()).toMatchObject({ state: "on", movers: 0 });
  });

  it("does not rescan on a second call, but does when the timeline changes", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    let tl = "a";
    initCaptureMotionBlur({ ...h, timeline: () => tl });
    probe();
    const seeks = h.seek.mock.calls.length;
    probe();
    expect(h.seek.mock.calls.length).toBe(seeks);
    tl = "b";
    probe();
    expect(h.seek.mock.calls.length).toBeGreaterThan(seeks);
  });

  it("reports the defect a scan finds, with its code, and a later frame stays plain", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur({
      ...h,
      seek: (t, quiet) => {
        h.seek(t, quiet);
        root.style.opacity = t > 0.5 ? "0.5" : "1";
      },
    });
    expect(probe()).toMatchObject({ state: "off", reasonCode: "root-opacity" });
    expect(probe().reasonCode).toBe("root-opacity");
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(root.parentElement).toBe(document.body);
  });

  it("carries the code of a static defect and of an unsupported browser", () => {
    installHtmlInCanvas();
    const root = makeRoot();
    root.innerHTML =
      '<div style="transform-style: preserve-3d"><div style="backface-visibility: hidden"></div></div>';
    initCaptureMotionBlur(host(root));
    expect(probe()).toMatchObject({ state: "off", reasonCode: "backface-visibility" });

    resetCaptureMotionBlurForTests();
    vi.unstubAllGlobals();
    delete win.__hfMotionBlur;
    initCaptureMotionBlur(host(makeRoot()));
    expect(probe()).toMatchObject({ state: "off", reasonCode: "unsupported-browser" });
  });

  it("does not scan again once blur is off, even when a rescan was requested", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    captureContext()?.drawElementImage.mockImplementation(() => {
      throw new Error("boom");
    });
    for (let i = 0; i < 3; i++) {
      void paintCaptureMotionBlur(0.5, PLAY);
      document.querySelector("canvas")?.dispatchEvent(new Event("paint"));
    }
    initCaptureMotionBlur(h);
    const seeks = h.seek.mock.calls.length;
    expect(probe()).toMatchObject({ state: "off", reasonCode: "capture-failures" });
    expect(h.seek.mock.calls.length).toBe(seeks);
  });

  it("reports capture-failures after three failed frames", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    captureContext()?.drawElementImage.mockImplementation(() => {
      throw new Error("boom");
    });
    for (let i = 0; i < 3; i++) {
      void paintCaptureMotionBlur(0.5, PLAY);
      const canvas = document.querySelector("canvas");
      canvas?.dispatchEvent(new Event("paint"));
    }
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reasonCode: "capture-failures",
    });
  });
});

describe("guards that once survived a deliberate break (T1)", () => {
  const frameOf = async (root: HTMLElement, t: number, fail: boolean): Promise<void> => {
    captureContext()?.drawElementImage.mockImplementation(() => {
      if (fail) throw new Error("No cached paint record");
    });
    const done = paintCaptureMotionBlur(t, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
  };

  it("keeps blurring through two failed frames and gives up on exactly the third", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    await frameOf(root, 0.1, true);
    await frameOf(root, 0.2, true);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failures: 2 });
    await frameOf(root, 0.3, true);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reasonCode: "capture-failures",
    });
  });

  it("a good frame between failures restarts the count", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    await frameOf(root, 0.1, true);
    await frameOf(root, 0.2, true);
    await frameOf(root, 0.3, false);
    await frameOf(root, 0.4, true);
    await frameOf(root, 0.5, true);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failures: 2 });
  });

  it("never seeks below zero for the pose reads of a frame near the start", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    h.seek.mockClear();
    void paintCaptureMotionBlur(0.001, PLAY);
    void paintCaptureMotionBlur(0, { engineMode: true });
    const times = h.seek.mock.calls.map((call) => Number(call[0]));
    expect(times.length).toBeGreaterThan(4);
    expect(times.filter((t) => t < 0)).toEqual([]);
  });

  it("disables once: one warning, and the first reason stays when unwrapping throws", () => {
    installHtmlInCanvas();
    const state = { fade: false, explode: false, timeline: "a" };
    const { root, h } = movingHost();
    const slide = h.seek;
    h.seek = vi.fn((t: number, quiet: boolean) => {
      if (state.explode && root.parentElement === document.body) throw new Error("seek blew up");
      slide(t, quiet);
      root.style.opacity = state.fade && t > 0.5 ? "0.5" : "1";
    });
    h.timeline = () => state.timeline;
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.2, { engineMode: true });
    expect(root.parentElement).toBe(captureCanvas(root));
    Object.assign(state, { fade: true, explode: true, timeline: "b" });
    void paintCaptureMotionBlur(0.2, { engineMode: true });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reasonCode: "root-opacity",
    });
  });

  it("removes the hide rule and both canvases on unwrap, and the movers' hide attribute", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    const hideRules = () =>
      [...document.head.querySelectorAll("style")].filter((s) => s.textContent?.includes(HIDE));
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(hideRules()).toHaveLength(1);
    expect(el.hasAttribute(HIDE)).toBe(true);
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(hideRules()).toHaveLength(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(root.parentElement).toBe(document.body);
  });

  it("does not blur a mover that is not visible", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    const visible = { value: false };
    const checkVisibility = vi.fn(() => visible.value);
    Object.defineProperty(el, "checkVisibility", { value: checkVisibility, configurable: true });
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(checkVisibility).toHaveBeenCalledWith({ visibilityProperty: true });
    expect(el.hasAttribute(HIDE)).toBe(false);
    visible.value = true;
    void paintCaptureMotionBlur(0.6, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
  });
});

describe("paint timeouts", () => {
  const HIDE = "data-hf-motion-blur-hide";
  const info = () => vi.mocked(console.info);
  const engineFrame = (t: number): Promise<void> | null => {
    const done = paintCaptureMotionBlur(t, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    return done;
  };
  const plainDom = (root: HTMLElement): void => {
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  };

  it("renders a released frame whose paint never comes plain, counts it, and leaves nothing for the engine to finish (first frame, output never drawn)", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = engineFrame(0.5);
    expect(captureCanvas(root).tagName).toBe("CANVAS");
    await vi.advanceTimersByTimeAsync(2001);
    await done;
    plainDom(root);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      failures: 0,
      failedFrames: 1,
    });
    expect(info()).toHaveBeenCalledWith(
      expect.stringMatching(/capture failed \(1 so far\).*paint/),
    );
    win.__hf_page_composite_resolve?.(); // the engine's forced composite arrives late
    plainDom(root);
    expect(contexts[0]?.drawElementImage).not.toHaveBeenCalled();
    expect(win.__hf_page_composite_pending).toBe(false);
    void paintCaptureMotionBlur(0.6, { engineMode: true }); // the next frame wraps again
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });

  it("does the same for a frame after one that painted, whose output already holds an earlier frame", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const first = engineFrame(0.5);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await first;
    expect(win.__hfMotionBlur?.report()).toMatchObject({ failedFrames: 0, frames: 1 });
    const captures = contexts[0]?.drawElementImage.mock.calls.length;
    const second = engineFrame(0.6);
    await vi.advanceTimersByTimeAsync(2001);
    await second;
    plainDom(root);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ failures: 0, failedFrames: 1 });
    win.__hf_page_composite_resolve?.();
    plainDom(root);
    expect(contexts[0]?.drawElementImage.mock.calls.length).toBe(captures);
  });

  it("keeps blurring through preview paint timeouts, each frame plain, and resumes when painting returns", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    for (let i = 0; i < 4; i++) {
      void paintCaptureMotionBlur(i / 30, PLAY);
      expect(captureCanvas(root).tagName).toBe("CANVAS");
      await vi.advanceTimersByTimeAsync(2000);
      plainDom(root);
    }
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      failures: 0,
      failedFrames: 4,
    });
    expect(info()).toHaveBeenCalledTimes(1);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(contexts[0]?.drawElementImage).toHaveBeenCalled();
  });
});

describe("filter fallback", () => {
  beforeEach(() => setFilterFallbackForTests(true));

  /** A root whose opacity tweens late, which a scan sees and capture cannot draw. */
  const CAPTURE = { "data-motion-blur": "on", "data-motion-blur-tier": "capture" };
  function fadingRoot(fade: { on: boolean }) {
    const { root, el, h } = movingHost(CAPTURE);
    const slide = h.seek;
    const seek = vi.fn((t: number, quiet: boolean) => {
      slide(t, quiet);
      root.style.opacity = fade.on && t > 0.5 ? "0.5" : "1";
    });
    return { root, el, h: { ...h, seek } };
  }

  it("draws with filters where html-in-canvas is missing, and says why", () => {
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      tier: "filter",
      reasonCode: "unsupported-browser",
    });
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(el.style.filter).toMatch(/url\("?#hf-mb-0"?\)/);
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelectorAll("feOffset")).toHaveLength(32);
    expect(document.querySelectorAll("feComposite")).toHaveLength(31);
    expect(document.querySelectorAll("feGaussianBlur")).toHaveLength(1);
  });

  it("stays off when the renderer turned blur off", () => {
    win.__HF_PAGE_MOTION_BLUR_OFF__ = "hdr-render";
    const { el, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reasonCode: "renderer-off",
    });
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(el.style.filter).toBe("");
  });

  it("takes over from capture when a scan finds a defect, keeping the reason", () => {
    installHtmlInCanvas();
    const { root, el, h } = fadingRoot({ on: true });
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.2, { engineMode: true });
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      tier: "filter",
      reasonCode: "root-opacity",
    });
    expect(root.parentElement).toBe(document.body);
    expect(el.style.filter).toMatch(/url\("?#hf-mb-0"?\)/);
  });

  it("falls back after repeated capture failures in preview", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost(CAPTURE);
    initCaptureMotionBlur(h);
    for (let i = 0; i < 3; i++) {
      const done = paintCaptureMotionBlur(i / 30, PLAY);
      captureContext()?.drawElementImage.mockImplementation(() => {
        throw new Error("No cached paint record");
      });
      captureCanvas(root).dispatchEvent(new Event("paint"));
      await done;
    }
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      tier: "filter",
      reasonCode: "capture-failures",
    });
    expect(el.style.filter).toMatch(/url\("?#hf-mb-\d+"?\)/);
  });

  it("tries capture again when the scene is initialised after the cause is gone", () => {
    installHtmlInCanvas();
    const fade = { on: true };
    const { root, h } = fadingRoot(fade);
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.2, { engineMode: true });
    expect(win.__hfMotionBlur?.report().tier).toBe("filter");
    fade.on = false;
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.2, { engineMode: true });
    expect(win.__hfMotionBlur?.report()).toMatchObject({ tier: "capture", reasonCode: null });
    expect(root.parentElement).toBe(captureCanvas(root));
  });

  describe("choosing the tier", () => {
    /** Turns while it moves: the one thing the filter tier only softens. */
    function turningHost(attrs: Record<string, string>) {
      const { root, el, h } = movingHost(attrs);
      const slide = h.seek;
      const seek = vi.fn((t: number, quiet: boolean) => {
        slide(t, quiet);
        el.style.transform = `matrix(${Math.cos(t)}, ${Math.sin(t)}, ${-Math.sin(t)}, ${Math.cos(t)}, ${300 * t}, 0)`;
      });
      return { root, el, h: { ...h, seek } };
    }
    beforeEach(() => {
      const real = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
        const cs = real(el);
        return new Proxy(cs, {
          get: (target, key) => {
            if (key === "transform")
              return el instanceof HTMLElement ? el.style.transform || "none" : "none";
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
    });

    it("takes the cheaper filter tier when every mover only translates", () => {
      installHtmlInCanvas();
      const { root, el, h } = movingHost();
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.5, PLAY);
      expect(win.__hfMotionBlur?.report()).toMatchObject({
        state: "on",
        tier: "filter",
        reasonCode: "translation-only",
      });
      expect(root.parentElement).toBe(document.body);
      expect(el.style.filter).toMatch(/url\("?#hf-mb-0"?\)/);
    });

    it("keeps capture for a mover that turns", () => {
      installHtmlInCanvas();
      const { root, h } = turningHost({ "data-motion-blur": "on" });
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.5, PLAY);
      expect(win.__hfMotionBlur?.report()).toMatchObject({ tier: "capture", reasonCode: null });
      expect(root.parentElement).toBe(captureCanvas(root));
    });

    it('keeps capture when asked with data-motion-blur-tier="capture"', () => {
      installHtmlInCanvas();
      const { root, h } = movingHost(CAPTURE);
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.5, PLAY);
      expect(win.__hfMotionBlur?.report().tier).toBe("capture");
      expect(root.parentElement).toBe(captureCanvas(root));
    });

    it('takes the filter tier when asked with data-motion-blur-tier="filter", even for a turn', () => {
      installHtmlInCanvas();
      const { root, el, h } = turningHost({
        "data-motion-blur": "on",
        "data-motion-blur-tier": "filter",
      });
      initCaptureMotionBlur(h);
      void paintCaptureMotionBlur(0.5, PLAY);
      expect(win.__hfMotionBlur?.report()).toMatchObject({
        tier: "filter",
        reasonCode: "tier-attribute",
      });
      expect(root.parentElement).toBe(document.body);
      expect(el.style.filter).toMatch(/url\("?#hf-mb-0"?\)/);
    });
  });

  it("keeps the mover's own filter under the smear, and puts it back when paused", () => {
    const { el, h } = movingHost();
    el.style.filter = "drop-shadow(0px 0px 4px red)";
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(el.style.filter).toContain("drop-shadow");
    expect(el.style.filter).toMatch(/url\("?#hf-mb-0"?\)/);
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(el.style.filter).toBe("drop-shadow(0px 0px 4px red)");
  });

  it("removes its filters and its SVG on teardown", () => {
    const { el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    resetCaptureMotionBlurForTests();
    expect(el.style.filter).toBe("");
    expect(document.querySelectorAll("filter")).toHaveLength(0);
  });
});
