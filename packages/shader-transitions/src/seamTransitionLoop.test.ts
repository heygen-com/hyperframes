import { afterEach, describe, expect, it, vi } from "vitest";
import { playSeamTransitionLoop, type SeamTransitionFrameSource } from "./seamTransitionLoop.js";

/** Minimal WebGL double covering every gl call seamTransitionLoop's setup and
 * per-frame render path make (webgl.ts's createContext/setupQuad/
 * createProgram/createTexture/uploadTextureSource/renderShader). */
function createMockGl() {
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    TEXTURE_2D: 7,
    TEXTURE_WRAP_S: 8,
    TEXTURE_WRAP_T: 9,
    CLAMP_TO_EDGE: 10,
    TEXTURE_MIN_FILTER: 11,
    TEXTURE_MAG_FILTER: 12,
    LINEAR: 13,
    RGBA: 14,
    UNSIGNED_BYTE: 15,
    TEXTURE0: 16,
    TEXTURE1: 17,
    TRIANGLE_STRIP: 18,
    UNPACK_FLIP_Y_WEBGL: 19,
    FLOAT: 20,
    viewport: vi.fn(),
    pixelStorei: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    bufferData: vi.fn(),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    createTexture: vi.fn(() => ({})),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawArrays: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    getAttribLocation: vi.fn(() => 0),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
  };
}

function createMockCanvas(
  gl: ReturnType<typeof createMockGl> | null,
  size: { width: number; height: number } = { width: 640, height: 360 },
) {
  return { getContext: vi.fn(() => gl), ...size } as unknown as HTMLCanvasElement;
}

function stubRaf() {
  let pending: FrameRequestCallback | null = null;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      pending = cb;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    /** Runs the most recently scheduled frame, if any. */
    flush: (nowMs = 0) => {
      const cb = pending;
      pending = null;
      cb?.(nowMs);
    },
  };
}

const fromSource = {} as SeamTransitionFrameSource;
const toSource = {} as SeamTransitionFrameSource;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A loop not yet flushed, for tests that control frame timing themselves. */
function startLoop(options?: Parameters<typeof playSeamTransitionLoop>[4]) {
  const raf = stubRaf();
  const gl = createMockGl();
  const canvas = createMockCanvas(gl);
  const handle = playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan", options);
  return { raf, gl, canvas, handle };
}

/** A loop already past its first frame, for tests that only care about `stop()`. */
function startRunningLoop() {
  const loop = startLoop();
  loop.raf.flush(0);
  return loop;
}

