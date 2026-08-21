// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// html2canvas needs a real browser. The snapshot pipeline only cares that it
// gets back a canvas it can encode, so stand in a stub and keep the test on the
// context-loss behaviour.
vi.mock("./capture.js", () => ({
  initCapture: () => undefined,
  isHtmlInCanvasCaptureSupported: () => false,
  captureScene: () =>
    Promise.resolve({
      width: 8,
      height: 8,
      toBlob: (cb: (blob: Blob) => void) => cb(new Blob(["x"])),
    } as unknown as HTMLCanvasElement),
}));

import { init, type TransitionConfig } from "./hyper-shader.js";

let drawArraysCalls = 0;
let createProgramCalls = 0;
let loseContextCalls = 0;
let webglContextCount = 0;

function createMockWebGl(): WebGLRenderingContext {
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    createProgram: () => {
      createProgramCalls += 1;
      return {};
    },
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    createTexture: () => ({}),
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    texImage2D: () => undefined,
    createFramebuffer: () => ({}),
    bindFramebuffer: () => undefined,
    framebufferTexture2D: () => undefined,
    createBuffer: () => ({}),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    getAttribLocation: () => 0,
    getUniformLocation: (_p: WebGLProgram, name: string) => name,
    viewport: () => undefined,
    useProgram: () => undefined,
    activeTexture: () => undefined,
    pixelStorei: () => undefined,
    uniform1i: () => undefined,
    uniform1f: () => undefined,
    uniform2f: () => undefined,
    uniform3f: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    drawArrays: () => {
      drawArraysCalls += 1;
    },
    deleteTexture: () => undefined,
    getExtension: (name: string) =>
      name === "WEBGL_lose_context"
        ? {
            loseContext: () => {
              loseContextCalls += 1;
            },
          }
        : null,
  } as unknown as WebGLRenderingContext;
}

interface FakeTimeline {
  paused: () => boolean;
  play: (from?: number) => FakeTimeline;
  pause: (at?: number) => FakeTimeline;
  time: (value?: number) => FakeTimeline | number;
  call: () => FakeTimeline;
  to: () => FakeTimeline;
  set: () => FakeTimeline;
  from: () => FakeTimeline;
  fromTo: () => FakeTimeline;
  [key: string]: unknown;
}

function makeTimeline(): FakeTimeline {
  let position = 0;
  let paused = true;
  const tl: FakeTimeline = {
    paused: () => paused,
    play: (from?: number) => {
      if (typeof from === "number") position = from;
      paused = false;
      return tl;
    },
    pause: (at?: number) => {
      if (typeof at === "number") position = at;
      paused = true;
      return tl;
    },
    time: (value?: number) => {
      if (value === undefined) return position;
      position = value;
      return tl;
    },
    call: () => tl,
    to: () => tl,
    set: () => tl,
    from: () => tl,
    fromTo: () => tl,
  };
  return tl;
}

function setupDom(): void {
  document.body.innerHTML = `
    <div data-composition-id="main" data-width="320" data-height="180" data-duration="4">
      <div id="s1" class="scene"></div>
      <div id="s2" class="scene"></div>
    </div>`;
}

function startShader(transitions: TransitionConfig[]): {
  timeline: { time: (value: number) => void };
  glCanvas: HTMLCanvasElement;
} {
  const timeline = makeTimeline();
  init({
    bgColor: "#000",
    scenes: ["s1", "s2"],
    transitions,
    timeline: timeline as never,
    compositionId: "main",
    previewCaptureFps: 1,
  });
  const glCanvas = document.getElementById("gl-canvas");
  if (!(glCanvas instanceof HTMLCanvasElement)) throw new Error("gl canvas missing");
  return {
    timeline: {
      time: (value: number) => {
        (timeline.time as (v: number) => unknown)(value);
      },
    },
    glCanvas,
  };
}

