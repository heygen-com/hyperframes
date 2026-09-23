import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HfVfxCapture } from "../vfx";
import { resetSeekDispatchState, waitForSeekCompletion } from "./adapters/seek-dispatch";
import { initVfx, paintVfx } from "./vfx";

/**
 * No def has `capture !== "none"` until Task 2.2 registers `wave-warp`, so the
 * capture tests below lift a real `fractal-noise` chain into `self` through the
 * two functions the runtime asks. `null` leaves the real answers alone, so the
 * Task 1.2 cases in this file are untouched.
 */
const override = vi.hoisted(() => ({
  capture: null as HfVfxCapture | null,
  /** Appends a `ref` param with this key to every def, as `luma-matte` has. */
  refKey: null as string | null,
}));

vi.mock("../vfx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vfx")>();
  return {
    ...actual,
    chainCapture: (chain: import("../vfx").HfVfxChain) =>
      override.capture ?? actual.chainCapture(chain),
    getVfxDef: (id: string) => {
      const def = actual.getVfxDef(id);
      if (!def) return def;
      if (!override.capture && !override.refKey) return def;
      return {
        ...def,
        capture: override.capture ?? def.capture,
        params: override.refKey
          ? [...def.params, { kind: "ref", key: override.refKey, label: "Second source" }]
          : def.params,
      };
    },
    normalizeVfxParams: (id: string, values: import("../vfx").HfVfxParamValues | undefined) => {
      const normalized = actual.normalizeVfxParams(id, values);
      // The real `normalizeVfxParams` reads the real def, which has no ref
      // param, so the injected one would be dropped before the runtime saw it.
      if (override.refKey) normalized[override.refKey] = String(values?.[override.refKey] ?? "");
      return normalized;
    },
  };
});

const LABEL = "[HyperFrames] composition script error:";

interface MockGl {
  calls: string[];
  uniforms: Record<string, unknown>;
  programCount: number;
  usedPrograms: unknown[];
  shaderSources: string[];
  viewports: number[][];
}

/**
 * The slice of WebGL2 the vfx runtime touches. jsdom has no GL at all, so the
 * unit tests stand a recorder in front of it and assert on the call order and
 * the uniform values rather than on pixels — pixels are the browser test's job.
 */
function createMockGl(): WebGL2RenderingContext & MockGl {
  const state: MockGl = {
    calls: [],
    uniforms: {},
    programCount: 0,
    usedPrograms: [],
    shaderSources: [],
    viewports: [],
  };
  let currentProgram: unknown = null;
  const gl = {
    ...state,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TRIANGLES: 0x0004,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    createShader: () => ({}),
    shaderSource: (_s: unknown, src: string) => state.shaderSources.push(src),
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => {},
    createProgram: () => ({ id: ++state.programCount }),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: () => {},
    getUniformLocation: (_p: unknown, name: string) => name,
    useProgram: (p: unknown) => {
      currentProgram = p;
      state.usedPrograms.push(p);
      state.calls.push("useProgram");
    },
    uniform1f: (name: string, v: number) => {
      state.uniforms[name] = v;
    },
    uniform1i: (name: string, v: number) => {
      state.uniforms[name] = v;
    },
    uniform2f: (name: string, a: number, b: number) => {
      state.uniforms[name] = [a, b];
    },
    viewport: (_x: number, _y: number, w: number, h: number) => state.viewports.push([w, h]),
    drawArrays: () => state.calls.push(`draw:${(currentProgram as { id: number }).id}`),
    createTexture: () => ({}),
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    activeTexture: () => {},
    pixelStorei: () => {},
    createFramebuffer: () => ({}),
    bindFramebuffer: (_t: unknown, fb: unknown) => state.calls.push(fb ? "fbo" : "screen"),
    framebufferTexture2D: () => {},
    deleteFramebuffer: () => {},
    deleteTexture: () => {},
  } as unknown as WebGL2RenderingContext & MockGl;
  return gl;
}

let gl: (WebGL2RenderingContext & MockGl) | null = null;
let errors: unknown[][] = [];

function installCanvasMock(webgl2: () => unknown): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    kind: string,
  ) {
    return kind === "webgl2" ? (webgl2() as never) : null;
  } as never);
}

/**
 * Hosts are 0×0 in jsdom; the runtime refuses to paint a zero-area box. Sets
 * both the layout box (`offsetWidth`/`offsetHeight`, what `deviceSize` reads)
 * and the client rect (what a GSAP transform would inflate) to the same
 * values by default — a test that wants to simulate a transformed host
 * overrides `getBoundingClientRect` afterwards.
 */
