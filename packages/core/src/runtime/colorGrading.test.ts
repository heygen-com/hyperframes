// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import {
  HF_COLOR_GRADING_ATTR,
  HF_COLOR_GRADING_EFFECT_KEYS,
  serializeHfColorGrading,
} from "../colorGrading";
import { HF_COLOR_GROUP_ATTR, HF_COLOR_GROUP_TAG } from "../colorGroups";
import {
  calculateObjectFitUv,
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
  options: {
    failMediaUpload?: boolean;
    halfFloatSupported?: boolean;
    drawingBuffer?: { width: number; height: number };
  } = {},
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
    TEXTURE5: 0x84c5,
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
    get drawingBufferWidth() {
      return options.drawingBuffer?.width;
    },
    get drawingBufferHeight() {
      return options.drawingBuffer?.height;
    },
  } as unknown as WebGLRenderingContext;
}

// Each clip shows its pixels on a 2D canvas, copied from the one shared WebGL canvas.
function mock2d(): CanvasRenderingContext2D {
  return { clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
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

  const webglContexts = () => getContextSpy.mock.calls.filter(([type]) => type === "webgl").length;

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
        type === "webgl" ? createMockWebGl() : type === "2d" ? mock2d() : null,
      ) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    runtime?.destroy();
    runtime = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("draws a bordered source's grading canvas without a border over its whole box", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const video = makeDrawableVideo();
    video.style.border = "16px solid rgb(255, 0, 0)";

    const { canvas } = startRuntimeWithVideo(video);

    expect(canvas.style.borderStyle).toBe("none");
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
  });

  it("says an element is graded only while it draws through a grading canvas", () => {
    const { video } = startRuntimeWithVideo();
    const plain = document.createElement("video");
    document.body.appendChild(plain);
    expect(runtime!.isGraded(video)).toBe(true);
    expect(runtime!.isGraded(plain)).toBe(false);
    video.removeAttribute(HF_COLOR_GRADING_ATTR);
    runtime!.refresh();
    expect(runtime!.isGraded(video)).toBe(false);
  });

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
    expect(webglContexts()).toBe(1);
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
  });

  it("draws every graded clip through one WebGL context, however often a seek run shows and hides them", () => {
    const clips = Array.from({ length: 6 }, (_, i) => {
      const video = makeDrawableVideo();
      video.id = `clip-${i}`;
      video.style.display = "none";
      document.body.appendChild(video);
      return video;
    });
    runtime = createColorGradingRuntime();

    // Each seek shows two neighbouring clips and hides the rest, as scenes come and go.
    for (const at of [0, 2, 4, 1, 3, 5, 0, 4]) {
      clips.forEach((video, i) => {
        const shown = i === at || i === (at + 1) % clips.length;
        video.style.display = shown ? "block" : "none";
        runtime?.setSourceVisibility(video, shown);
      });
    }

    expect(webglContexts()).toBe(1);
    const shared = getContextSpy.mock.instances[0];
    const copies = getContextSpy.mock.results
      .filter((_, i) => getContextSpy.mock.calls[i]?.[0] === "2d")
      .flatMap(
        ({ value }) => (value as { drawImage: ReturnType<typeof vi.fn> }).drawImage.mock.calls,
      );
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every(([source]) => source === shared)).toBe(true);
  });

  it("defers WebGL setup for hidden attributed media until it becomes visible", () => {
    const video = makeDrawableVideo();
    video.style.display = "none";
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(webglContexts()).toBe(0);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).toBeNull();
    expect(runtime.getStatus(video)).toEqual({
      state: "pending",
      message: "Waiting for visible media",
    });

    video.style.display = "block";
    expect(runtime.setSourceVisibility(video, true)).toBe(true);
    expect(webglContexts()).toBe(1);
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
    expect(webglContexts()).toBe(1);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).toBeNull();
    expect(video.style.opacity).toBe("");

    await runtime.renderPreviews("#hero-video", [{ id: "mono", grading: "mono-clean" }]);
    expect(webglContexts()).toBe(1);

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
    expect(video.currentTime).toBe(mediaElementTime(3.25));
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

  it("serializes preview batches while a LUT is loading", async () => {
    const video = makeDrawableVideo();
    video.removeAttribute(HF_COLOR_GRADING_ATTR);
    document.body.appendChild(video);
    let resolveText: ((value: string) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            new Promise<string>((resolve) => {
              resolveText = resolve;
            }),
        }),
      ),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,preview",
    );
    runtime = createColorGradingRuntime();

    const first = runtime.renderPreviews(
      "#hero-video",
      [{ id: "lut", grading: { lut: { src: "/looks/queued.cube" } } }],
      { maxDimension: 160 },
    );
    await Promise.resolve();
    await Promise.resolve();
    const second = runtime.renderPreviews("#hero-video", [{ id: "plain", grading: "neutral" }], {
      maxDimension: 320,
    });
    await Promise.resolve();

    expect(texImage2DCalls.filter((args) => args.length === 6)).toHaveLength(1);
    resolveText?.(IDENTITY_2);
    await expect(first).resolves.toMatchObject({ width: 160, height: 90 });
    await expect(second).resolves.toMatchObject({ width: 320, height: 180 });
    expect(texImage2DCalls.filter((args) => args.length === 6)).toHaveLength(2);
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

  it("reads a grading property set in a stylesheet, not only inline", () => {
    const style = document.createElement("style");
    style.textContent = "#plate { --hf-color-grading-blur: 0.6; }";
    document.head.appendChild(style);
    const video = makeDrawableVideo();
    video.id = "plate";
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ adjust: { saturation: -0.5 } }),
    );
    stubCubeLutFetch();
    startRuntimeWithVideo(video);

    if (!lastUniform1f) throw new Error("Expected WebGL uniform calls");
    expect(lastUniform1f).toHaveBeenCalledWith("u_blur", 0.6);
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

    expect(webglContexts()).toBe(1);
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

  describe("a picture served by URL", () => {
    const uploads = () => texImage2DCalls.map((call) => call[5]);

    /** The graded picture, and the pictures the runtime creates afterwards, still loading. */
    function servedPicture(): { image: HTMLImageElement; created: HTMLImageElement[] } {
      const image = makeDrawableImage();
      Object.defineProperty(image, "currentSrc", { value: "http://127.0.0.1/p/cutout.png" });
      document.body.appendChild(image);
      const created: HTMLImageElement[] = [];
      const createElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation(
        (tag: string, options?: ElementCreationOptions) => {
          const element = createElement(tag, options);
          if (element instanceof HTMLImageElement) {
            Object.defineProperty(element, "complete", { value: false, configurable: true });
            created.push(element);
          }
          return element;
        },
      );
      return { image, created };
    }

    function settle(copy: HTMLImageElement | undefined, naturalWidth: number): void {
      if (!copy) throw new Error("Expected a CORS copy of the picture");
      Object.defineProperty(copy, "complete", { value: true });
      Object.defineProperty(copy, "naturalWidth", { value: naturalWidth });
      copy.dispatchEvent(new Event(naturalWidth > 0 ? "load" : "error"));
    }

    it("grades the picture itself in a document with an origin", () => {
      const { image, created } = servedPicture();
      runtime = createColorGradingRuntime();

      expect(created).toEqual([]);
      expect(uploads().at(-1)).toBe(image);
    });

    it("grades a CORS copy in an opaque document, whose own no-cors load WebGL can't read", () => {
      vi.stubGlobal("origin", "null");
      const { image, created } = servedPicture();
      runtime = createColorGradingRuntime();

      const [copy] = created;
      expect([copy?.src, copy?.crossOrigin]).toEqual([
        "http://127.0.0.1/p/cutout.png",
        "anonymous",
      ]);
      expect(uploads()).not.toContain(image);
      for (let tick = 0; tick < 5; tick += 1) runtime.redrawAnimated();
      settle(copy, 640);
      expect(uploads().filter((upload) => upload === copy)).toHaveLength(1);
      expect(uploads()).not.toContain(image);
    });

    it("redraws a grading started while another's copy was loading", () => {
      vi.stubGlobal("origin", "null");
      const { created } = servedPicture();
      createColorGradingRuntime().destroy();
      runtime = createColorGradingRuntime();

      expect(created).toHaveLength(1);
      settle(created[0], 640);
      expect(uploads().at(-1)).toBe(created[0]);
    });

    it("grades the picture itself when an opaque document's CORS copy is refused, as before", () => {
      vi.stubGlobal("origin", "null");
      const { image, created } = servedPicture();
      runtime = createColorGradingRuntime();

      settle(created[0], 0);
      expect(uploads().at(-1)).toBe(image);
    });
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

  describe("a graded canvas", () => {
    function makeGradedCanvas(width: number, height: number): HTMLCanvasElement {
      const canvas = document.createElement("canvas");
      canvas.id = "drawn";
      canvas.width = width;
      canvas.height = height;
      canvas.setAttribute(
        HF_COLOR_GRADING_ATTR,
        serializeHfColorGrading({ adjust: { exposure: 0.5 } }),
      );
      Object.defineProperty(canvas, "offsetWidth", { value: 640, configurable: true });
      Object.defineProperty(canvas, "offsetHeight", { value: 360, configurable: true });
      canvas.getBoundingClientRect = () =>
        ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360 }) as DOMRect;
      document.body.appendChild(canvas);
      return canvas;
    }
    const canvasUploads = (canvas: HTMLCanvasElement) =>
      texImage2DCalls.filter((args) => args.length === 6 && args[5] === canvas).length;

    it("grades its pixels and re-uploads them on every transport tick and seek", () => {
      const canvas = makeGradedCanvas(320, 180);
      runtime = createColorGradingRuntime();

      expect(runtime.isGraded(canvas)).toBe(true);
      expect(runtime.getStatus("drawn")).toMatchObject({ state: "active" });
      expect(canvas.style.getPropertyValue("opacity")).toBe("0");
      expect(canvasUploads(canvas)).toBe(1);

      expect(runtime.redrawAnimated()).toBe(1);
      expect(runtime.redraw()).toBe(1);
      expect(canvasUploads(canvas)).toBe(3);
    });

    it("waits for a drawing buffer, whatever its CSS box", () => {
      const canvas = makeGradedCanvas(0, 0);
      runtime = createColorGradingRuntime();

      expect(runtime.getStatus("drawn")).toMatchObject({ state: "pending" });
      expect(canvasUploads(canvas)).toBe(0);

      canvas.width = 320;
      canvas.height = 180;
      expect(runtime.redraw()).toBe(1);
      expect(canvasUploads(canvas)).toBe(1);
    });
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

  it("caps a clip shown far larger than the screen to what a GPU can draw, keeping its shape", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const video = makeDrawableVideo();
    Object.defineProperty(video, "offsetWidth", { value: 6582, configurable: true });
    Object.defineProperty(video, "offsetHeight", { value: 11520, configurable: true });

    const { canvas } = startRuntimeWithVideo(video);

    expect(canvas.width * canvas.height).toBeLessThanOrEqual(1 << 24);
    expect(canvas.width / canvas.height).toBeCloseTo(6582 / 11520, 2);
  });

  it("leaves the source showing when the drawing buffer cannot hold the canvas", () => {
    getContextSpy.mockImplementation((type: string) =>
      type === "webgl"
        ? createMockWebGl({ drawingBuffer: { width: 100, height: 100 } })
        : type === "2d"
          ? mock2d()
          : null,
    );

    const { video } = startRuntimeWithVideo();

    expect(video.style.getPropertyValue("opacity")).not.toBe("0");
  });

  it("gives a drawn clip back to its source when a later draw outgrows the drawing buffer", () => {
    const drawingBuffer = { width: 4096, height: 4096 };
    getContextSpy.mockImplementation((type: string) =>
      type === "webgl" ? createMockWebGl({ drawingBuffer }) : type === "2d" ? mock2d() : null,
    );
    const { video, canvas } = startRuntimeWithVideo();
    expect(video.style.getPropertyValue("opacity")).toBe("0");

    drawingBuffer.width = 100;
    drawingBuffer.height = 100;
    Object.defineProperty(video, "offsetWidth", { value: 3000, configurable: true });
    video.dispatchEvent(new Event("seeked"));

    expect(video.style.getPropertyValue("opacity")).not.toBe("0");
    expect(canvas.style.display).toBe("none");
  });

  it("draws a paused video again once its frame is presented, after the first draw sampled nothing", () => {
    const presented: Array<() => void> = [];
    const video = makeDrawableVideo();
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: (callback: () => void) => presented.push(callback),
      configurable: true,
    });

    startRuntimeWithVideo(video);
    const drawsBefore = texImage2DCalls.length;
    presented.shift()?.();

    expect(texImage2DCalls.length).toBeGreaterThan(drawsBefore);
    expect(presented).toHaveLength(0);
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

  it("drops the injected render frame's border while grading draws over it", () => {
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
    frame.style.border = "16px solid rgb(255, 0, 0)";
    Object.defineProperty(frame, "complete", { value: true, configurable: true });
    Object.defineProperty(frame, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(frame, "naturalHeight", { value: 360, configurable: true });
    video.parentNode?.insertBefore(frame, canvas);
    video.style.setProperty("visibility", "hidden", "important");

    runtime.redraw();

    expect(canvas.style.display).toBe("block");
    expect(frame.style.borderStyle).toBe("none");

    video.style.border = "16px dashed rgb(255, 0, 0)";
    video.removeAttribute(HF_COLOR_GRADING_ATTR);
    runtime.refresh();
    expect(frame.style.borderStyle).toBe("dashed");
  });

  it("keeps a staged scene copy's canvas on its own render frame (#3994)", async () => {
    // Page-side shader transitions clone the scene, ids included, into a staging
    // layer. When both videos paired with the live frame, their canvases traded
    // places after it on every mutation and the render stalled.
    function makeRenderFrame(): HTMLImageElement {
      const frame = document.createElement("img");
      frame.id = "__render_frame_hero-video__";
      frame.className = "__render_frame__";
      Object.defineProperty(frame, "complete", { value: true, configurable: true });
      Object.defineProperty(frame, "naturalWidth", { value: 640, configurable: true });
      Object.defineProperty(frame, "naturalHeight", { value: 360, configurable: true });
      return frame;
    }
    const live = document.createElement("div");
    live.append(makeDrawableVideo(), makeRenderFrame());
    document.body.appendChild(live);
    runtime = createColorGradingRuntime();

    let canvasMoves = 0;
    const insertBefore = Node.prototype.insertBefore;
    const spy = vi.spyOn(Node.prototype, "insertBefore").mockImplementation(function <
      T extends Node,
    >(this: Node, node: T, child: Node | null): T {
      // Stop moving canvases after a bound, so the loop cannot hang the test.
      if (node instanceof HTMLCanvasElement && ++canvasMoves > 100) return node;
      return insertBefore.call(this, node, child) as T;
    });
    const staged = document.createElement("div");
    staged.append(makeDrawableVideo(), makeRenderFrame());
    document.body.appendChild(staged);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => window.setTimeout(resolve, 0));
    runtime.redraw();
    spy.mockRestore();

    expect(canvasMoves).toBeLessThan(10);
    for (const scene of [live, staged]) {
      const frame = scene.querySelector("img.__render_frame__");
      expect(frame?.nextElementSibling?.hasAttribute("data-hf-color-grading-canvas")).toBe(true);
    }
  });

  it("hides the canvas when an ancestor clip goes out of its visibility window", () => {
    // A graded <img> inside a timed sub-composition carries no data-start of its
    // own, so nothing tells grading the clip left the screen — the canvas has to
    // notice from the source's inherited visibility. Before the fix, grading's own
    // opacity hide short-circuited that read and the canvas kept an explicit
    // `visibility: visible`, painting the treated plate over the active scene.
    const scene = document.createElement("div");
    const image = makeDrawableImage();
    scene.appendChild(image);
    document.body.appendChild(scene);

    runtime = createColorGradingRuntime();
    const canvas = document.querySelector<HTMLCanvasElement>("[data-hf-color-grading-canvas]");
    if (!canvas) throw new Error("Expected color grading canvas");
    expect(canvas.style.visibility).toBe("visible");

    scene.style.visibility = "hidden";
    runtime.redraw();

    expect(canvas.style.visibility).toBe("hidden");

    scene.style.visibility = "visible";
    runtime.redraw();

    expect(canvas.style.visibility).toBe("visible");
    // Grading still owns the source's opacity hide, so the canvas keeps full opacity.
    expect(canvas.style.opacity).toBe("1");
  });

  it.each([
    ["a seek", "redraw"],
    ["a playback tick", "redrawAnimated"],
  ] as const)("grades an image whose ancestor starts hidden once %s shows it", (_, pass) => {
    // A layer a timeline reveals, or a sub-composition host that starts later.
    const scene = document.createElement("div");
    scene.style.visibility = "hidden";
    const image = makeDrawableImage();
    scene.appendChild(image);
    document.body.appendChild(scene);
    runtime = createColorGradingRuntime();

    runtime[pass]();
    expect(runtime.isGraded(image)).toBe(false);
    expect(webglContexts()).toBe(0);

    scene.style.visibility = "visible";
    runtime[pass]();

    expect(runtime.isGraded(image)).toBe(true);
    expect(image.nextElementSibling?.hasAttribute("data-hf-color-grading-canvas")).toBe(true);
    expect(image.style.getPropertyValue("opacity")).toBe("0");
  });

  it.each([
    ["shown", "visible"],
    ["still hidden", "hidden"],
  ])("keeps a live grade switched off while %s, though its saved attribute grades", (_, start) => {
    const scene = document.createElement("div");
    scene.style.visibility = start;
    const image = makeDrawableImage();
    image.style.removeProperty("--hf-color-grading-blur");
    image.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ adjust: { exposure: 0.5 } }),
    );
    scene.appendChild(image);
    document.body.appendChild(scene);
    runtime = createColorGradingRuntime();

    runtime.setGrading(image, {});
    scene.style.visibility = "visible";
    runtime.redraw();
    runtime.redrawAnimated();

    expect(runtime.isGraded(image)).toBe(false);
  });

  it("updates canvas opacity through grading's own hide when CSS animation progresses (#3329)", () => {
    const video = makeDrawableVideo();
    // Simulate a CSS entrance animation: the authored opacity is empty (no
    // inline opacity), but at parse time the element has opacity 0 from the
    // animation's initial keyframe.
    video.setAttribute("data-hf-authored-opacity", "");
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();
    const canvas = document.querySelector<HTMLCanvasElement>("[data-hf-color-grading-canvas]");
    if (!canvas) throw new Error("Expected color grading canvas");

    // Source is hidden by color grading.
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");

    // The canvas opacity should NOT be frozen at "0" — after the hide is
    // temporarily lifted, jsdom's getComputedStyle returns "" (no inline
    // opacity set), which the code normalizes to "1".
    expect(canvas.style.opacity).toBe("1");

    // Simulate the CSS animation progressing by re-reading after a redraw.
    runtime.redraw();
    expect(canvas.style.opacity).toBe("1");

    // Source remains hidden throughout.
    expect(video.style.getPropertyValue("opacity")).toBe("0");
    expect(video.style.getPropertyPriority("opacity")).toBe("important");
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

    expect(webglContexts()).toBe(1);
    expect(document.querySelector("[data-hf-color-grading-canvas]")).not.toBeNull();
  });

  it("grades a clip's first producer frame when the DOM observer runs before it decodes", () => {
    const video = makeDrawableVideo();
    video.style.visibility = "hidden";
    document.body.appendChild(video);
    runtime = createColorGradingRuntime();

    let decoded = false;
    const frame = document.createElement("img");
    frame.id = "__render_frame_hero-video__";
    frame.className = "__render_frame__";
    frame.style.visibility = "visible";
    Object.defineProperty(frame, "complete", { get: () => decoded, configurable: true });
    Object.defineProperty(frame, "naturalWidth", { get: () => (decoded ? 640 : 0) });
    Object.defineProperty(frame, "naturalHeight", { get: () => (decoded ? 360 : 0) });
    video.after(frame);
    runtime.refresh();
    decoded = true;

    expect(runtime.redraw()).toBe(1);
    expect(texImage2DCalls.at(-1)).toContain(frame);
    expect(frame.nextSibling).toBe(document.querySelector("[data-hf-color-grading-canvas]"));
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
    expect(webglContexts()).toBe(1);
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
      type === "webgl"
        ? createMockWebGl({ halfFloatSupported: false })
        : type === "2d"
          ? mock2d()
          : null,
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

  function mainFragmentSources(): string[] {
    return lastShaderSources.filter((source) =>
      source.includes("vec4 sampleColor = sampleMedia(uv);"),
    );
  }

  function stageNames(source: string, directive: "define" | "ifdef"): string[] {
    const pattern = new RegExp(`^#${directive} (HF_STAGE_\\w+)$`, "gm");
    return [...new Set([...source.matchAll(pattern)].map((match) => match[1] ?? ""))].sort();
  }

  it("compiles an adjust-only grade with every optional shader stage left out", () => {
    startRuntimeWithVideo();

    const fragments = mainFragmentSources();
    expect(fragments).not.toHaveLength(0);
    for (const fragment of fragments) expect(stageNames(fragment, "define")).toEqual([]);
    expect(stageNames(fragments[0] ?? "", "ifdef")).toContain("HF_STAGE_ASCII");
  });

  it("compiles exactly the stages a grade enables", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ details: { vignette: 0.3 }, effects: { ascii: 0.5 } }),
    );
    startRuntimeWithVideo(video);

    expect(stageNames(mainFragmentSources().at(-1) ?? "", "define")).toEqual([
      "HF_STAGE_ASCII",
      "HF_STAGE_VIGNETTE",
    ]);
  });

  it.each([
    ["HF_STAGE_BLUR", { effects: { blur: 0.4 } }],
    ["HF_STAGE_KUWAHARA", { effects: { kuwahara: 0.4 } }],
    ["HF_STAGE_PIXELATE", { effects: { pixelate: 0.4 } }],
    ["HF_STAGE_TAPE", { effects: { tapeDamage: 0.4 } }],
    ["HF_STAGE_CHROMA_BLEED", { effects: { chromaBleed: 0.4 } }],
    ["HF_STAGE_CHROMATIC", { effects: { chromaticAberration: 0.4 } }],
    ["HF_STAGE_CRT", { effects: { crtCurvature: 0.4 } }],
    ["HF_STAGE_GLITCH", { effects: { digitalGlitch: 0.4 } }],
    ["HF_STAGE_GRAIN", { details: { grain: 0.4 } }],
    ["HF_STAGE_FILM_ARTIFACTS", { effects: { filmArtifacts: 0.4 } }],
    ["HF_STAGE_MONO_SCREEN", { effects: { monoScreen: 0.4 } }],
    ["HF_STAGE_ENGRAVING", { effects: { engraving: 0.4 } }],
    ["HF_STAGE_CROSSHATCH", { effects: { crosshatch: 0.4 } }],
    ["HF_STAGE_HALFTONE", { effects: { halftone: 0.4 } }],
    ["HF_STAGE_TWO_INK_PRINT", { effects: { twoInkPrint: 0.4 } }],
    ["HF_STAGE_DITHER", { effects: { dither: 0.4 } }],
    ["HF_STAGE_ASCII", { effects: { ascii: 0.4 } }],
    ["HF_STAGE_BLOOM", { effects: { bloom: 0.4 } }],
    ["HF_STAGE_SCANLINES", { effects: { scanlines: 0.4 } }],
    ["HF_STAGE_VIGNETTE", { details: { vignette: 0.4 } }],
    [
      "HF_STAGE_RGB_CURVES",
      {
        curves: {
          master: [
            [0, 0],
            [0.5, 0.6],
            [1, 1],
          ],
        },
      },
    ],
    [
      "HF_STAGE_HUE_CURVES",
      {
        hueCurves: {
          hueVsHue: [
            [0, 0],
            [120, 12],
            [240, 0],
          ],
        },
      },
    ],
    [
      "HF_STAGE_SECONDARIES",
      {
        secondaries: [
          {
            key: { hue: { center: 350, range: 20, softness: 10 } },
            correction: { saturation: 0.15 },
          },
        ],
      },
    ],
    ["HF_STAGE_LUT", { lut: { src: "/looks/test.cube" } }],
  ] as const)("keys %s to its own grade value and nothing else", (stage, grading) => {
    const { video } = startRuntimeWithVideo();
    runtime!.setGrading(`#${video.id}`, grading);

    expect(stageNames(mainFragmentSources().at(-1) ?? "", "define")).toEqual([stage]);
  });

  it("can enable every stage the shader guards, and no stage it does not", () => {
    const { video } = startRuntimeWithVideo();
    runtime!.setGrading(`#${video.id}`, {
      details: { grain: 0.5, vignette: 0.5 },
      effects: Object.fromEntries(HF_COLOR_GRADING_EFFECT_KEYS.map((key) => [key, 0.5])),
      curves: {
        master: [
          [0, 0],
          [0.5, 0.6],
          [1, 1],
        ],
      },
      hueCurves: {
        hueVsHue: [
          [0, 0],
          [120, 12],
          [240, 0],
        ],
      },
      secondaries: [
        {
          key: { hue: { center: 350, range: 20, softness: 10 } },
          correction: { saturation: 0.15 },
        },
      ],
      lut: { src: "/looks/test.cube" },
    });
    runtime!.setCompare(`#${video.id}`, { enabled: true });

    const fragment = mainFragmentSources().at(-1) ?? "";
    expect(stageNames(fragment, "ifdef")).not.toHaveLength(0);
    expect(stageNames(fragment, "define")).toEqual(stageNames(fragment, "ifdef"));
  });

  it("compiles a variant once per stage set and reuses it when the grade returns", () => {
    const { video } = startRuntimeWithVideo();
    const compiled = () => mainFragmentSources().length;
    const baseline = compiled();

    runtime!.setGrading(`#${video.id}`, { effects: { halftone: 0.6 } });
    expect(compiled()).toBe(baseline + 1);
    runtime!.setGrading(`#${video.id}`, { adjust: { exposure: 0.1 } });
    runtime!.setGrading(`#${video.id}`, { effects: { halftone: 0.2 } });
    expect(compiled()).toBe(baseline + 1);
  });

  it("evicts the least recently used variant, not a variant still in use", () => {
    const { video } = startRuntimeWithVideo();
    const amounts = [
      "blur",
      "kuwahara",
      "pixelate",
      "tapeDamage",
      "chromaBleed",
      "chromaticAberration",
      "crtCurvature",
      "digitalGlitch",
      "filmArtifacts",
      "monoScreen",
      "engraving",
      "crosshatch",
      "halftone",
      "twoInkPrint",
      "dither",
      "ascii",
      "bloom",
      "scanlines",
    ] as const;
    const distinctGrades = [
      ...amounts.map((key) => ({ effects: { [key]: 0.5 } })),
      ...amounts
        .slice(1)
        .map((key, index) => ({ effects: { [amounts[index]!]: 0.5, [key]: 0.5 } })),
    ];
    const compiled = () => mainFragmentSources().length;
    const adjustOnly = { adjust: { exposure: 0.5 } };

    // The adjust-only variant plus 31 more fills the 32-entry cache.
    for (const grading of distinctGrades.slice(0, 31)) runtime!.setGrading(`#${video.id}`, grading);
    runtime!.setGrading(`#${video.id}`, adjustOnly);
    const beforeEviction = compiled();
    runtime!.setGrading(`#${video.id}`, distinctGrades[31]!);
    runtime!.setGrading(`#${video.id}`, adjustOnly);

    expect(compiled()).toBe(beforeEviction + 1);
  });

  it("selects the variant from the animated grade, not the authored one", () => {
    const video = makeDrawableVideo();
    video.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ effects: { blur: 0 } }));
    video.style.setProperty("--hf-color-grading-blur", "0.45");
    startRuntimeWithVideo(video);

    expect(stageNames(mainFragmentSources().at(-1) ?? "", "define")).toEqual(["HF_STAGE_BLUR"]);
  });

  it("compiles each look preview with its own stages", async () => {
    const video = makeDrawableVideo();
    video.removeAttribute(HF_COLOR_GRADING_ATTR);
    document.body.appendChild(video);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,x");
    runtime = createColorGradingRuntime();

    await runtime.renderPreviews("#hero-video", [
      { id: "halftone", grading: { effects: { halftone: 0.5 } } },
    ]);

    expect(stageNames(mainFragmentSources().at(-1) ?? "", "define")).toEqual(["HF_STAGE_HALFTONE"]);
  });

  it("draws a variant the driver rejects through every stage, and stops retrying it", () => {
    const { video } = startRuntimeWithVideo();
    const gl = getContextSpy.mock.results[0]?.value as WebGLRenderingContext;
    const rejected = "#define HF_STAGE_HALFTONE\n#ifdef GL_FRAGMENT_PRECISION_HIGH";
    gl.getShaderParameter = vi.fn(() => !lastShaderSources.at(-1)?.startsWith(rejected));
    const attempts = () => lastShaderSources.filter((source) => source.startsWith(rejected)).length;

    runtime!.setGrading(`#${video.id}`, { effects: { halftone: 0.6 } });
    const fallback = mainFragmentSources().at(-1) ?? "";
    expect(stageNames(fallback, "define")).toEqual(stageNames(fallback, "ifdef"));
    runtime!.setGrading(`#${video.id}`, { adjust: { exposure: 0.1 } });
    runtime!.setGrading(`#${video.id}`, { effects: { halftone: 0.2 } });

    expect(attempts()).toBe(1);
    expect(runtime!.isGraded(video)).toBe(true);
  });

  it("stops compiling once even the every-stage variant is rejected", () => {
    const { video } = startRuntimeWithVideo();
    const gl = getContextSpy.mock.results[0]?.value as WebGLRenderingContext;
    gl.getShaderParameter = vi.fn(() => false);
    const compiled = () => mainFragmentSources().length;
    const afterCreation = compiled();

    runtime!.setGrading(`#${video.id}`, { effects: { halftone: 0.6 } });
    runtime!.setGrading(`#${video.id}`, { effects: { halftone: 0.2 } });

    expect(compiled()).toBe(afterCreation + 2);
  });

  it("uses the effected media sample as the graded shader input", () => {
    const video = makeDrawableVideo();
    video.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ effects: { blur: 0.25 } }));
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    const fragment = lastShaderSources.find((source) => source.includes("sampleMedia"));
    if (!fragment) throw new Error("Expected the media-treatment fragment shader");
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
    expect(fragment).toContain("vec3 applyTonalWheels(vec3 color)");
    expect(fragment).toContain("vec3 applyRgbCurves(vec3 color)");
    expect(fragment).toContain("vec3 applyHueCurves(vec3 color)");
    expect(fragment).toContain("vec3 applySecondary(vec3 color, float index)");
    expect(fragment).toContain("vec3 applyColorGrade(vec3 color)");
    expect(fragment).toContain(
      "float decodeSigned(float value){ return (value * 255.0 - 128.0) / 127.0; }",
    );
    expect(fragment).toContain(
      "vec3 color = mix(sampleColor.rgb, applyColorGrade(sampleColor.rgb), u_intensity);",
    );
    expect(fragment).toContain("vec3 cellColor = applyColorGrade(sampleMedia(cellUv).rgb);");
    const advancedStart = fragment.indexOf("vec3 applyAdvancedGrade");
    const wheels = fragment.indexOf("color = applyTonalWheels(color);", advancedStart);
    const rgbCurves = fragment.indexOf("color = applyRgbCurves(color);", advancedStart);
    const hueCurves = fragment.indexOf("color = applyHueCurves(color);", advancedStart);
    const secondary = fragment.indexOf("color = applySecondary(color, 0.0);", advancedStart);
    expect(wheels).toBeGreaterThan(advancedStart);
    expect(rgbCurves).toBeGreaterThan(wheels);
    expect(hueCurves).toBeGreaterThan(rgbCurves);
    expect(secondary).toBeGreaterThan(hueCurves);
    const gradeStart = fragment.indexOf("vec3 applyColorGrade");
    const primary = fragment.indexOf("color = applyPrimaryGrade(color);", gradeStart);
    const advanced = fragment.indexOf("color = applyAdvancedGrade(color);", gradeStart);
    const lut = fragment.indexOf("applyLut(clamp(color, 0.0, 1.0))", gradeStart);
    expect(primary).toBeGreaterThan(gradeStart);
    expect(advanced).toBeGreaterThan(primary);
    expect(lut).toBeGreaterThan(advanced);
    expect(fragment).not.toContain("mix(original, color, u_intensity)");
    expect(fragment).not.toContain("sampleSoft");
    const blurFragment = lastShaderSources.find((source) =>
      source.includes("uniform vec2 u_direction;"),
    );
    expect(blurFragment).toContain("stepUv * 12.0");
    expect(blurFragment).toContain("color.rgb *= color.a;");
    expect(blurFragment).toContain("color.rgb /= color.a;");
  });

  it("does not upload the advanced texture for a basic-only grade", () => {
    const video = makeDrawableVideo();
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(texImage2DCalls.some((args) => args[3] === 1024 && args[4] === 3)).toBe(false);
    expect(lastUniform1f).toHaveBeenCalledWith("u_rgbCurvesEnabled", 0);
    expect(lastUniform1f).toHaveBeenCalledWith("u_hueCurvesEnabled", 0);
    expect(lastUniform1f).toHaveBeenCalledWith("u_secondaryCount", 0);
  });

  it("does not upload identity curves with redundant diagonal points", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        curves: {
          master: [
            [0, 0],
            [0.5, 0.5],
            [1, 1],
          ],
        },
        details: { grain: 0.1 },
      }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(texImage2DCalls.some((args) => args[3] === 1024 && args[4] === 3)).toBe(false);
    expect(lastUniform1f).toHaveBeenCalledWith("u_rgbCurvesEnabled", 0);
  });

  it("uploads and enables wheels, curves, hue curves, and ordered secondaries", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        wheels: {
          shadows: { hue: 180, amount: 0.25, level: -0.1 },
          midtones: { hue: 30, amount: 0.1, level: 0.05 },
        },
        curves: {
          master: [
            [0, 0],
            [0.5, 0.6],
            [1, 1],
          ],
          red: [
            [0, 0],
            [0.5, 0.45],
            [1, 1],
          ],
        },
        hueCurves: {
          hueVsHue: [
            [0, 0],
            [120, 12],
            [240, 0],
          ],
          hueVsSaturation: [
            [0, 0],
            [120, 0.2],
            [240, 0],
          ],
        },
        secondaries: [
          {
            key: {
              hue: { center: 350, range: 20, softness: 10 },
              saturation: { min: 0.2, max: 0.9, softness: 0.1 },
              luma: { min: 0.1, max: 0.8, softness: 0.05 },
            },
            correction: {
              hueShift: 8,
              saturation: 0.15,
              luma: 0.04,
              temperature: 0.05,
              tint: -0.03,
            },
          },
        ],
      }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    const advancedUpload = texImage2DCalls.find(
      (args) =>
        args[3] === 1024 && args[4] === 3 && args[7] === 0x1401 && args[8] instanceof Uint8Array,
    );
    expect(advancedUpload).toBeDefined();
    const pixels = advancedUpload?.[8] as Uint8Array;
    expect(pixels[1024 * 4]).toBe(128);
    expect(lastUniform3f).toHaveBeenCalledWith("u_shadowWheel", 0.5, 0.25, -0.1);
    expect(lastUniform3f).toHaveBeenCalledWith("u_midtoneWheel", 30 / 360, 0.1, 0.05);
    expect(lastUniform1f).toHaveBeenCalledWith("u_rgbCurvesEnabled", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_hueCurvesEnabled", 1);
    expect(lastUniform1f).toHaveBeenCalledWith("u_secondaryCount", 1);
  });

  it("packs only enabled secondaries into the shader lookup", () => {
    const video = makeDrawableVideo();
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({
        secondaries: [
          {
            enabled: false,
            key: { hue: { center: 20, range: 15 } },
            correction: { saturation: 0.5 },
          },
          {
            key: { hue: { center: 210, range: 20 } },
            correction: { luma: 0.1 },
          },
        ],
      }),
    );
    document.body.appendChild(video);

    runtime = createColorGradingRuntime();

    expect(lastUniform1f).toHaveBeenCalledWith("u_secondaryCount", 1);
    const advancedUpload = texImage2DCalls.find(
      (args) =>
        args[3] === 1024 && args[4] === 3 && args[7] === 0x1401 && args[8] instanceof Uint8Array,
    );
    const pixels = advancedUpload?.[8] as Uint8Array;
    expect(pixels[1024 * 4 * 2]).toBeCloseTo(Math.round((210 / 360) * 255), 0);
  });

  it("reuses an unchanged advanced texture while basic adjustments change", () => {
    const video = makeDrawableVideo();
    const curves = {
      master: [
        [0, 0],
        [0.5, 0.6],
        [1, 1],
      ],
    } as const;
    video.setAttribute(HF_COLOR_GRADING_ATTR, serializeHfColorGrading({ curves }));
    document.body.appendChild(video);
    runtime = createColorGradingRuntime();
    const uploads = () =>
      texImage2DCalls.filter((args) => args[3] === 1024 && args[4] === 3).length;

    expect(uploads()).toBe(1);
    runtime.setGrading(`#${video.id}`, { curves, adjust: { exposure: 0.2 } });
    expect(uploads()).toBe(1);
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
      type === "webgl"
        ? createMockWebGl({ failMediaUpload: true })
        : type === "2d"
          ? mock2d()
          : null,
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
    const shared = getContextSpy.mock.instances[0] as HTMLCanvasElement;

    const lost = new Event("webglcontextlost", { cancelable: true });
    shared.dispatchEvent(lost);

    expect(lost.defaultPrevented).toBe(true);
    expect(canvas.style.display).toBe("none");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(false);
    expect(video.style.getPropertyValue("opacity")).toBe("");
    expect(runtime?.getStatus("#hero-video")).toEqual({
      state: "unavailable",
      message: "WebGL context lost",
    });

    shared.dispatchEvent(new Event("webglcontextrestored"));

    expect(runtime?.getStatus("#hero-video").state).toBe("active");
    expect(video.hasAttribute("data-hf-color-grading-source-hidden")).toBe(true);
    expect(video.style.getPropertyValue("opacity")).toBe("0");
  });

  it("does not rescan the document when only text changes", async () => {
    startRuntimeWithVideo();
    const caption = document.createElement("p");
    document.body.appendChild(caption);
    await Promise.resolve();
    const scan = vi.spyOn(document, "querySelectorAll");
    caption.textContent = "Hello";
    caption.append(document.createElement("span"));
    await Promise.resolve();
    expect(
      scan.mock.calls.filter(([selector]) => selector.includes(HF_COLOR_GRADING_ATTR)),
    ).toEqual([]);
  });

  it("still grades media inserted later and drops media removed", async () => {
    startRuntimeWithVideo();
    const wrapper = document.createElement("section");
    const later = makeDrawableVideo();
    later.id = "later-video";
    wrapper.appendChild(later);
    document.body.appendChild(wrapper);
    await Promise.resolve();
    expect(runtime!.isGraded(later)).toBe(true);
    wrapper.remove();
    await Promise.resolve();
    expect(runtime!.isGraded(later)).toBe(false);
  });

  it("drops media graded through the API when a wrapper holding it is removed", async () => {
    startRuntimeWithVideo();
    const wrapper = document.createElement("section");
    const live = makeDrawableVideo();
    live.id = "live-video";
    live.removeAttribute(HF_COLOR_GRADING_ATTR);
    wrapper.appendChild(live);
    document.body.appendChild(wrapper);
    runtime!.setGrading(live, { adjust: { exposure: 0.5 } });
    expect(runtime!.isGraded(live)).toBe(true);
    wrapper.remove();
    await Promise.resolve();
    expect(runtime!.isGraded(live)).toBe(false);
  });

  describe("a grade group", () => {
    const grade = (exposure: number) => serializeHfColorGrading({ adjust: { exposure } });

    function addGroup(id: string, exposure: number | null): HTMLElement {
      const group = document.createElement(HF_COLOR_GROUP_TAG);
      group.id = id;
      if (exposure !== null) group.setAttribute(HF_COLOR_GRADING_ATTR, grade(exposure));
      document.body.appendChild(group);
      return group;
    }

    function addMember(id: string, groupId: string): HTMLVideoElement {
      const video = makeDrawableVideo();
      video.id = id;
      video.removeAttribute(HF_COLOR_GRADING_ATTR);
      video.setAttribute(HF_COLOR_GROUP_ATTR, groupId);
      document.body.appendChild(video);
      return video;
    }

    const exposureDraws = (exposure: number): number =>
      (lastUniform1f?.mock.calls ?? []).filter(
        ([name, value]) => name === "u_exposure" && value === exposure,
      ).length;

    it("grades a member through its group element", () => {
      addGroup("tamer", 0.4);
      const member = addMember("clip-1", "tamer");

      runtime = createColorGradingRuntime();

      expect(runtime.isGraded(member)).toBe(true);
      expect(exposureDraws(0.4)).toBe(1);
    });

    it("re-grades every member when the group's grading changes", async () => {
      const group = addGroup("tamer", 0.4);
      const members = ["clip-1", "clip-2", "clip-3"].map((id) => addMember(id, "tamer"));
      runtime = createColorGradingRuntime();
      lastUniform1f?.mockClear();

      group.setAttribute(HF_COLOR_GRADING_ATTR, grade(-0.3));
      await Promise.resolve();

      expect(members.every((member) => runtime!.isGraded(member))).toBe(true);
      expect(exposureDraws(-0.3)).toBe(members.length);
      expect(exposureDraws(0.4)).toBe(0);
    });

    it("draws only the members on screen, and grades a hidden one when it shows", async () => {
      const group = addGroup("tamer", 0.4);
      const shown = addMember("clip-1", "tamer");
      const hidden = addMember("clip-2", "tamer");
      hidden.style.display = "none";
      runtime = createColorGradingRuntime();
      lastUniform1f?.mockClear();

      group.setAttribute(HF_COLOR_GRADING_ATTR, grade(-0.3));
      await Promise.resolve();

      expect(runtime.isGraded(shown)).toBe(true);
      expect(runtime.isGraded(hidden)).toBe(false);
      expect(exposureDraws(-0.3)).toBe(1);

      hidden.style.display = "block";
      expect(runtime.setSourceVisibility(hidden, true)).toBe(true);
      expect(runtime.isGraded(hidden)).toBe(true);
      expect(exposureDraws(-0.3)).toBe(2);
    });

    it("moves a member to the lane its data-color-group names", async () => {
      addGroup("tamer", 0.4);
      addGroup("guest", -0.3);
      const member = addMember("clip-1", "tamer");
      runtime = createColorGradingRuntime();
      lastUniform1f?.mockClear();

      member.setAttribute(HF_COLOR_GROUP_ATTR, "guest");
      await Promise.resolve();
      expect(runtime.isGraded(member)).toBe(true);
      expect(exposureDraws(-0.3)).toBe(1);

      member.setAttribute(HF_COLOR_GROUP_ATTR, "");
      await Promise.resolve();
      expect(runtime.isGraded(member)).toBe(false);
    });

    it("ungrades its members when its grading or the element goes", async () => {
      const group = addGroup("tamer", 0.4);
      const members = ["clip-1", "clip-2"].map((id) => addMember(id, "tamer"));
      runtime = createColorGradingRuntime();

      group.removeAttribute(HF_COLOR_GRADING_ATTR);
      await Promise.resolve();
      expect(members.some((member) => runtime!.isGraded(member))).toBe(false);

      group.setAttribute(HF_COLOR_GRADING_ATTR, grade(0.4));
      await Promise.resolve();
      expect(members.every((member) => runtime!.isGraded(member))).toBe(true);

      group.remove();
      await Promise.resolve();
      expect(members.some((member) => runtime!.isGraded(member))).toBe(false);
    });

    it("lets a member's own grading override its group's", async () => {
      const group = addGroup("tamer", 0.4);
      const member = addMember("clip-1", "tamer");
      member.setAttribute(HF_COLOR_GRADING_ATTR, grade(-0.2));
      runtime = createColorGradingRuntime();

      expect(exposureDraws(-0.2)).toBe(1);
      expect(exposureDraws(0.4)).toBe(0);

      group.setAttribute(HF_COLOR_GRADING_ATTR, grade(0.9));
      await Promise.resolve();
      expect(exposureDraws(0.9)).toBe(0);
      expect(runtime.isGraded(member)).toBe(true);
    });
  });
});

