// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HF_COLOR_GRADING_ATTR, serializeHfColorGrading } from "../colorGrading";
import {
  createColorGradingRuntime,
  installAuthoredOpacityCapture,
  type RuntimeColorGradingApi,
} from "./colorGrading";

let lastUniform1f: ReturnType<typeof vi.fn> | null = null;
let lastUniform3f: ReturnType<typeof vi.fn> | null = null;
let lastShaderSources: string[] = [];
let texImage2DCalls: unknown[][] = [];

const IDENTITY_2 = `
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

function createMockWebGl(options: { failMediaUpload?: boolean } = {}): WebGLRenderingContext {
  const shader = {};
  const program = {};
  const texture = {};
  const buffer = {};
  const uniform1f = vi.fn();
  const uniform3f = vi.fn();
  lastUniform1f = uniform1f;
  lastUniform3f = uniform3f;
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
    NEAREST: 0x2600,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    createShader: vi.fn(() => shader),
    shaderSource: vi.fn((_shader, source: string) => {
      lastShaderSources.push(source);
    }),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => program),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteProgram: vi.fn(),
    createTexture: vi.fn(() => texture),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn((...args: unknown[]) => {
      texImage2DCalls.push(args);
      if (options.failMediaUpload && args.length === 6) {
        throw new Error("Media cannot be sampled by WebGL");
      }
    }),
    createFramebuffer: vi.fn(() => ({})),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    deleteFramebuffer: vi.fn(),
    createBuffer: vi.fn(() => buffer),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn((_program, name: string) => name),
    viewport: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    pixelStorei: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f,
    uniform3f,
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawArrays: vi.fn(),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
  } as unknown as WebGLRenderingContext;
}

function makeDrawableVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.id = "hero-video";
  video.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ adjust: { exposure: 0.5 } }));
  Object.defineProperty(video, "readyState", {
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
    configurable: true,
  });
  Object.defineProperty(video, "videoWidth", { value: 640, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 360, configurable: true });
  Object.defineProperty(video, "offsetWidth", { value: 640, configurable: true });
  Object.defineProperty(video, "offsetHeight", { value: 360, configurable: true });
  Object.defineProperty(video, "offsetLeft", { value: 0, configurable: true });
  Object.defineProperty(video, "offsetTop", { value: 0, configurable: true });
  video.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    }) as DOMRect;
  return video;
}

function stubCubeLutFetch(text = IDENTITY_2): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(text),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createColorGradingRuntime", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let runtime: RuntimeColorGradingApi | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    lastUniform1f = null;
    lastUniform3f = null;
    lastShaderSources = [];
    texImage2DCalls = [];
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((type: string) =>
        type === "webgl" ? createMockWebGl() : null,
      ) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    runtime?.destroy();
    runtime = null;
    vi.unstubAllGlobals();
    getContextSpy.mockRestore();
    delete window.__hfVariables;
    delete window.__hfVariablesByComp;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  function startRuntimeWithVideo(video = makeDrawableVideo()): {
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
  } {
    document.body.appendChild(video);
    runtime = createColorGradingRuntime();
    const canvas = document.querySelector<HTMLCanvasElement>("[data-hf-color-grading-canvas]");
    if (!canvas) throw new Error("Expected color grading canvas");
    return { video, canvas };
  }

  async function flushLutLoad(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    runtime?.redraw();
  }

  it("restores the authored inline opacity captured before animation transients", () => {
    const video = makeDrawableVideo();
    // Parse-time capture stamped the authored value; by hide time GSAP has
    // already left a from()-tween transient (0) in the inline style.
    video.setAttribute("data-hf-authored-opacity", "0.75");
    video.style.opacity = "0";
    startRuntimeWithVideo(video);

    expect(video.style.getPropertyPriority("opacity")).toBe("important");

    runtime?.destroy();
    runtime = null;

    // Restore must use the authored 0.75, not the GSAP transient 0.
    expect(video.style.getPropertyValue("opacity")).toBe("0.75");
    expect(video.style.getPropertyPriority("opacity")).toBe("");
  });

  it("restores no inline opacity when the authored capture recorded none", () => {
    const video = makeDrawableVideo();
    video.setAttribute("data-hf-authored-opacity", "");
    video.style.opacity = "0";
    startRuntimeWithVideo(video);

    runtime?.destroy();
    runtime = null;

    expect(video.style.getPropertyValue("opacity")).toBe("");
  });

  it("re-syncs the graded canvas when the source's inline transform changes", async () => {
    const { video } = startRuntimeWithVideo();
    const drawsBefore = texImage2DCalls.length;

    // Simulate a studio drag draft: only the inline transform moves.
    video.style.transform = "translate(120px, 60px)";
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(texImage2DCalls.length).toBeGreaterThan(drawsBefore);
  });

  it("does not redraw-loop on its own hide writes (opacity/visibility only)", async () => {
    const { video } = startRuntimeWithVideo();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const drawsBefore = texImage2DCalls.length;

    // drawEntry's own source-hide writes touch opacity — geometry unchanged.
    video.style.opacity = "0.5";
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(texImage2DCalls.length).toBe(drawsBefore);
  });

  it("re-hides source media after timeline visibility sync", () => {
    const { video, canvas } = startRuntimeWithVideo();

    expect(canvas.id).toBe("__hf_color_grading_hero-video");
    expect(video.style.getPropertyValue("visibility")).toBe("");
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(true);
    expect(canvas?.style.visibility).toBe("visible");
    expect(canvas?.style.opacity).toBe("1");

    video.style.visibility = "visible";
    runtime.setSourceVisibility(video, true);
    runtime.redraw();

    expect(video.style.getPropertyValue("visibility")).toBe("visible");
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
    expect(canvas?.style.visibility).toBe("visible");

    video.style.visibility = "hidden";
    runtime.setSourceVisibility(video, false);
    runtime.redraw();

    expect(video.style.getPropertyValue("visibility")).toBe("hidden");
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
    expect(canvas?.style.visibility).toBe("hidden");
  });

  it("resolves grading values from the nearest sub-composition variable scope", () => {
    window.__hfVariables = {
      exposure: -0.25,
    };
    window.__hfVariablesByComp = {
      card__hf1: {
        exposure: 0.75,
      },
    };
    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "card__hf1");
    const video = makeDrawableVideo();
    video.id = "first-video";
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      JSON.stringify({ adjust: { exposure: "$exposure" } }),
    );
    host.appendChild(video);
    document.body.appendChild(host);

    runtime = createColorGradingRuntime();

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_exposure", 0.75);
  });

  it("falls back to top-level variables for root media color grading", () => {
    window.__hfVariables = {
      exposure: 0.35,
    };
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      JSON.stringify({ adjust: { exposure: "${exposure}" } }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_exposure", 0.35);
  });

  it("keeps the last shader frame visible while a video seek is waiting for a drawable frame", () => {
    const { video, canvas } = startRuntimeWithVideo();

    expect(canvas.style.display).toBe("block");

    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_METADATA,
      configurable: true,
    });

    runtime.redraw();

    expect(canvas.style.display).toBe("block");
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
  });

  it("keeps the canvas visible when producer render-frame injection hides the source video", () => {
    const video = makeDrawableVideo();
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_METADATA,
      configurable: true,
    });
    Object.defineProperty(video, "videoWidth", { value: 0, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 0, configurable: true });
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();
    const canvas = document.querySelector<HTMLCanvasElement>("[data-hf-color-grading-canvas]");
    if (!canvas) throw new Error("Expected color grading canvas");
    expect(canvas.style.display).toBe("none");

    const frame = document.createElement("img");
    frame.id = "__render_frame_hero-video__";
    frame.className = "__render_frame__";
    frame.style.visibility = "visible";
    frame.style.opacity = "0.75";
    Object.defineProperty(frame, "complete", { value: true, configurable: true });
    Object.defineProperty(frame, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(frame, "naturalHeight", { value: 360, configurable: true });
    video.parentNode?.insertBefore(frame, canvas);
    video.style.setProperty("visibility", "hidden", "important");

    runtime.redraw();

    expect(canvas.style.display).toBe("block");
    expect(canvas.style.visibility).toBe("visible");
    expect(canvas.style.opacity).toBe("0.75");
  });

  it("moves the canvas above producer render-frame images before capture", () => {
    const video = makeDrawableVideo();
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_METADATA,
      configurable: true,
    });
    Object.defineProperty(video, "videoWidth", { value: 0, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 0, configurable: true });
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();
    const canvas = document.querySelector<HTMLCanvasElement>("[data-hf-color-grading-canvas]");
    if (!canvas) throw new Error("Expected color grading canvas");

    const frame = document.createElement("img");
    frame.id = "__render_frame_hero-video__";
    frame.className = "__render_frame__";
    Object.defineProperty(frame, "complete", { value: true, configurable: true });
    Object.defineProperty(frame, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(frame, "naturalHeight", { value: 360, configurable: true });
    video.parentNode?.insertBefore(frame, canvas.nextSibling);

    expect(video.nextSibling).toBe(canvas);
    expect(canvas.nextSibling).toBe(frame);

    runtime.redraw();

    expect(video.nextSibling).toBe(frame);
    expect(frame.nextSibling).toBe(canvas);
  });

  it("updates before-after compare uniforms without changing the source grading", () => {
    const video = makeDrawableVideo();
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();
    const updated = runtime.setCompare("#hero-video", {
      enabled: true,
      position: 0.25,
      lineWidth: 4,
    });

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(updated).toBe(true);
    expect(lastUniform1f).toHaveBeenCalledWith("u_compareEnabled", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_comparePosition", 0.25);
    expect(lastUniform1f).toHaveBeenCalledWith("u_compareLineWidth", 4);
    expect(video.getAttribute(HF_COLOR_GRADING_ATTR)).toBe(
      serializeHfColorGrading({ adjust: { exposure: 0.5 } }),
    );
  });

  it("passes finishing detail uniforms into the shader", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        adjust: { vibrance: 0.35 },
        details: {
          vignette: 0.4,
          vignetteMidpoint: 0.35,
          vignetteRoundness: -0.25,
          vignetteFeather: 0.8,
          grain: 0.2,
          grainSize: 0.7,
          grainRoughness: 0.3,
        },
        effects: { blur: 0.3, pixelate: 0.1 },
      }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_vibrance", 0.35);
    expect(lastUniform1f).toHaveBeenCalledWith("u_vignette", 0.4);
    expect(lastUniform1f).toHaveBeenCalledWith("u_vignetteMidpoint", 0.35);
    expect(lastUniform1f).toHaveBeenCalledWith("u_vignetteRoundness", -0.25);
    expect(lastUniform1f).toHaveBeenCalledWith("u_vignetteFeather", 0.8);
    expect(lastUniform1f).toHaveBeenCalledWith("u_grain", 0.2);
    expect(lastUniform1f).toHaveBeenCalledWith("u_grainSize", 0.7);
    expect(lastUniform1f).toHaveBeenCalledWith("u_grainRoughness", 0.3);
    expect(lastUniform1f).toHaveBeenCalledWith("u_grainSeed", expect.any(Number));
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0.3);
    expect(lastUniform1f).toHaveBeenCalledWith("u_pixelate", 0.1);
  });

  it("uses the effected media sample as the graded shader input", () => {
    const video = makeDrawableVideo();
    video.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ effects: { blur: 0.25 } }));
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    const fragment = lastShaderSources.find((source) => source.includes("sampleMedia"));
    expect(fragment).toContain("vec4 originalSample = sampleSource(uv);");
    expect(fragment).toContain("vec4 sampleColor = sampleMedia(uv);");
    expect(fragment).toContain("uniform sampler2D u_blurSource;");
    expect(fragment).toContain("floor(clamp(uv, vec2(0.0), vec2(0.999999)) * cells)");
    expect(fragment).toContain("vec2 vignetteAspect");
    expect(fragment).toContain("float vibranceWeight");
    expect(fragment).toContain("float vignettePower");
    expect(fragment).toContain("float grainMask");
    expect(fragment).toContain("float grainPixelSize");
    expect(fragment).toContain("float blackPoint = clamp(u_blacks * 0.18");
    expect(fragment).toContain("float whitePoint = clamp(1.0 - u_whites * 0.18");
    expect(fragment).toContain("vec3 color = sampleColor.rgb * pow(2.0, u_exposure);");
    expect(fragment).not.toContain("sampleSoft");
    const blurFragment = lastShaderSources.find((source) =>
      source.includes("uniform vec2 u_direction;"),
    );
    expect(blurFragment).toContain("stepUv * 12.0");
    expect(blurFragment).toContain("color.rgb *= color.a;");
    expect(blurFragment).toContain("color.rgb /= color.a;");
  });

  it("renders blur passes at media resolution to avoid blocky high-strength blur", () => {
    const video = makeDrawableVideo();
    video.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ effects: { blur: 1 } }));
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(texImage2DCalls.some((args) => args[3] === 640 && args[4] === 360)).toBe(true);
    expect(
      lastUniform1f?.mock.calls.some(
        ([name, value]) => name === "u_radius" && typeof value === "number" && value > 30,
      ),
    ).toBe(true);
  });

  it("loads cube LUTs and enables LUT uniforms", async () => {
    const fetchMock = stubCubeLutFetch();
    const origin = window.location.origin;
    document.head.innerHTML = `<base href="${origin}/api/projects/demo/preview/">`;
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ lut: { src: "assets/luts/identity.cube", intensity: 0.4 } }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();
    await flushLutLoad();

    expect(fetchMock).toHaveBeenCalledWith(
      `${origin}/api/projects/demo/preview/assets/luts/identity.cube`,
      { credentials: "same-origin" },
    );
    if (!lastUniform1f || !lastUniform3f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_lutEnabled", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_lutSize", 2);
    expect(lastUniform1f).toHaveBeenCalledWith("u_lutIntensity", 0.4);
    expect(lastUniform3f).toHaveBeenCalledWith("u_lutDomainMin", 0, 0, 0);
    expect(lastUniform3f).toHaveBeenCalledWith("u_lutDomainMax", 1, 1, 1);
    expect(runtime.getStatus("#hero-video").message).toBe("Shader + LUT active");
  });

  it("bounds the runtime LUT cache", async () => {
    const fetchMock = stubCubeLutFetch();
    const origin = window.location.origin;
    document.head.innerHTML = `<base href="${origin}/api/projects/demo/preview/">`;
    const { video } = startRuntimeWithVideo();

    for (let index = 0; index < 17; index += 1) {
      runtime?.setGrading(`#${video.id}`, {
        lut: { src: `assets/luts/${index}.cube`, intensity: 1 },
      });
      await flushLutLoad();
    }
    runtime?.setGrading(`#${video.id}`, {
      lut: { src: "assets/luts/0.cube", intensity: 1 },
    });
    await flushLutLoad();

    const firstUrl = `${origin}/api/projects/demo/preview/assets/luts/0.cube`;
    expect(fetchMock.mock.calls.filter(([url]) => url === firstUrl)).toHaveLength(2);
  });

  it("reports unsupported LUT files in runtime status", async () => {
    stubCubeLutFetch(`
      LUT_1D_SIZE 2
      0 0 0
      1 1 1
    `);
    const origin = window.location.origin;
    document.head.innerHTML = `<base href="${origin}/api/projects/demo/preview/">`;
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ lut: { src: "assets/luts/oned.cube", intensity: 1 } }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();
    await flushLutLoad();

    expect(runtime.getStatus("#hero-video").message).toContain(
      "LUT error: 1D cube LUTs are not supported yet",
    );
  });

  it("reports media texture upload failures in runtime status", () => {
    getContextSpy.mockImplementation((type: string) =>
      type === "webgl" ? createMockWebGl({ failMediaUpload: true }) : null,
    );
    const video = makeDrawableVideo();
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(runtime.getStatus("#hero-video")).toEqual({
      state: "unavailable",
      message: "Media cannot be sampled by WebGL",
    });
  });

  it("falls back to the source media on WebGL context loss and redraws after restore", () => {
    const { video, canvas } = startRuntimeWithVideo();

    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);

    expect(lost.defaultPrevented).toBe(true);
    expect(canvas.style.display).toBe("none");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(false);
    expect(video.style.getPropertyValue("opacity")).toBe("");
    expect(runtime?.getStatus("#hero-video")).toEqual({
      state: "unavailable",
      message: "WebGL context lost",
    });

    canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(runtime?.getStatus("#hero-video").state).toBe("active");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(true);
    expect(video.style.getPropertyValue("opacity")).toBe("0");
  });
});

