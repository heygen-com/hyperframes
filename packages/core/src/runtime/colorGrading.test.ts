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
let loseContextCalls = 0;

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

function createMockWebGl(
  options: { failMediaUpload?: boolean; halfFloatSupported?: boolean } = {},
): WebGLRenderingContext {
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
    TEXTURE4: 0x84c4,
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
    getExtension: vi.fn((name: string) => {
      if (name === "WEBGL_lose_context") {
        return { loseContext: () => (loseContextCalls += 1) };
      }
      if (options.halfFloatSupported === false) return null;
      if (name === "OES_texture_half_float") return { HALF_FLOAT_OES: 0x8d61 };
      return name === "EXT_color_buffer_half_float" ? {} : null;
    }),
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

function makeDrawableImage(): HTMLImageElement {
  const image = document.createElement("img");
  image.id = "hero-image";
  image.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ effects: { blur: 0 } }));
  image.style.setProperty("--hf-color-grading-blur", "0");
  Object.defineProperty(image, "complete", { value: true, configurable: true });
  Object.defineProperty(image, "naturalWidth", { value: 640, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: 360, configurable: true });
  Object.defineProperty(image, "offsetWidth", { value: 640, configurable: true });
  Object.defineProperty(image, "offsetHeight", { value: 360, configurable: true });
  image.getBoundingClientRect = () =>
    ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360 }) as DOMRect;
  return image;
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
    loseContextCalls = 0;
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
    delete window.__player;
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

  it.each([
    { pixelRatio: 1, width: 640, height: 360 },
    { pixelRatio: 2, width: 1280, height: 720 },
  ])(
    "matches the WebGL drawing buffer to the displayed media at DPR $pixelRatio",
    ({ pixelRatio, width, height }) => {
      vi.stubGlobal("devicePixelRatio", pixelRatio);

      const { canvas } = startRuntimeWithVideo();

      expect(canvas.style.width).toBe("640px");
      expect(canvas.style.height).toBe("360px");
      expect(canvas.width).toBe(width);
      expect(canvas.height).toBe(height);
    },
  );

  it("uses the default non-preserved drawing buffer outside capture instrumentation", () => {
    startRuntimeWithVideo();

    expect(getContextSpy).toHaveBeenCalledWith("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
  });

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

  it("releases inactive attribute grading and recreates it when visible", () => {
    const { video, canvas } = startRuntimeWithVideo();

    expect(canvas.id).toBe("__hf_color_grading_hero-video");
    expect(video.style.getPropertyValue("visibility")).toBe("");
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(true);
    expect(canvas?.style.visibility).toBe("visible");
    expect(canvas?.style.opacity).toBe("1");

    video.style.visibility = "hidden";
    expect(runtime.setSourceVisibility(video, false)).toBe(true);

    expect(video.style.getPropertyValue("visibility")).toBe("hidden");
    expect(video.style.getPropertyValue("opacity")).toBe("");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(false);
    expect(canvas.isConnected).toBe(false);

    video.style.visibility = "visible";
    expect(runtime.setSourceVisibility(video, true)).toBe(true);

    const recreated = document.querySelector<HTMLCanvasElement>("[data-hf-color-grading-canvas]");
    expect(recreated).not.toBeNull();
    expect(recreated).toBe(canvas);
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
  });

  it("defers WebGL setup for hidden attributed media until it becomes visible", () => {
    const video = makeDrawableVideo();
    video.style.display = "none";
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(getContextSpy).not.toHaveBeenCalled();
    expect(document.querySelector("[data-hf-color-grading-canvas]")).toBeNull();
    expect(runtime.getStatus(video)).toEqual({
      state: "pending",
      message: "Waiting for visible media",
    });

    video.style.display = "block";
    expect(runtime.setSourceVisibility(video, true)).toBe(true);
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).not.toBeNull();
  });

  it("renders exact preset previews for ungraded media without replacing the source", async () => {
    const video = makeDrawableVideo();
    video.removeAttribute(HF_COLOR_GRADING_ATTR);
    document.body.appendChild(video);
    const toDataUrl = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,preview");
    runtime = createColorGradingRuntime();

    const batch = await runtime.renderPreviews(
      "#hero-video",
      [
        { id: "clean", grading: "clean-studio" },
        { id: "warm", grading: "warm-daylight" },
      ],
      { maxDimension: 160 },
    );

    expect(batch).toMatchObject({
      width: 160,
      height: 90,
      images: [
        { id: "clean", dataUrl: "data:image/png;base64,preview" },
        { id: "warm", dataUrl: "data:image/png;base64,preview" },
      ],
    });
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).toBeNull();
    expect(video.style.opacity).toBe("");

    await runtime.renderPreviews("#hero-video", [{ id: "mono", grading: "mono-clean" }]);
    expect(getContextSpy).toHaveBeenCalledTimes(1);

    const retinaBatch = await runtime.renderPreviews(
      "#hero-video",
      [{ id: "retina", grading: "neutral" }],
      { maxDimension: 400 },
    );
    expect(retinaBatch).toMatchObject({ width: 320, height: 180 });
    toDataUrl.mockRestore();
  });

  it("plays only a selected video for preview and restores its media state", () => {
    const video = makeDrawableVideo();
    let paused = true;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 3.25,
      writable: true,
    });
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    const play = vi.spyOn(video, "play").mockImplementation(() => {
      paused = false;
      return Promise.resolve();
    });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      paused = true;
    });
    video.loop = false;
    video.muted = false;
    document.body.appendChild(video);
    runtime = createColorGradingRuntime();

    const stop = runtime.startPreviewPlayback("#hero-video");

    expect(stop).not.toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    video.currentTime = 6;
    stop?.();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(3.25);
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(false);
  });

  it("does not start preview playback for an image", () => {
    const image = makeDrawableImage();
    document.body.appendChild(image);
    runtime = createColorGradingRuntime();

    expect(runtime.startPreviewPlayback("#hero-image")).toBeNull();
  });

  it("uses selected-video time for isolated animated preview frames", async () => {
    const video = makeDrawableVideo();
    Object.defineProperty(video, "currentTime", { configurable: true, value: 6.5 });
    document.body.appendChild(video);
    window.__player = { getTime: () => 1.25 };
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,preview",
    );
    runtime = createColorGradingRuntime();

    await runtime.renderPreviews("#hero-video", [{ id: "vhs", grading: { effects: { vhs: 1 } } }], {
      maxDimension: 160,
      useMediaTime: true,
    });

    expect(lastUniform1f?.mock.calls).toContainEqual(["u_effectTime", 6.5]);
  });

  it("uses the LUT cache and canonical multipass renderer in preview batches", async () => {
    const video = makeDrawableVideo();
    video.removeAttribute(HF_COLOR_GRADING_ATTR);
    document.body.appendChild(video);
    const fetchMock = stubCubeLutFetch();
    const toDataUrl = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,lut-preview");
    runtime = createColorGradingRuntime();

    const batch = await runtime.renderPreviews("#hero-video", [
      {
        id: "lut",
        grading: { preset: "warm-daylight", lut: { src: "/looks/test.cube", intensity: 0.6 } },
      },
      { id: "blur", grading: { effects: { blur: 0.5 } } },
      { id: "bloom", grading: { effects: { bloom: 0.5, bloomRadius: 8 } } },
      { id: "kuwahara", grading: { effects: { kuwahara: 1, kuwaharaRadius: 0.25 } } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(batch?.images).toEqual([
      { id: "lut", dataUrl: "data:image/png;base64,lut-preview" },
      { id: "blur", dataUrl: "data:image/png;base64,lut-preview" },
      { id: "bloom", dataUrl: "data:image/png;base64,lut-preview" },
      { id: "kuwahara", dataUrl: "data:image/png;base64,lut-preview" },
    ]);
    toDataUrl.mockRestore();
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

  it("samples seek-derived grading values from inline CSS properties on every redraw", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        adjust: { exposure: 0.5 },
        effects: {
          blur: 0.2,
          bloom: 0.2,
          kuwahara: 0.2,
          pixelate: 0.3,
          ascii: 0.4,
          dither: 0.5,
        },
        lut: { src: "assets/luts/test.cube", intensity: 0.4 },
      }),
    );
    video.style.setProperty("--hf-color-grading-intensity", "0.25");
    video.style.setProperty("--hf-color-grading-lut-intensity", "0.35");
    video.style.setProperty("--hf-color-grading-exposure", "-0.15");
    video.style.setProperty("--hf-color-grading-blur", "0.45");
    video.style.setProperty("--hf-color-grading-bloom", "0.45");
    video.style.setProperty("--hf-color-grading-kuwahara", "0.45");
    video.style.setProperty("--hf-color-grading-pixelate", "0.55");
    video.style.setProperty("--hf-color-grading-ascii", "0.65");
    video.style.setProperty("--hf-color-grading-dither", "0.75");
    stubCubeLutFetch();
    startRuntimeWithVideo(video);

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_intensity", 0.25);
    expect(lastUniform1f).toHaveBeenCalledWith("u_lutIntensity", 0.35);
    expect(lastUniform1f).toHaveBeenCalledWith("u_exposure", -0.15);
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0.45);
    expect(lastUniform1f).toHaveBeenCalledWith("u_bloom", 0.45);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwahara", 0.45);
    expect(lastUniform1f).toHaveBeenCalledWith("u_pixelate", 0.55);
    expect(lastUniform1f).toHaveBeenCalledWith("u_ascii", 0.65);
    expect(lastUniform1f).toHaveBeenCalledWith("u_dither", 0.75);

    video.style.setProperty("--hf-color-grading-intensity", "0.75");
    video.style.setProperty("--hf-color-grading-lut-intensity", "0.65");
    video.style.setProperty("--hf-color-grading-exposure", "0.15");
    video.style.setProperty("--hf-color-grading-blur", "0.15");
    video.style.setProperty("--hf-color-grading-bloom", "0.15");
    video.style.setProperty("--hf-color-grading-kuwahara", "0.15");
    video.style.setProperty("--hf-color-grading-pixelate", "0.05");
    video.style.setProperty("--hf-color-grading-ascii", "0.15");
    video.style.setProperty("--hf-color-grading-dither", "0.25");
    lastUniform1f.mockClear();
    runtime?.redraw();

    expect(lastUniform1f).toHaveBeenCalledWith("u_intensity", 0.75);
    expect(lastUniform1f).toHaveBeenCalledWith("u_lutIntensity", 0.65);
    expect(lastUniform1f).toHaveBeenCalledWith("u_exposure", 0.15);
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0.15);
    expect(lastUniform1f).toHaveBeenCalledWith("u_bloom", 0.15);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwahara", 0.15);
    expect(lastUniform1f).toHaveBeenCalledWith("u_pixelate", 0.05);
    expect(lastUniform1f).toHaveBeenCalledWith("u_ascii", 0.15);
    expect(lastUniform1f).toHaveBeenCalledWith("u_dither", 0.25);

    video.style.setProperty("--hf-color-grading-intensity", "invalid");
    video.style.setProperty("--hf-color-grading-lut-intensity", "2");
    video.style.setProperty("--hf-color-grading-exposure", "-3");
    video.style.setProperty("--hf-color-grading-blur", "-1");
    video.style.setProperty("--hf-color-grading-bloom", "invalid");
    video.style.setProperty("--hf-color-grading-kuwahara", "invalid");
    video.style.setProperty("--hf-color-grading-pixelate", "invalid");
    video.style.setProperty("--hf-color-grading-ascii", "-1");
    video.style.setProperty("--hf-color-grading-dither", "invalid");
    lastUniform1f.mockClear();
    runtime?.redraw();

    expect(lastUniform1f).toHaveBeenCalledWith("u_intensity", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_lutIntensity", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_exposure", -2);
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0);
    expect(lastUniform1f).toHaveBeenCalledWith("u_bloom", 0.2);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwahara", 0.2);
    expect(lastUniform1f).toHaveBeenCalledWith("u_pixelate", 0.3);
    expect(lastUniform1f).toHaveBeenCalledWith("u_ascii", 0);
    expect(lastUniform1f).toHaveBeenCalledWith("u_dither", 0.5);
  });

  it("initializes a zero-start grade when an animated property declares future state", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        intensity: 0,
        adjust: { exposure: 0.5 },
        effects: { kuwahara: 0 },
      }),
    );
    video.style.setProperty("--hf-color-grading-intensity", "0");
    video.style.setProperty("--hf-color-grading-kuwahara", "0");
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_intensity", 0);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwahara", 0);
    expect(texImage2DCalls.some((args) => args.includes(0x8d61))).toBe(true);

    video.style.setProperty("--hf-color-grading-intensity", "1");
    video.style.setProperty("--hf-color-grading-kuwahara", "1");
    lastUniform1f.mockClear();
    runtime.redraw();

    expect(lastUniform1f).toHaveBeenCalledWith("u_intensity", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwahara", 1);
  });

  it("redraws animated still images from the transport tick", () => {
    const image = makeDrawableImage();
    document.body.appendChild(image);
    runtime = createColorGradingRuntime();
    image.style.setProperty("--hf-color-grading-blur", "0.7");
    lastUniform1f?.mockClear();

    expect(runtime.redrawAnimated()).toBe(1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0.7);
  });

  it("redraws animated held video frames without duplicating active video draws", () => {
    const video = makeDrawableVideo();
    video.style.setProperty("--hf-color-grading-blur", "0.1");
    startRuntimeWithVideo(video);
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    Object.defineProperty(video, "ended", { value: false, configurable: true });

    expect(runtime?.redrawAnimated()).toBe(0);

    Object.defineProperty(video, "paused", { value: true, configurable: true });
    Object.defineProperty(video, "ended", { value: true, configurable: true });
    video.style.setProperty("--hf-color-grading-blur", "0.8");
    lastUniform1f?.mockClear();

    expect(runtime?.redrawAnimated()).toBe(1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0.8);
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

  it("allows a drawable producer render frame to initialize hidden source grading", () => {
    const video = makeDrawableVideo();
    video.style.display = "none";
    document.body.appendChild(video);

    const frame = document.createElement("img");
    frame.id = "__render_frame_hero-video__";
    frame.className = "__render_frame__";
    frame.style.visibility = "visible";
    Object.defineProperty(frame, "complete", { value: true, configurable: true });
    Object.defineProperty(frame, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(frame, "naturalHeight", { value: 360, configurable: true });
    video.after(frame);

    runtime = createColorGradingRuntime();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).not.toBeNull();
  });

  it("does not recreate an inactive clip from its hidden producer frame", () => {
    const { video, canvas } = startRuntimeWithVideo();
    const frame = document.createElement("img");
    frame.id = "__render_frame_hero-video__";
    frame.className = "__render_frame__";
    frame.style.visibility = "hidden";
    Object.defineProperty(frame, "complete", { value: true, configurable: true });
    Object.defineProperty(frame, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(frame, "naturalHeight", { value: 360, configurable: true });
    video.parentNode?.insertBefore(frame, canvas);

    video.style.visibility = "hidden";
    expect(runtime.setSourceVisibility(video, false)).toBe(true);
    runtime.refresh();
    expect(canvas.isConnected).toBe(false);
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(false);
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
    const details = {
      vignette: 0.4,
      vignetteMidpoint: 0.35,
      vignetteRoundness: -0.25,
      vignetteFeather: 0.8,
      grain: 0.2,
      grainSize: 0.7,
      grainRoughness: 0.3,
    };
    const effects = {
      blur: 0.3,
      pixelate: 0.1,
      chromaBleed: 0.25,
      tapeDamage: 0.35,
      tapeTracking: 0.45,
      tapeNoise: 0.55,
      tapeSpeed: 0.65,
      filmArtifacts: 0.45,
      halftone: 0.55,
      halftoneSize: 0.65,
      twoInkPrint: 0.75,
      twoInkPrintSize: 0.85,
      ascii: 0.6,
      asciiSize: 0.4,
      asciiInvert: 1,
      dither: 0.7,
      ditherSize: 0.3,
      asciiStyle: 4,
      asciiColor: 1,
      asciiRotation: 1,
      monoScreen: 0.2,
      monoScreenSize: 0.3,
      monoScreenAngle: 0.4,
      monoScreenSpread: 0.5,
      monoScreenShape: 3,
      monoScreenInvert: 1,
      scanlines: 0.25,
      scanlineCount: 0.35,
      scanlineSoftness: 0.45,
      chromaticAberration: 0.3,
      chromaticAngle: 0.4,
      crtCurvature: 0.2,
      digitalGlitch: 0.35,
      digitalGlitchColorSplit: 0.4,
      digitalGlitchLineTear: 0.45,
      digitalGlitchPixelate: 0.5,
      digitalGlitchBlockAmount: 0.55,
      digitalGlitchBlockDisplacement: 0.65,
      digitalGlitchBlockOpacity: 0.15,
      digitalGlitchSpeed: 0.75,
      engraving: 0.8,
      engravingSpacing: 0.41,
      engravingMinThickness: 0.2,
      engravingMaxThickness: 0.46,
      engravingAngle: 0.25,
      engravingContrast: 0.47,
      engravingSharpness: 0.59,
      engravingWave: 0.2,
      engravingWaveFrequency: 0.22,
      crosshatch: 0.85,
      crosshatchSpacing: 0.28,
      crosshatchThickness: 0.25,
      crosshatchAngle: 0.25,
      crosshatchContrast: 0.33,
      crosshatchEdges: 0.5,
      crosshatchLineWeight: 0.15,
      crosshatchWave: 0.33,
      crosshatchWaveFrequency: 0.22,
    };
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        adjust: { vibrance: 0.35 },
        details,
        effects,
        palette: ["#080717", "#3c185f", "#d9339f", "#ff6b66"],
      }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    for (const [key, value] of Object.entries({ vibrance: 0.35, ...details, ...effects })) {
      expect(lastUniform1f).toHaveBeenCalledWith(`u_${key}`, value);
    }
    expect(lastUniform1f).toHaveBeenCalledWith("u_grainSeed", expect.any(Number));
    expect(lastUniform1f).toHaveBeenCalledWith("u_paletteSize", 4);
    if (!lastUniform3f) throw new Error("Expected WebGL palette uniform calls");
    expect(lastUniform3f).toHaveBeenCalledWith("u_palette0", 8 / 255, 7 / 255, 23 / 255);
    expect(lastUniform3f).toHaveBeenCalledWith("u_palette3", 1, 107 / 255, 102 / 255);

    const fragment = lastShaderSources.find((source) => source.includes("sampleMedia"));
    expect(fragment).toContain("float centerLuma = lumaOf(base.rgb);");
    expect(fragment).toContain("vec3(centerLuma) + blurredChroma");
    expect(fragment).toContain("float headSwitch");
    expect(fragment).toContain("float tapeTrackingBand");
    expect(fragment).toContain("float tapeTime = u_effectTime");
    expect(fragment).toContain("float tapeFrame = floor(tapeTime * 60.0);");
    expect(fragment).not.toContain(
      "tapeTrackingBand(float y, float center, float width, float phase)",
    );
    expect(fragment).toContain("float lineJitter = (digitalHash");
    expect(fragment).toContain("float dustMask");
    expect(fragment).toContain("float screenDot");
    expect(fragment).toContain("vec3 applyHalftone");
    expect(fragment).toContain("vec3 applyTwoInkPrint");
    expect(fragment).toContain("float standardAsciiSample");
    expect(fragment).toContain("float bayer4");
    expect(fragment).toContain("vec3 applyAscii");
    expect(fragment).toContain("vec3 applyDither");
    expect(fragment).toContain("vec3 applyMonoScreen");
    expect(fragment).toContain("vec2 applyCrtWarp");
    expect(fragment).toContain("vec4 sampleChromaticMedia");
    expect(fragment).toContain("vec3 applyScanlines");
    expect(fragment).toContain("vec3 applyDigitalGlitch");
    expect(fragment).toContain("vec3 applyEngraving");
    expect(fragment).toContain("vec3 applyCrosshatch");
    expect(fragment).toContain("float crosshatchEdge");
    expect(fragment).toContain("vec3 applyCrosshatch(vec2 uv");
    expect(fragment).toContain("crosshatchEdge(uv)");
    expect(fragment).not.toContain("crosshatchEdge(v_uv)");
    expect(fragment).toContain("vec2 texel = 1.0 / max(u_resolution * u_uvScale, vec2(1.0));");
    expect(fragment).toContain("float baseAngle = -clamp(u_crosshatchAngle, 0.0, 1.0) * PI;");
    expect(fragment).toContain("float variation = mix(1.0, 0.5 + digitalHash");
    expect(fragment).toContain("baseAngle + PI * 0.5");
    expect(fragment).toContain("baseAngle + PI * 0.25");
    expect(fragment).toContain("baseAngle - PI * 0.25");
    expect(fragment).toContain("asciiStyleSample(floor(u_asciiStyle + 0.5)");
    expect(fragment).toContain("float cellHeight = mix(4.0, 80.0");
    expect(fragment).toContain("vec2 asciiEdgeDirection");
    expect(fragment).toContain("vec3 background = paletteColor(0.0);");
    expect(fragment).not.toContain("grainHash(cell + vec2(17.0, 43.0))");
    expect(fragment).toContain("sampleColor = sampleChromaticMedia(uv, sampleColor);");
    expect(fragment).toContain("sampleColor.rgb = applyDigitalGlitch(uv, sampleColor.rgb);");
    expect(fragment).toContain("vec3 sampleDigitalSplit");
    expect(fragment).toContain("float digitalHash(vec2 p)");
    expect(fragment).toContain("float direction = digitalHash");
    expect(fragment).toContain("float randomA = digitalHash");
    expect(fragment).toContain("float colorSplit = clamp(u_digitalGlitchColorSplit");
    expect(fragment).toContain("float pixelate = clamp(u_digitalGlitchPixelate");
    expect(fragment).toContain("blockDisplacement > 0.0 && blockOpacity > 0.0");
    expect(fragment).toContain("displaced = mix(uv, displaced, blockOpacity);");
    expect(fragment).not.toContain("vec3 electronicBlock");
    expect(fragment).toContain("color = applyMonoScreen");
    expect(fragment).toContain("color = applyEngraving");
    expect(fragment).toContain("color = applyCrosshatch");
    expect(fragment).toContain("color = applyScanlines");
    expect(fragment).toContain("float curvature = clamp(u_crtCurvature, 0.0, 1.0) * 0.5;");
    expect(fragment).toContain("float dist = dot(centered, centered);");
    expect(fragment).toContain("centered *= 1.0 + curvature * dist;");
    expect(fragment).toContain("float wave = 0.5 + 0.5 * sin(v_uv.y * count * PI);");
    expect(fragment).toContain("float line = mix(1.0 - wave, pow(1.0 - wave, 2.2), softness);");
    expect(fragment).not.toContain("float hardLine = step(0.78, wave);");
    expect(fragment.indexOf("float vignettePower")).toBeGreaterThan(
      fragment.indexOf("color = applyScanlines"),
    );
    expect(fragment).toContain("amount * 0.02");
    expect(fragment).not.toContain("mix(center.rgb, split, amount)");
  });

  it("renders Kuwahara through bounded moment passes before the main shader", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        effects: {
          kuwahara: 0.8,
          kuwaharaRadius: 0.25,
          kuwaharaSharpness: 0.4,
          kuwaharaSaturation: 0.6,
        },
      }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwahara", 0.8);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwaharaRadius", 0.25);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwaharaSharpness", 0.4);
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwaharaSaturation", 0.6);
    expect(lastShaderSources.some((source) => source.includes("u_kuwaharaMoments"))).toBe(true);
    expect(
      lastShaderSources.some((source) => source.includes("meanSquare - dot(mean, mean)")),
    ).toBe(true);
    expect(texImage2DCalls.some((args) => args.includes(0x8d61))).toBe(true);
  });

  it("falls back to the untreated shader output when half-float targets are unavailable", () => {
    getContextSpy.mockImplementation((type: string) =>
      type === "webgl" ? createMockWebGl({ halfFloatSupported: false }) : null,
    );
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ effects: { kuwahara: 1 } }),
    );
    const { canvas } = startRuntimeWithVideo(video);

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_kuwaharaReady", 0);
    expect(canvas.style.display).toBe("block");
    expect(runtime?.getStatus(video)).toEqual({
      state: "unavailable",
      message: "Kuwahara requires half-float framebuffer support",
    });
    expect(texImage2DCalls.some((args) => args.includes(0x8d61))).toBe(false);
  });

  it("releases lazy Kuwahara GPU resources when attributed media becomes inactive", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ effects: { kuwahara: 1 } }),
    );
    startRuntimeWithVideo(video);
    const gl = getContextSpy.mock.results[0]?.value as WebGLRenderingContext;

    expect(runtime?.setSourceVisibility(video, false)).toBe(true);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(loseContextCalls).toBe(0);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).toBeNull();
  });

  it("releases pooled WebGL contexts when the runtime is destroyed", () => {
    const { video } = startRuntimeWithVideo();

    expect(runtime?.setSourceVisibility(video, false)).toBe(true);
    expect(loseContextCalls).toBe(0);

    runtime?.destroy();
    runtime = null;
    expect(loseContextCalls).toBe(1);
  });

  it("drives temporal shader effects from canonical composition time", () => {
    let playerTime = 2.25;
    Object.defineProperty(window, "__player", {
      value: { getTime: () => playerTime },
      configurable: true,
    });
    const video = makeDrawableVideo();
    Object.defineProperty(video, "currentTime", { value: 19.5, configurable: true });
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ effects: { digitalGlitch: 1 } }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_effectTime", 2.25);
    const firstGrainSeed = lastUniform1f.mock.calls.findLast(
      ([uniform]) => uniform === "u_grainSeed",
    )?.[1] as number | undefined;
    playerTime = 2.5;
    runtime.redraw();
    const secondGrainSeed = lastUniform1f.mock.calls.findLast(
      ([uniform]) => uniform === "u_grainSeed",
    )?.[1] as number | undefined;
    expect(firstGrainSeed).toBeTypeOf("number");
    expect(secondGrainSeed).toBe((firstGrainSeed ?? 0) + 15);
    const fragment = lastShaderSources.find((source) => source.includes("sampleMedia"));
    expect(fragment).toContain("float time = u_effectTime * speed;");
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
    expect(fragment).toContain("vec3 applyPrimaryGrade(vec3 color)");
    expect(fragment).toContain(
      "vec3 color = mix(sampleColor.rgb, applyPrimaryGrade(sampleColor.rgb), u_intensity);",
    );
    expect(fragment).not.toContain("mix(original, color, u_intensity)");
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

  it("renders article bloom with thresholded half-resolution Gaussian passes", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ effects: { bloom: 0.5, bloomRadius: 8 } }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(lastUniform1f).toHaveBeenCalledWith("u_bloom", 0.5);
    expect(lastUniform1f).toHaveBeenCalledWith("u_bloomReady", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_radius", 4);
    expect(texImage2DCalls.some((args) => args[3] === 320 && args[4] === 180)).toBe(true);
    const bloomFragment = lastShaderSources.find((source) => source.includes("u_bloomPass"));
    expect(bloomFragment).toContain("vec3(0.299, 0.587, 0.114)");
    expect(bloomFragment).toContain("0.227027");
    expect(bloomFragment).toContain("0.1945946");
    expect(bloomFragment).toContain("0.016216");
  });

  it("releases the lazy bloom output used only when blur and bloom coexist", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        effects: { blur: 0.4, bloom: 0.5, bloomRadius: 8 },
      }),
    );
    startRuntimeWithVideo(video);
    const gl = getContextSpy.mock.results[0]?.value as WebGLRenderingContext;

    expect(texImage2DCalls.some((args) => args[3] === 640 && args[4] === 360)).toBe(true);
    expect(texImage2DCalls.some((args) => args[3] === 320 && args[4] === 180)).toBe(true);

    expect(runtime?.setSourceVisibility(video, false)).toBe(true);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
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

  it("waits for active LUTs before deterministic capture", async () => {
    let releaseFetch: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<{ ok: boolean; status: number; text: () => Promise<string> }>((resolve) => {
            releaseFetch = () =>
              resolve({ ok: true, status: 200, text: () => Promise.resolve(IDENTITY_2) });
          }),
      ),
    );
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ lut: { src: "assets/luts/identity.cube", intensity: 1 } }),
    );
    document.body.appendChild(video);
    runtime = createColorGradingRuntime();

    expect(runtime.getStatus(video)).toEqual({ state: "pending", message: "Loading LUT" });
    const ready = runtime.waitForActiveLuts();
    let settled = false;
    void ready.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseFetch?.();
    expect(await ready).toBe(1);
    expect(runtime.getStatus(video).message).toBe("Shader + LUT active");
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

  it("stamps ungraded media before a live Studio grade can hide it", async () => {
    installAuthoredOpacityCapture();
    const el = document.createElement("img");
    el.style.opacity = "0.9";
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.getAttribute("data-hf-authored-opacity")).toBe("0.9");

    // The live runtime hides the source before Studio persists the attribute.
    el.style.setProperty("opacity", "0", "important");
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