describe("createColorGradingRuntime after a context loss", () => {
  it("grades a clip that came on screen while the context was lost once it is restored", () => {
    let lost = false;
    const gl = createMockWebGl();
    gl.createTexture = vi.fn(() => (lost ? null : ({} as WebGLTexture)));
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(((type: string) =>
        type === "webgl" ? gl : type === "2d" ? mock2d() : null) as never);
    try {
      document.body.innerHTML = "";
      const first = makeDrawableVideo();
      first.id = "first";
      const second = makeDrawableVideo();
      second.id = "second";
      second.style.visibility = "hidden";
      document.body.append(first, second);
      const runtime = createColorGradingRuntime();
      const shared = spy.mock.instances[0] as HTMLCanvasElement;

      lost = true;
      shared.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      second.style.visibility = "visible";
      runtime.refresh();
      expect(runtime.getStatus("#second").state).toBe("unavailable");

      lost = false;
      shared.dispatchEvent(new Event("webglcontextrestored"));

      expect(runtime.getStatus("#first").state).toBe("active");
      expect(runtime.getStatus("#second").state).toBe("active");
      runtime.destroy();
    } finally {
      spy.mockRestore();
      document.body.innerHTML = "";
    }
  });
});

describe("createColorGradingRuntime when a lost context is never restored", () => {
  it("builds a new context and grades the clips again", () => {
    vi.useFakeTimers();
    const evicted = createMockWebGl();
    let lost = false;
    evicted.isContextLost = () => lost;
    const replacement = createMockWebGl();
    const contexts = [evicted, replacement];
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(((type: string) =>
        type === "webgl"
          ? (contexts.shift() ?? replacement)
          : type === "2d"
            ? mock2d()
            : null) as never);
    try {
      document.body.innerHTML = "";
      const video = makeDrawableVideo();
      video.id = "clip";
      document.body.append(video);
      const runtime = createColorGradingRuntime();
      const shared = spy.mock.instances[0] as HTMLCanvasElement;
      expect(runtime.getStatus("#clip").state).toBe("active");

      lost = true;
      shared.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(runtime.getStatus("#clip").state).toBe("unavailable");

      vi.advanceTimersByTime(3000);

      expect(runtime.getStatus("#clip").state).toBe("active");
      lost = false;
      shared.dispatchEvent(new Event("webglcontextrestored"));
      expect(runtime.getStatus("#clip").state).toBe("active");
      runtime.destroy();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
      document.body.innerHTML = "";
    }
  });
});