function sizeHost(host: HTMLElement, width = 320, height = 180): void {
  host.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
  Object.defineProperty(host, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(host, "offsetHeight", { value: height, configurable: true });
}

function makeHost(chain: string, id = "h1"): HTMLElement {
  const host = document.createElement("div");
  host.id = id;
  host.setAttribute("data-vfx-chain", chain);
  sizeHost(host);
  document.body.appendChild(host);
  return host;
}

const ONE_NODE =
  '{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{"contrast":562}}]}';
const TWO_NODES =
  '{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{}},' +
  '{"type":"fractal-noise","id":"n2","params":{}}]}';

/**
 * One fixture for every describe in this file: a clean body, a recording mock
 * GL behind `getContext`, a console spy, a page-composite slot nobody else
 * owns, and the def overrides this test lifts its chains through.
 */
function installVfxHarness(capture: HfVfxCapture | null, refKey: string | null = null): void {
  document.body.innerHTML = "";
  gl = createMockGl();
  installCanvasMock(() => gl);
  errors = [];
  override.capture = capture;
  override.refKey = refKey;
  // `paintVfx` registers its preview capture into the module-level
  // seek-completion set; a leftover entry would stall the next test's barrier.
  resetSeekDispatchState();
  clearCompositeSlot();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
}

function releaseVfxHarness(): void {
  // Empty the registry BEFORE the canvas mock comes off, or jsdom's real
  // (unimplemented) getContext runs and floods the console.
  document.body.innerHTML = "";
  override.capture = null;
  override.refKey = null;
  initVfx(document.body, 30);
  clearCompositeSlot();
  resetSeekDispatchState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/**
 * One macrotask. The preview capture path awaits a `paint` event, a
 * `Promise.all` over every source, and then the capture itself, so counting
 * microtask ticks by hand is a test that breaks when a hop is added; a timer
 * tick settles all of them.
 */
function flushTasks(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function clearCompositeSlot(): void {
  delete compositeWindow().__hf_page_composite_pending;
  delete compositeWindow().__hf_page_composite_resolve;
}

describe("vfx runtime", () => {
  beforeEach(() => installVfxHarness(null));
  afterEach(releaseVfxHarness);

  it("registers every [data-vfx-chain] host and creates a missing .hf-vfx-out", () => {
    const a = makeHost(ONE_NODE, "a");
    const b = makeHost(ONE_NODE, "b");
    const preset = document.createElement("canvas");
    preset.className = "hf-vfx-out";
    b.appendChild(preset);

    const registry = initVfx(document.body, 30);

    expect(registry).toHaveLength(2);
    expect(a.querySelectorAll("canvas.hf-vfx-out")).toHaveLength(1);
    expect(b.querySelectorAll("canvas.hf-vfx-out")).toHaveLength(1);
    expect(registry[1]!.out).toBe(preset);
    expect(errors).toEqual([]);
  });

  it("gives an exporter-emitted .hf-vfx-out the same box as one it creates", () => {
    const a = makeHost(ONE_NODE, "a");
    const b = makeHost(ONE_NODE, "b");
    const preset = document.createElement("canvas");
    preset.className = "hf-vfx-out";
    b.appendChild(preset);

    initVfx(document.body, 30);

    const created = a.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement;
    // The exporter emits the canvas bare (`<canvas class="hf-vfx-out"></canvas>`).
    // Adopted untouched it stays `position:static; display:inline`, wraps to the
    // line after the `.hf-vfx-src` canvas and paints one layer height below the
    // host — measured on retro-wave `#main-l6-text` (findings Task 3.5b).
    expect(preset.style.position).toBe("absolute");
    expect(preset.style.cssText).toBe(created.style.cssText);
    expect(errors).toEqual([]);
  });

  it("reports an unsupported chain version loudly and registers nothing", () => {
    makeHost('{"version":2,"nodes":[]}');

    const registry = initVfx(document.body, 30);

    expect(registry).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toBe(LABEL);
    expect(String(errors[0]![1])).toMatch(/vfx/);
    expect(String(errors[0]![1])).toMatch(/version/);
  });

  it("reports an unknown effect type loudly", () => {
    makeHost('{"version":1,"nodes":[{"type":"nope","id":"n1","params":{}}]}');

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/unknown effect type/);
  });

  it("reports an unavailable WebGL2 context loudly and registers nothing", () => {
    makeHost(ONE_NODE);
    installCanvasMock(() => null);

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]![1])).toMatch(/WebGL2/);
  });

  it("draws one full-screen triangle per enabled node, last pass to the canvas", () => {
    makeHost(TWO_NODES);
    initVfx(document.body, 30);

    // Second paint: the ping-pong targets already exist, so the call list is
    // exactly the draw sequence — which also pins that they are reused.
    paintVfx(1.25);
    gl!.calls.length = 0;
    paintVfx(1.25);

    expect(gl!.calls).toEqual(["useProgram", "fbo", "draw:1", "useProgram", "screen", "draw:2"]);
  });

  it("passes the seek time, the composition fps and the device-pixel size as uniforms", () => {
    makeHost(ONE_NODE);
    initVfx(document.body, 24);

    paintVfx(1.5);

    expect(gl!.uniforms["u_t"]).toBe(1.5);
    expect(gl!.uniforms["u_fps"]).toBe(24);
    expect(gl!.uniforms["u_size"]).toEqual([320, 180]);
    expect(gl!.viewports.at(-1)).toEqual([320, 180]);
  });

  it("takes a static param from the chain and an animated one from its CSS var", () => {
    const host = makeHost(ONE_NODE);
    host.style.setProperty("--vfx-n1-opacity", "42");
    initVfx(document.body, 30);

    paintVfx(0);

    expect(gl!.uniforms["u_contrast"]).toBe(562);
    expect(gl!.uniforms["u_opacity"]).toBe(42);
  });

  it("clamps a param that the chain put outside the def's range", () => {
    makeHost(
      '{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{"contrast":99999}}]}',
    );
    initVfx(document.body, 30);

    paintVfx(0);

    expect(gl!.uniforms["u_contrast"]).toBe(1000);
  });

  it("sizes the output canvas from the host's layout box, not its transformed AABB", () => {
    // A GSAP `transform: scale(2)` inflates getBoundingClientRect but leaves
    // offsetWidth/offsetHeight alone — the runtime must use the latter, or a
    // scaled or rotated host gets an inflated canvas and a stretched capture.
    const host = makeHost(ONE_NODE);
    sizeHost(host, 200, 100);
    host.getBoundingClientRect = () =>
      ({
        width: 400,
        height: 200,
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        x: 0,
        y: 0,
      }) as DOMRect;
    initVfx(document.body, 30);

    paintVfx(0);

    expect(gl!.uniforms["u_size"]).toEqual([200, 100]);
    expect(gl!.viewports.at(-1)).toEqual([200, 100]);
  });

  it("does not paint a host whose box has no area", () => {
    const host = makeHost(ONE_NODE);
    sizeHost(host, 0, 0);
    initVfx(document.body, 30);

    paintVfx(0);

    expect(gl!.calls).toEqual([]);
  });

  it("reports a lost WebGL context once and then paints that host no more", () => {
    const host = makeHost(ONE_NODE);
    const entries = initVfx(document.body, 30);
    const out = host.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement;
    const lose = (): void => {
      out.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    };

    lose();
    paintVfx(0);
    // A second loss event, and a second paint, must stay quiet: the report is
    // the moment of loss, not every frame after it.
    lose();
    paintVfx(1);

    expect({
      contextLost: entries[0]!.contextLost,
      reports: errors.length,
      message: String(errors[0]?.[1] ?? ""),
      calls: gl!.calls,
    }).toEqual({
      contextLost: true,
      reports: 1,
      message: expect.stringMatching(/context lost/i) as unknown as string,
      calls: [],
    });
  });

  it("forgets the previous composition's hosts when re-initialised", () => {
    makeHost(ONE_NODE);
    initVfx(document.body, 30);
    document.body.innerHTML = "";

    expect(initVfx(document.body, 30)).toHaveLength(0);
    paintVfx(0);
    expect(gl!.calls).toEqual([]);
  });
});

