import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initVfx, paintVfx } from "./vfx";

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

/** Hosts are 0×0 in jsdom; the runtime refuses to paint a zero-area box. */
function sizeHost(host: HTMLElement, width = 320, height = 180): void {
  host.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
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

describe("vfx runtime", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    gl = createMockGl();
    installCanvasMock(() => gl);
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
  });

  afterEach(() => {
    // Empty the registry BEFORE the canvas mock comes off, or jsdom's real
    // (unimplemented) getContext runs and floods the console.
    document.body.innerHTML = "";
    initVfx(document.body, 30);
    vi.restoreAllMocks();
  });

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

    expect(gl!.calls).toEqual(["fbo", "useProgram", "draw:1", "screen", "useProgram", "draw:2"]);
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

  it("does not paint a host whose box has no area", () => {
    const host = makeHost(ONE_NODE);
    sizeHost(host, 0, 0);
    initVfx(document.body, 30);

    paintVfx(0);

    expect(gl!.calls).toEqual([]);
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