describe("createColorGradingRuntime when no new context can be made yet", () => {
  it("keeps the clips ungraded and tries again after the grace period", () => {
    vi.useFakeTimers();
    const evicted = createMockWebGl();
    let lost = false;
    evicted.isContextLost = () => lost;
    const replacement = createMockWebGl();
    const contexts: Array<WebGLRenderingContext | null> = [evicted, null];
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(((type: string) =>
        type === "webgl"
          ? contexts.length > 0
            ? contexts.shift()
            : replacement
          : type === "2d"
            ? mock2d()
            : null) as never);
    try {
      document.body.innerHTML = "";
      const video = makeDrawableVideo();
      video.id = "clip";
      document.body.append(video);
      const runtime = createColorGradingRuntime();
      const shared = spy.mock.instances[0] as HTMLCanvasElement;

      lost = true;
      shared.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      vi.advanceTimersByTime(3000);
      expect(runtime.getStatus("#clip").state).toBe("unavailable");

      vi.advanceTimersByTime(3000);
      expect(runtime.getStatus("#clip").state).toBe("active");
      runtime.destroy();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
      document.body.innerHTML = "";
    }
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

describe("calculateObjectFitUv", () => {
  // The shader reads uv = (v_uv - offset) / scale; v_uv.y and the flipped source
  // texture both run bottom-up, so this reports the CSS-facing fraction from the top.
  function sampledFromSourceTop(
    uv: ReturnType<typeof calculateObjectFitUv>,
    boxEdgeY: 0 | 1,
  ): number {
    return 1 - (boxEdgeY - uv.offsetY) / uv.scaleY;
  }

  function sampledFromSourceLeft(
    uv: ReturnType<typeof calculateObjectFitUv>,
    boxEdgeX: 0 | 1,
  ): number {
    return (boxEdgeX - uv.offsetX) / uv.scaleX;
  }

  it("shows the top of a covered portrait source at object-position 50% 6%", () => {
    const uv = calculateObjectFitUv(1920, 1080, 1080, 1920, "cover", "50% 6%");

    expect(sampledFromSourceTop(uv, 1)).toBeCloseTo(0.041, 3);
    expect(sampledFromSourceTop(uv, 0)).toBeCloseTo(0.3574, 3);
  });

  it("shows the bottom of a covered portrait source at object-position 50% 94%", () => {
    const uv = calculateObjectFitUv(1920, 1080, 1080, 1920, "cover", "50% 94%");

    expect(sampledFromSourceTop(uv, 1)).toBeCloseTo(0.6426, 3);
    expect(sampledFromSourceTop(uv, 0)).toBeCloseTo(0.959, 3);
  });

  it("shows the left of a covered landscape source at object-position 6% 50%", () => {
    const uv = calculateObjectFitUv(1080, 1920, 1920, 1080, "cover", "6% 50%");

    expect(sampledFromSourceLeft(uv, 0)).toBeCloseTo(0.041, 3);
    expect(sampledFromSourceLeft(uv, 1)).toBeCloseTo(0.3574, 3);
  });

  it("centers a covered source when no object-position is set", () => {
    const uv = calculateObjectFitUv(1920, 1080, 1080, 1920, "cover", "");

    expect(sampledFromSourceTop(uv, 1)).toBeCloseTo(0.3415, 3);
    expect(sampledFromSourceTop(uv, 0)).toBeCloseTo(0.6585, 3);
  });
});