interface CompositeWindow extends Window {
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_resolve?: () => boolean;
}

function compositeWindow(): CompositeWindow {
  return window as CompositeWindow;
}

interface MockCtx2d {
  cleared: number[][];
  drawn: { el: Element; w: number; h: number }[];
}

/** The 2-D slice a capture host uses, with `drawElementImage` present. */
function createMockCtx2d(onDraw?: () => void): MockCtx2d {
  const state: MockCtx2d = { cleared: [], drawn: [] };
  return Object.assign(state, {
    clearRect: (_x: number, _y: number, w: number, h: number) => state.cleared.push([w, h]),
    drawElementImage: (el: Element, _x: number, _y: number, w: number, h: number) => {
      onDraw?.();
      state.drawn.push({ el, w, h });
    },
  }) as MockCtx2d;
}

/**
 * A capture wrapper as the exporter emits it. `.hf-vfx-in` is given a real
 * layout box because inside a `layoutsubtree` canvas an unsized wrapper
 * measures 0×0 and captures nothing in silence — the runtime refuses it, so a
 * fixture without a box would be testing that refusal and nothing else.
 */
function makeCaptureWrapper(ctx: unknown, forId?: string): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.className = "hf-vfx-src";
  src.setAttribute("layoutsubtree", "");
  if (forId !== undefined) src.setAttribute("data-vfx-for", forId);
  if (ctx !== undefined) {
    src.getContext = ((kind: string) => (kind === "2d" ? ctx : null)) as never;
  }
  const inner = document.createElement("div");
  inner.className = "hf-vfx-in";
  sizeHost(inner, 320, 180);
  src.appendChild(inner);
  return src;
}

