import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playSeamTransitionLoop,
  type SeamTransitionFrameSource,
  type SeamTransitionLoopOptions,
} from "./seamTransitionLoop.js";
import { DEFAULT_ACCENT_COLORS } from "./webgl.js";

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

/** A loop not yet flushed, for tests that control frame timing or the shader themselves. */
function startLoop(options?: SeamTransitionLoopOptions, shaderName = "whip-pan") {
  const raf = stubRaf();
  const gl = createMockGl();
  const canvas = createMockCanvas(gl);
  const handle = playSeamTransitionLoop(canvas, fromSource, toSource, shaderName, options);
  return { raf, gl, canvas, handle };
}

/** A loop already past its first frame, for tests that only care about `stop()`. */
function startRunningLoop() {
  const loop = startLoop();
  loop.raf.flush(0);
  return loop;
}

describe("playSeamTransitionLoop", () => {
  it.each(["not-a-real-shader", "constructor", "toString", "__proto__"])(
    "throws synchronously for %s, a name with no WebGL implementation",
    (name) => {
      const canvas = createMockCanvas(createMockGl());
      expect(() => playSeamTransitionLoop(canvas, fromSource, toSource, name)).toThrow(
        /Unknown shader/,
      );
    },
  );

  it.each(["glitch", "domain-warp-dissolve", "chromatic-radial-split"])(
    "resolves catalog block name %s (glitch is unaliased and unquoted; the others differ from their registry key)",
    (catalogName) => {
      const { raf, gl, handle } = startLoop(undefined, catalogName);
      raf.flush(0);
      expect(gl.drawArrays).toHaveBeenCalledTimes(1);
      handle.stop();
    },
  );

  it("throws synchronously when the canvas yields no WebGL context", () => {
    stubRaf();
    const canvas = createMockCanvas(null);
    expect(() => playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan")).toThrow(
      /No WebGL context/,
    );
  });

  it("resolves ready only after the first frame is drawn", async () => {
    const { raf, gl, handle } = startLoop();

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
    const { gl, handle } = startLoop();

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

  it.each([
    ["loopMs", { loopMs: 0 }],
    ["loopMs", { loopMs: -1000 }],
    ["loopMs", { loopMs: Number.NaN }],
    ["loopMs", { loopMs: Number.POSITIVE_INFINITY }],
    ["width", { width: 0 }],
    ["width", { width: Number.NaN }],
    ["height", { height: -180 }],
  ] satisfies [string, SeamTransitionLoopOptions][])(
    "throws synchronously for an invalid %s (%j)",
    (name, options) => {
      const canvas = createMockCanvas(createMockGl());
      expect(() =>
        playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan", options),
      ).toThrow(new RegExp(name));
    },
  );

  it("passes the default accent colors (hyper-shader.ts's own fallback), not none", () => {
    const { gl, handle } = startRunningLoop();
    expect(gl.uniform3f).toHaveBeenCalledWith(expect.anything(), ...DEFAULT_ACCENT_COLORS.accent);
    expect(gl.uniform3f).toHaveBeenCalledWith(expect.anything(), ...DEFAULT_ACCENT_COLORS.dark);
    expect(gl.uniform3f).toHaveBeenCalledWith(expect.anything(), ...DEFAULT_ACCENT_COLORS.bright);
    handle.stop();
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

  it("frees whatever it already allocated when setup throws partway through", () => {
    stubRaf();
    const gl = createMockGl();
    let texImage2DCalls = 0;
    gl.texImage2D.mockImplementation(() => {
      texImage2DCalls += 1;
      // 1st/2nd calls are createTexture's placeholder upload for texFrom/texTo;
      // 3rd is the real upload for texFrom. Fail on the 4th (texTo's real
      // upload) once both textures already exist, to prove the ones that
      // succeeded before the throw get cleaned up, not just skipped.
      if (texImage2DCalls === 4) throw new Error("bad toSource");
    });
    const canvas = createMockCanvas(gl);

    expect(() => playSeamTransitionLoop(canvas, fromSource, toSource, "whip-pan")).toThrow(
      "bad toSource",
    );

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