describe("playSeamTransitionLoop", () => {
  it("throws synchronously for a shader with no WebGL implementation", () => {
    const canvas = createMockCanvas(createMockGl());
    expect(() => playSeamTransitionLoop(canvas, fromSource, toSource, "not-a-real-shader")).toThrow(
      /Unknown shader/,
    );
  });

  it("plays glitch directly (unaliased catalog name, unquoted registry key)", () => {
    const raf = stubRaf();
    const gl = createMockGl();
    const canvas = createMockCanvas(gl);
    const handle = playSeamTransitionLoop(canvas, fromSource, toSource, "glitch");

    raf.flush(0);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("throws synchronously when the canvas yields no WebGL context", () => {
    stubRaf();
    const canvas = createMockCanvas(null);
    expect(() => playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan")).toThrow(
      /No WebGL context/,
    );
  });

  it("resolves ready only after the first frame is drawn", async () => {
    const raf = stubRaf();
    const gl = createMockGl();
    const canvas = createMockCanvas(gl);
    const handle = playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan");

    let readyResolved = false;
    void handle.ready.then(() => (readyResolved = true));
    await Promise.resolve();
    expect(readyResolved).toBe(false);
    expect(gl.drawArrays).not.toHaveBeenCalled();

    raf.flush(0);
    await handle.ready;
    expect(readyResolved).toBe(true);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it.each(["domain-warp-dissolve", "chromatic-radial-split"])(
    "resolves catalog block name %s, which differs from its registry key",
    (catalogName) => {
      const raf = stubRaf();
      const gl = createMockGl();
      const canvas = createMockCanvas(gl);
      const handle = playSeamTransitionLoop(canvas, fromSource, toSource, catalogName);

      raf.flush(0);
      expect(gl.drawArrays).toHaveBeenCalledTimes(1);
      handle.stop();
    },
  );

  it("stop() deletes its own program, textures and buffer, and is idempotent", () => {
    const { gl, handle } = startRunningLoop();

    handle.stop();
    handle.stop();

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("does not lose the WebGL context on stop(), so the canvas is reusable", () => {
    // The mock gl has no getExtension at all: a lost context can never be
    // reacquired via canvas.getContext(), so stop() must never reach for
    // WEBGL_lose_context. Calling it here would throw "not a function".
    const { handle } = startRunningLoop();

    expect(() => handle.stop()).not.toThrow();
  });

  it("resolves ready even if stop() runs before any frame is drawn", async () => {
    stubRaf();
    const gl = createMockGl();
    const canvas = createMockCanvas(gl);
    const handle = playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan");

    handle.stop();

    await handle.ready;
    expect(gl.drawArrays).not.toHaveBeenCalled();
  });

  it("starts progress at 0 relative to its own first frame, not the raw rAF timestamp", () => {
    const { raf, gl, handle } = startLoop({ loopMs: 1000 });

    // A page that has been open a while hands rAF an arbitrary large timestamp
    // on the very first call, deliberately NOT a multiple of loopMs; that must
    // still count as elapsed=0 for this loop, not (nowMs % loopMs) of the raw
    // navigation-relative clock.
    raf.flush(70_437);
    expect(gl.uniform1f).toHaveBeenLastCalledWith(expect.anything(), 0);

    raf.flush(70_437 + 300);
    expect(gl.uniform1f).toHaveBeenLastCalledWith(expect.anything(), expect.closeTo(0.6, 5));

    handle.stop();
  });

  it("comes back down in the second half of the loop instead of climbing past 1", () => {
    const { raf, gl, handle } = startLoop({ loopMs: 1000 });

    raf.flush(0); // elapsed 0 -> progress 0
    raf.flush(500); // elapsed 500 -> the peak, progress 1
    expect(gl.uniform1f).toHaveBeenLastCalledWith(expect.anything(), 1);

    raf.flush(700); // elapsed 700 -> descending, progress 0.6
    expect(gl.uniform1f).toHaveBeenLastCalledWith(expect.anything(), expect.closeTo(0.6, 5));

    handle.stop();
  });

  it.each([0, -1000, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws synchronously for an invalid loopMs (%s)",
    (loopMs) => {
      const canvas = createMockCanvas(createMockGl());
      expect(() =>
        playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan", { loopMs }),
      ).toThrow(/loopMs/);
    },
  );

  it("passes the render pipeline's default accent colors, not none", () => {
    const { gl } = startRunningLoop();
    expect(gl.uniform3f).toHaveBeenCalledTimes(3);
  });

  it("defaults width/height to the canvas's own drawing-buffer size", () => {
    const raf = stubRaf();
    const gl = createMockGl();
    const canvas = createMockCanvas(gl, { width: 320, height: 180 });
    const handle = playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan");

    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 320, 180);
    raf.flush(0);
    handle.stop();
  });

  it("an explicit width/height option overrides the canvas's own size", () => {
    const raf = stubRaf();
    const gl = createMockGl();
    const canvas = createMockCanvas(gl, { width: 320, height: 180 });
    const handle = playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan", {
      width: 100,
      height: 50,
    });

    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 100, 50);
    raf.flush(0);
    handle.stop();
  });

  it("does not draw again after stop()", () => {
    const { raf, gl, handle } = startRunningLoop();
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);

    handle.stop();
    raf.flush(16);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
  });
});