/** A `self` host as the exporter emits it: src canvas wrapping `.hf-vfx-in`. */
function makeCaptureHost(ctx: unknown, id = "cap", chain = ONE_NODE): HTMLElement {
  const host = makeHost(chain, id);
  host.insertBefore(makeCaptureWrapper(ctx), host.firstChild);
  return host;
}

/**
 * A `backdrop` host as interface v1.1 shapes it: the wrapper holding every
 * layer below the host is the host's PRECEDING SIBLING, named by
 * `data-vfx-for`, not a child of the host.
 */
function makeBackdropHost(ctx: unknown, id = "adj"): HTMLElement {
  const host = makeHost(ONE_NODE, id);
  host.parentElement!.insertBefore(makeCaptureWrapper(ctx, id), host);
  return host;
}

describe("vfx runtime — self capture", () => {
  beforeEach(() => installVfxHarness("self"));
  afterEach(releaseVfxHarness);

  it("refuses a capture host that has no .hf-vfx-src canvas", () => {
    makeHost(ONE_NODE);

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/hf-vfx-src/);
  });

  it("names the Chrome flag when drawElementImage is missing", () => {
    makeCaptureHost({ clearRect: () => {} });

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/chrome:\/\/flags\/#canvas-draw-element/);
  });

  it("arms the page-composite protocol instead of painting inline in engine mode", () => {
    makeCaptureHost(createMockCtx2d());
    initVfx(document.body, 30);

    paintVfx(1.25, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_pending).toBe(true);
    expect(typeof compositeWindow().__hf_page_composite_resolve).toBe("function");
    expect(gl!.calls).toEqual([]);
  });

  it("captures, uploads and paints when the engine resolves, then clears the flag", () => {
    const ctx = createMockCtx2d();
    const host = makeCaptureHost(ctx);
    initVfx(document.body, 30);
    paintVfx(1.25, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_resolve!()).toBe(true);

    expect(ctx.drawn).toHaveLength(1);
    expect(ctx.drawn[0]!.el).toBe(host.querySelector(".hf-vfx-in"));
    // Cleared before the draw AND after the upload: the src canvas bitmap does
    // paint on screen even though its layoutsubtree children do not.
    expect(ctx.cleared).toEqual([
      [320, 180],
      [320, 180],
    ]);
    expect(gl!.calls).toEqual(["useProgram", "screen", "draw:1"]);
    expect(compositeWindow().__hf_page_composite_pending).toBe(false);
  });

  it("composes with a resolver that was already installed, running it first", () => {
    const order: string[] = [];
    compositeWindow().__hf_page_composite_resolve = () => {
      order.push("prior");
      return true;
    };
    const ctx = createMockCtx2d(() => order.push("vfx"));
    makeCaptureHost(ctx);
    initVfx(document.body, 30);

    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(order).toEqual(["prior", "vfx"]);
  });

  it("re-wraps a resolver that was installed after ours", () => {
    const order: string[] = [];
    const ctx = createMockCtx2d(() => order.push("vfx"));
    makeCaptureHost(ctx);
    initVfx(document.body, 30);
    paintVfx(0, { engineMode: true });

    // shader-transitions' 50 ms poll lands after us and assigns over the slot.
    compositeWindow().__hf_page_composite_resolve = () => {
      order.push("late");
      return true;
    };
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(order).toEqual(["late", "vfx"]);
  });

  it("reports a throwing drawElementImage loudly and paints nothing", () => {
    const ctx = createMockCtx2d(() => {
      throw new Error(
        "Failed to execute 'drawElementImage' on 'CanvasRenderingContext2D': " +
          "No cached paint record for element.",
      );
    });
    makeCaptureHost(ctx);
    initVfx(document.body, 30);
    paintVfx(0, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_resolve!()).toBe(false);
    expect(String(errors[0]![1])).toMatch(/No cached paint record for element/);
    expect(gl!.calls).toEqual([]);
  });

  it("skips a host the clip runtime has hidden at this time", () => {
    const ctx = createMockCtx2d();
    const host = makeCaptureHost(ctx);
    initVfx(document.body, 30);
    host.style.visibility = "hidden";

    paintVfx(0, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_pending).toBeUndefined();
    expect(ctx.drawn).toHaveLength(0);
  });

  it("asks the canvas to paint before capturing on the preview path", async () => {
    const ctx = createMockCtx2d();
    const host = makeCaptureHost(ctx);
    const src = host.querySelector("canvas.hf-vfx-src") as HTMLCanvasElement & {
      requestPaint?: () => void;
    };
    let requested = 0;
    src.requestPaint = () => {
      requested += 1;
    };
    initVfx(document.body, 30);

    paintVfx(0.5);
    expect(requested).toBe(1);
    expect(ctx.drawn).toHaveLength(0);

    src.dispatchEvent(new Event("paint"));
    await flushTasks();

    expect(ctx.drawn).toHaveLength(1);
    expect(compositeWindow().__hf_page_composite_pending).toBeUndefined();
  });

  /**
   * `seekCompositionTimeline` — the seek every `snapshot`/`check`/`compare`/
   * `validate`/`layout` run goes through — awaits
   * `window.__hfWaitForSeekCompletion` (this function) and then screenshots.
   * If the preview capture is not in that set, the screenshot is a race the
   * host count decides.
   *
   * rAF is stubbed to never call back so the ONLY thing that can finish
   * `awaitCanvasPaint` is a `paint` event; with the real one the barrier would
   * resolve on a timer and the case would prove nothing.
   */
  it("holds the seek-completion barrier until every capture host has painted", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const ctxA = createMockCtx2d();
    const ctxB = createMockCtx2d();
    const srcOf = (host: HTMLElement): HTMLCanvasElement =>
      host.querySelector("canvas.hf-vfx-src") as HTMLCanvasElement;
    const a = makeCaptureHost(ctxA, "cap-a");
    const b = makeCaptureHost(ctxB, "cap-b");
    initVfx(document.body, 30);

    paintVfx(0.5);
    let resolved = false;
    const barrier = waitForSeekCompletion().then(() => {
      resolved = true;
    });
    await flushTasks();
    const beforeAnyPaint = resolved;

    srcOf(a).dispatchEvent(new Event("paint"));
    await flushTasks();
    // Still held: one host of two is not a finished frame.
    const afterFirstPaint = resolved;

    srcOf(b).dispatchEvent(new Event("paint"));
    await flushTasks();
    await barrier;

    expect({
      beforeAnyPaint,
      afterFirstPaint,
      resolved,
      drawn: [ctxA.drawn.length, ctxB.drawn.length],
    }).toEqual({
      beforeAnyPaint: false,
      afterFirstPaint: false,
      resolved: true,
      drawn: [1, 1],
    });
    expect(errors).toEqual([]);
  });

  /**
   * The worst case the ceiling exists for: a host whose canvas never fires
   * `paint` AND whose rAF never calls back — what a BeginFrame-controlled
   * compositor (Linux headless-shell, `drawelement` capture) looks like when
   * `frameCapture.ts` drains this barrier before issuing the frame's
   * `HeadlessExperimental.beginFrame`. Unbounded, that host holds the barrier
   * every `__hfWaitForSeekCompletion` caller awaits forever.
   *
   * Fake timers so the 2 s ceiling costs no wall clock. The second host proves
   * the bound is per host: it paints promptly and is captured then, not after
   * the stalled host's ceiling.
   */
  it("bounds a never-painting host's wait, reports it loudly, and leaves its peers alone", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestAnimationFrame", () => 1);
      const ctxStalled = createMockCtx2d();
      const ctxPainting = createMockCtx2d();
      const srcOf = (host: HTMLElement): HTMLCanvasElement =>
        host.querySelector("canvas.hf-vfx-src") as HTMLCanvasElement;
      makeCaptureHost(ctxStalled, "cap-stalled");
      const painting = makeCaptureHost(ctxPainting, "cap-painting");
      initVfx(document.body, 30);

      paintVfx(0.5);
      let resolved = false;
      const barrier = waitForSeekCompletion().then(() => {
        resolved = true;
      });

      // The healthy host paints immediately and is captured on its own
      // schedule — before the stalled host's ceiling, not after it.
      srcOf(painting).dispatchEvent(new Event("paint"));
      await vi.advanceTimersByTimeAsync(0);
      const paintingDrawnEarly = ctxPainting.drawn.length;
      const heldBeforeCeiling = resolved;

      await vi.advanceTimersByTimeAsync(2000);
      await barrier;

      expect({
        paintingDrawnEarly,
        heldBeforeCeiling,
        resolved,
        stalledDrawn: ctxStalled.drawn.length,
        paintingDrawn: ctxPainting.drawn.length,
      }).toEqual({
        paintingDrawnEarly: 1,
        heldBeforeCeiling: false,
        resolved: true,
        // The stalled host is skipped, not guessed at.
        stalledDrawn: 0,
        paintingDrawn: 1,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]![0]).toBe(LABEL);
      expect(String(errors[0]![1])).toMatch(/#cap-stalled/);
      expect(String(errors[0]![1])).toMatch(/no paint arrived within 2000ms/);
      expect(String(errors[0]![1])).toMatch(/BeginFrame/);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Interface v1.1's `backdrop` shape. The def side is unchanged — a kernel that
 * reads `u_src` cannot tell whose pixels those are — so these cases are about
 * the DOM: where the wrapper is, and what happens to the layers inside it when
 * the host itself is not painting.
 */
describe("vfx runtime — backdrop capture", () => {
  beforeEach(() => installVfxHarness("self"));
  afterEach(releaseVfxHarness);

  it("reads its source from the data-vfx-for sibling and records it as a backdrop", () => {
    const ctx = createMockCtx2d();
    const host = makeBackdropHost(ctx, "adj-1");

    const registry = initVfx(document.body, 30);
    paintVfx(1.25, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_resolve!()).toBe(true);
    expect(registry).toHaveLength(1);
    // Resolved, not declared: the chain's defs say `self`, the DOM says the
    // pixels come from the wrapper beside the host.
    expect(registry[0]!.capture).toBe("backdrop");
    expect(host.querySelector(".hf-vfx-in")).toBeNull();
    expect(ctx.drawn.map((d) => d.el)).toEqual([
      document.querySelector('canvas[data-vfx-for="adj-1"] > .hf-vfx-in'),
    ]);
    expect(gl!.calls).toEqual(["useProgram", "screen", "draw:1"]);
    expect(errors).toEqual([]);
  });

  it("prefers the data-vfx-for sibling over a wrapper inside the host", () => {
    const below = createMockCtx2d();
    const own = createMockCtx2d();
    const host = makeBackdropHost(below, "adj-1");
    host.appendChild(makeCaptureWrapper(own));

    initVfx(document.body, 30);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect({ below: below.drawn.length, own: own.drawn.length }).toEqual({ below: 1, own: 0 });
  });

  it("keeps drawing the layers below while the backdrop host is hidden", () => {
    const ctx = createMockCtx2d();
    const host = makeBackdropHost(ctx, "adj-1");
    initVfx(document.body, 30);
    host.style.visibility = "hidden";

    paintVfx(0, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_pending).toBe(true);
    expect(compositeWindow().__hf_page_composite_resolve!()).toBe(true);
    expect({
      // Captured: the wrapper's children are invisible to the page compositor,
      // so an undrawn bitmap would delete every layer below the adjustment.
      drawn: ctx.drawn.length,
      // Cleared ONCE — before the draw. The second clear is what a painting
      // frame does to stop the raw capture showing through `.hf-vfx-out`;
      // here the bitmap IS the frame and must stay.
      cleared: ctx.cleared,
      // The kernel does not run: the adjustment layer is off.
      calls: gl!.calls,
    }).toEqual({ drawn: 1, cleared: [[320, 180]], calls: [] });
    expect(errors).toEqual([]);
  });

  it("passes the layers below through on the preview path too", async () => {
    const ctx = createMockCtx2d();
    const host = makeBackdropHost(ctx, "adj-1");
    const src = document.querySelector('canvas[data-vfx-for="adj-1"]')!;
    initVfx(document.body, 30);
    host.style.visibility = "hidden";

    paintVfx(0.5);
    src.dispatchEvent(new Event("paint"));
    await flushTasks();

    expect(ctx.drawn).toHaveLength(1);
    expect(gl!.calls).toEqual([]);
  });

  it("still skips a hidden self host, whose source is inside it", () => {
    const ctx = createMockCtx2d();
    const host = makeCaptureHost(ctx, "cap");
    initVfx(document.body, 30);
    host.style.visibility = "hidden";

    paintVfx(0, { engineMode: true });

    expect(compositeWindow().__hf_page_composite_pending).toBeUndefined();
    expect(ctx.drawn).toHaveLength(0);
  });

  it("reports a .hf-vfx-in that measures 0×0 once, not once per frame", () => {
    const ctx = createMockCtx2d();
    const host = makeCaptureHost(ctx, "cap");
    const inner = host.querySelector(".hf-vfx-in") as HTMLElement;
    sizeHost(inner, 0, 0);
    initVfx(document.body, 30);

    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();
    paintVfx(1, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(ctx.drawn).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]![1])).toMatch(/measures 0×0/);
    expect(String(errors[0]![1])).toMatch(/explicit width and height in px/);
  });

  it("refuses a .hf-vfx-in that is not the capture canvas's immediate child", () => {
    const ctx = createMockCtx2d();
    const host = makeCaptureHost(ctx, "cap");
    const inner = host.querySelector(".hf-vfx-in")!;
    const between = document.createElement("div");
    inner.parentElement!.appendChild(between);
    between.appendChild(inner);

    // Chrome: "Only immediate children of the <canvas> element can be passed
    // to DrawElementImage" — a registration error, not a per-frame throw.
    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/hf-vfx-in/);
  });
});