describe("installAuthoredOpacityCapture", () => {
  it("stamps graded elements at insertion and never overwrites the stamp", async () => {
    installAuthoredOpacityCapture();
    const el = document.createElement("img");
    el.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ adjust: { exposure: 0.5 } }));
    el.style.opacity = "0.98";
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.getAttribute("data-hf-authored-opacity")).toBe("0.98");

    // A re-insert after an animation engine mutated the element keeps the
    // original capture (has-attribute guard).
    el.style.opacity = "0";
    el.remove();
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.getAttribute("data-hf-authored-opacity")).toBe("0.98");
    el.remove();
  });

  it("stamps an empty value for graded elements without an authored inline opacity", async () => {
    installAuthoredOpacityCapture();
    const el = document.createElement("img");
    el.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ adjust: { exposure: 0.5 } }));
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.getAttribute("data-hf-authored-opacity")).toBe("");
    el.remove();
  });

  it("stamps an already-inserted element the moment it GAINS grading at runtime", async () => {
    installAuthoredOpacityCapture();
    const el = document.createElement("img");
    el.style.opacity = "0.9";
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.hasAttribute("data-hf-authored-opacity")).toBe(false);

    // Studio applies a preset to a previously ungraded element — no re-insert.
    el.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ adjust: { exposure: 0.5 } }));
    await Promise.resolve();
    expect(el.getAttribute("data-hf-authored-opacity")).toBe("0.9");

    // Later attribute rewrites (preset tweaks) never overwrite the stamp,
    // even if a transient is live by then.
    el.style.opacity = "0";
    el.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ adjust: { exposure: 0.9 } }));
    await Promise.resolve();
    expect(el.getAttribute("data-hf-authored-opacity")).toBe("0.9");
    el.remove();
  });
});