/** Wait for the prewarm + texture-upload promise chains to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function sceneOpacity(id: string): string {
  return document.getElementById(id)?.style.opacity ?? "";
}

const SHADER_TRANSITION: TransitionConfig = { time: 1, duration: 1, shader: "glitch" };
const CSS_TRANSITION: TransitionConfig = { time: 1, duration: 1 };

describe("HyperShader WebGL context loss", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    drawArraysCalls = 0;
    createProgramCalls = 0;
    loseContextCalls = 0;
    webglContextCount = 0;
    setupDom();
    // No IndexedDB: the snapshot cache degrades to in-memory blobs, which is
    // all this test needs.
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("createImageBitmap", () => Promise.resolve({}));
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
      type: string,
    ) => {
      if (type !== "webgl") return null;
      webglContextCount += 1;
      return createMockWebGl();
    }) as never) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    // Drain this test's beforeunload teardown (registered `{ once: true }`) so
    // it cannot fire during the next test on the shared window.
    window.dispatchEvent(new Event("beforeunload"));
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("stops shader work without throwing when the context is lost", async () => {
    const { timeline, glCanvas } = startShader([SHADER_TRANSITION]);
    await settle();
    timeline.time(1.5);
    await settle();
    timeline.time(1.5);
    expect(drawArraysCalls).toBeGreaterThan(0);

    const lost = new Event("webglcontextlost", { cancelable: true });
    glCanvas.dispatchEvent(lost);

    expect(lost.defaultPrevented).toBe(true);
    expect(glCanvas.style.display).toBe("none");

    drawArraysCalls = 0;
    expect(() => timeline.time(1.5)).not.toThrow();
    await settle();
    expect(drawArraysCalls).toBe(0);
    expect(glCanvas.style.display).toBe("none");
    // The transition still plays — as a DOM crossfade.
    expect(Number(sceneOpacity("s1"))).toBeCloseTo(0.5, 5);
    expect(Number(sceneOpacity("s2"))).toBeCloseTo(0.5, 5);
  });

  it("rebuilds and resumes rendering when the context is restored", async () => {
    const { timeline, glCanvas } = startShader([SHADER_TRANSITION]);
    await settle();
    timeline.time(1.5);
    await settle();

    glCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const programsBeforeRestore = createProgramCalls;
    drawArraysCalls = 0;

    glCanvas.dispatchEvent(new Event("webglcontextrestored"));

    // Programs, buffers and render targets are rebuilt, not reused.
    expect(createProgramCalls).toBeGreaterThan(programsBeforeRestore);

    await settle();
    timeline.time(1.5);
    expect(drawArraysCalls).toBeGreaterThan(0);
    expect(glCanvas.style.display).toBe("block");
  });

  it("releases the context on teardown instead of leaving it to GC", async () => {
    startShader([SHADER_TRANSITION]);
    await settle();
    expect(webglContextCount).toBe(1);
    expect(loseContextCalls).toBe(0);

    window.dispatchEvent(new Event("beforeunload"));

    expect(loseContextCalls).toBe(1);
  });

  // Browsers cap concurrent WebGL contexts (~16) and silently drop the oldest,
  // so init() must not take one on spec — only a shader transition that is
  // actually going to draw may.
  it("defers context creation until a shader transition needs it", async () => {
    const { timeline } = startShader([SHADER_TRANSITION]);
    expect(webglContextCount).toBe(0);

    await settle();
    timeline.time(1.5);
    await settle();
    timeline.time(1.5);

    expect(webglContextCount).toBe(1);
    expect(drawArraysCalls).toBeGreaterThan(0);
  });

  it("leaves a composition without shader transitions unaffected, and takes no context", async () => {
    const { timeline, glCanvas } = startShader([CSS_TRANSITION]);
    await settle();
    timeline.time(1.5);
    await settle();
    expect(webglContextCount).toBe(0);
    expect(drawArraysCalls).toBe(0);
    expect(Number(sceneOpacity("s1"))).toBeCloseTo(0.5, 5);

    glCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

    expect(() => timeline.time(1.5)).not.toThrow();
    expect(Number(sceneOpacity("s1"))).toBeCloseTo(0.5, 5);
    expect(Number(sceneOpacity("s2"))).toBeCloseTo(0.5, 5);
    expect(drawArraysCalls).toBe(0);
  });
});