/**
 * Interface v1.1's second source: a `ref` param carrying the id of another
 * element, captured into `u_src2`. `luma-matte` is the first def to use one.
 */
describe("vfx runtime — ref (second source) params", () => {
  const REF_NODE =
    '{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{"matte":"matte-1"}}]}';

  /** The element a `ref` names, wrapped by the exporter like any other source. */
  function makeRefTarget(ctx: unknown, id = "matte-1", wrapped = true): HTMLElement {
    const el = document.createElement("div");
    el.id = id;
    sizeHost(el);
    if (wrapped) el.appendChild(makeCaptureWrapper(ctx));
    document.body.appendChild(el);
    return el;
  }

  beforeEach(() => installVfxHarness("self", "matte"));
  afterEach(releaseVfxHarness);

  it("captures the ref's element into u_src2 alongside the host's own u_src", () => {
    const ctx = createMockCtx2d();
    const matteCtx = createMockCtx2d();
    makeRefTarget(matteCtx);
    makeCaptureHost(ctx, "cap", REF_NODE);

    expect(initVfx(document.body, 30)).toHaveLength(1);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect({ src: ctx.drawn.length, matte: matteCtx.drawn.length }).toEqual({ src: 1, matte: 1 });
    // Unit 0 is the chain's own texture, unit 1 the second source.
    expect(gl!.uniforms["u_src"]).toBe(0);
    expect(gl!.uniforms["u_src2"]).toBe(1);
    expect(errors).toEqual([]);
  });

  it("captures one texture for two nodes that name the same element", () => {
    const ctx = createMockCtx2d();
    const matteCtx = createMockCtx2d();
    makeRefTarget(matteCtx);
    makeCaptureHost(
      ctx,
      "cap",
      '{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{"matte":"matte-1"}},' +
        '{"type":"fractal-noise","id":"n2","params":{"matte":"matte-1"}}]}',
    );

    initVfx(document.body, 30);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(matteCtx.drawn).toHaveLength(1);
  });

  it("refuses a ref whose element carries no capture wrapper", () => {
    makeRefTarget(undefined, "matte-1", false);
    makeCaptureHost(createMockCtx2d(), "cap", REF_NODE);

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/"matte" source/);
    expect(String(errors[0]![1])).toMatch(/hf-vfx-src/);
  });

  it("refuses a ref naming an element that is not in the composition", () => {
    makeCaptureHost(createMockCtx2d(), "cap", REF_NODE);

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/#matte-1/);
    expect(String(errors[0]![1])).toMatch(/not in the composition/);
  });

  it("refuses a node that names no ref element at all", () => {
    makeCaptureHost(createMockCtx2d(), "cap", ONE_NODE);

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/needs a "matte" param/);
  });

  it("captures a hidden matte as empty instead of failing the frame", async () => {
    // The exporter wraps a matte layer's own element, and the clip runtime
    // hides that element outside its window — so `.hf-vfx-in` is hidden too.
    // Waiting for a paint that cannot come would burn the 2 s ceiling on every
    // frame of a matte's out point, and drawing it would throw. Only the matte
    // ELEMENT is hidden here: the wrapper inside it inherits it, which is the
    // shape the exporter and the clip runtime actually produce.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const ctx = createMockCtx2d();
    const matteCtx = createMockCtx2d();
    const matte = makeRefTarget(matteCtx);
    const host = makeCaptureHost(ctx, "cap", REF_NODE);
    initVfx(document.body, 30);
    matte.style.visibility = "hidden";

    paintVfx(0.5);
    host.querySelector("canvas.hf-vfx-src")!.dispatchEvent(new Event("paint"));
    await flushTasks();

    expect({ src: ctx.drawn.length, matte: matteCtx.drawn.length }).toEqual({ src: 1, matte: 0 });
    // An empty u_src2, not a skipped frame: the host still paints, and the
    // kernel reads a matte that covers nothing.
    expect(gl!.calls).toEqual(["useProgram", "screen", "draw:1"]);
    expect(errors).toEqual([]);
  });

  it("keeps a visible ref's bitmap and draws it at the ref's own box", async () => {
    // retro-wave `Logo Anim` layer 5 is layer 4's displacement map AND a layer
    // that paints: clearing its bitmap after the upload would delete it from
    // the frame, and drawing it at the host's box would resample it.
    const ctx = createMockCtx2d();
    const matteCtx = createMockCtx2d();
    const matte = makeRefTarget(matteCtx);
    matte.querySelector("canvas.hf-vfx-src")!.setAttribute("data-vfx-ref-visible", "");
    sizeHost(matte.querySelector(".hf-vfx-in") as HTMLElement, 640, 360);
    makeCaptureHost(ctx, "cap", REF_NODE);

    initVfx(document.body, 30);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(matteCtx.drawn).toEqual([{ el: matte.querySelector(".hf-vfx-in"), w: 640, h: 360 }]);
    // Cleared once, before the draw: the bitmap that is left is the layer.
    expect(matteCtx.cleared).toEqual([[640, 360]]);
    // The host's own capture is unchanged — host box, cleared after upload.
    expect(ctx.drawn.map((d) => [d.w, d.h])).toEqual([[320, 180]]);
    expect(ctx.cleared).toEqual([
      [320, 180],
      [320, 180],
    ]);
    expect(errors).toEqual([]);
  });

  it("clears an ordinary ref's bitmap and draws it at the host's box", () => {
    const matteCtx = createMockCtx2d();
    const matte = makeRefTarget(matteCtx);
    sizeHost(matte.querySelector(".hf-vfx-in") as HTMLElement, 640, 360);
    makeCaptureHost(createMockCtx2d(), "cap", REF_NODE);

    initVfx(document.body, 30);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    // Host box, so `u_src`, `u_src2` and `.hf-vfx-out` share a pixel grid.
    expect(matteCtx.drawn.map((d) => [d.w, d.h])).toEqual([[320, 180]]);
    expect(matteCtx.cleared).toEqual([
      [320, 180],
      [320, 180],
    ]);
  });

  it("holds the preview barrier until the ref's canvas has painted too", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const ctx = createMockCtx2d();
    const matteCtx = createMockCtx2d();
    const matte = makeRefTarget(matteCtx);
    const host = makeCaptureHost(ctx, "cap", REF_NODE);
    initVfx(document.body, 30);

    paintVfx(0.5);
    let resolved = false;
    const barrier = waitForSeekCompletion().then(() => {
      resolved = true;
    });
    host.querySelector("canvas.hf-vfx-src")!.dispatchEvent(new Event("paint"));
    await flushTasks();
    const afterHostPaint = resolved;

    matte.querySelector("canvas.hf-vfx-src")!.dispatchEvent(new Event("paint"));
    await flushTasks();
    await barrier;

    expect({ afterHostPaint, resolved, matte: matteCtx.drawn.length }).toEqual({
      afterHostPaint: false,
      resolved: true,
      matte: 1,
    });
  });
});

