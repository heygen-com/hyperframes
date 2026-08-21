// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createProgram, manageContextLoss } from "./webgl.js";

function createMockWebGl(): WebGLRenderingContext {
  const loseContext = vi.fn();
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
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
    getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null)),
  } as unknown as WebGLRenderingContext;
}

describe("manageContextLoss", () => {
  it("cancels the default loss action so the context can be restored", () => {
    const canvas = document.createElement("canvas");
    const gl = createMockWebGl();
    const onLost = vi.fn();
    manageContextLoss(canvas, gl, { onLost, onRestored: vi.fn() });

    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);

    expect(lost.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("reports restoration", () => {
    const canvas = document.createElement("canvas");
    const onRestored = vi.fn();
    manageContextLoss(canvas, createMockWebGl(), { onLost: vi.fn(), onRestored });

    canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("releases the context explicitly on teardown and stops listening", () => {
    const canvas = document.createElement("canvas");
    const gl = createMockWebGl();
    const onLost = vi.fn();
    const release = manageContextLoss(canvas, gl, { onLost, onRestored: vi.fn() });

    release();

    const extension = vi.mocked(gl.getExtension).mock.results[0]?.value as {
      loseContext: () => void;
    };
    expect(extension.loseContext).toHaveBeenCalledTimes(1);

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onLost).not.toHaveBeenCalled();
  });
});

describe("createProgram", () => {
  // The vertex shader used to be cached in a module-level singleton, which
  // outlived the context it was compiled in — after a restore every program
  // linked against a dead shader.
  it("compiles a fresh vertex shader per program", () => {
    const gl = createMockWebGl();

    createProgram(gl, "void main(){}");
    createProgram(gl, "void main(){}");

    const vertexCompiles = vi
      .mocked(gl.createShader)
      .mock.calls.filter(([type]) => type === gl.VERTEX_SHADER);
    expect(vertexCompiles).toHaveLength(2);
  });
});
