import { describe, expect, it, vi } from "vitest";
import { createProgram } from "./webgl.js";

/** Model WebGL's rule that shader handles belong to the context that created them. */
function createMockContext() {
  const shaders = new Set<WebGLShader>();
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createShader: vi.fn(() => {
      const shader = {};
      shaders.add(shader);
      return shader;
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn((_program: WebGLProgram, shader: WebGLShader) => {
      if (!shaders.has(shader)) throw new Error("Shader belongs to another WebGL context");
    }),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
  };
  return gl;
}

describe("createProgram", () => {
  it("uses context-owned shaders across multiple contexts and repeated calls", () => {
    const first = createMockContext();
    const second = createMockContext();
    const fragment = "precision mediump float;void main(){gl_FragColor=vec4(1.0);}";

    for (const gl of [first, second, first, second]) {
      // The test double implements only the WebGL methods used to create a program.
      expect(() => createProgram(gl as unknown as WebGLRenderingContext, fragment)).not.toThrow();
    }

    expect(first.linkProgram).toHaveBeenCalledTimes(2);
    expect(second.linkProgram).toHaveBeenCalledTimes(2);
  });
});