/**
 * `displacement-map`'s `map` ref (plan Backlog, "one-line def change after
 * Task 2.6"). Optional, so the self-referential form every corpus instance
 * uses keeps working untouched.
 */
describe("vfx runtime — an optional ref (displacement-map's map)", () => {
  const mapChain = (params: Record<string, unknown>): string =>
    JSON.stringify({
      version: 1,
      nodes: [{ type: "displacement-map", id: "n1", params }],
    });

  function makeMapTarget(ctx: unknown, id = "map-1"): HTMLElement {
    const el = document.createElement("div");
    el.id = id;
    sizeHost(el);
    el.appendChild(makeCaptureWrapper(ctx));
    document.body.appendChild(el);
    return el;
  }

  beforeEach(() => installVfxHarness(null));
  afterEach(releaseVfxHarness);

  it("binds a named map element as u_src2 and tells the kernel it is there", () => {
    const ctx = createMockCtx2d();
    const mapCtx = createMockCtx2d();
    const map = makeMapTarget(mapCtx);
    makeCaptureHost(ctx, "cap", mapChain({ useH: 1, maxH: 20, map: "map-1" }));

    expect(initVfx(document.body, 30)).toHaveLength(1);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(mapCtx.drawn[0]!.el).toBe(map.querySelector(".hf-vfx-in"));
    expect(gl!.uniforms["u_src2"]).toBe(1);
    expect(gl!.uniforms["u_hasSrc2"]).toBe(1);
    expect(errors).toEqual([]);
  });

  it("falls back to the layer's own pixels when the map is empty", () => {
    const ctx = createMockCtx2d();
    makeCaptureHost(ctx, "cap", mapChain({ useH: 1, maxH: 20 }));

    expect(initVfx(document.body, 30)).toHaveLength(1);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    // One capture, not two, and the kernel is told to read `u_src` as its map.
    expect(ctx.drawn).toHaveLength(1);
    expect(gl!.uniforms["u_hasSrc2"]).toBe(0);
    expect(errors).toEqual([]);
  });

  it("treats a map naming the host itself as the self-referential form", () => {
    const ctx = createMockCtx2d();
    makeCaptureHost(ctx, "cap", mapChain({ useH: 1, maxH: 20, map: "cap" }));

    expect(initVfx(document.body, 30)).toHaveLength(1);
    paintVfx(0, { engineMode: true });
    compositeWindow().__hf_page_composite_resolve!();

    expect(ctx.drawn).toHaveLength(1);
    expect(gl!.uniforms["u_hasSrc2"]).toBe(0);
    expect(errors).toEqual([]);
  });

  it("still refuses a map that names an element with no capture wrapper", () => {
    const orphan = document.createElement("div");
    orphan.id = "map-1";
    document.body.appendChild(orphan);
    makeCaptureHost(createMockCtx2d(), "cap", mapChain({ map: "map-1" }));

    expect(initVfx(document.body, 30)).toHaveLength(0);
    expect(String(errors[0]![1])).toMatch(/"map" source/);
  });
});
