import { describe, expect, it } from "bun:test";
import type { Fps } from "@hyperframes/core";
import type { VideoElement, VideoMetadata } from "@hyperframes/engine";
import { inspectVideoLayout } from "../render/videoLayerPassthroughPlan.js";
import {
  DEFAULT_MAX_OVERLAY_STATES,
  type EligibilityDeps,
  checkPassthroughEligibility,
  checkRenderGates,
  checkSourceMetadata,
} from "./eligibility.js";
import type { HdrPassthroughInput, LazyOverlaySession, PassthroughEligibility } from "./types.js";
import { createFakePage, FakeElement, FakeTimeline } from "./__test_utils__/fakePage.js";

const FPS30: Fps = { num: 30, den: 1 };
const HLG = { colorTransfer: "arib-std-b67", colorPrimaries: "bt2020", colorSpace: "bt2020nc" };

function metadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    durationSeconds: 20,
    videoStreamDurationSeconds: 20,
    width: 3840,
    height: 2160,
    fps: 30,
    videoCodec: "hevc",
    hasAudio: true,
    isVFR: false,
    hasAlpha: false,
    colorSpace: HLG,
    ...overrides,
  };
}

function videoElement(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "v",
    src: "media/vlog.mov",
    start: 0,
    end: 10,
    mediaStart: 0,
    loop: false,
    hasAudio: true,
    ...overrides,
  };
}

interface InputOverrides {
  videos?: VideoElement[];
  format?: string;
  motionBlur?: unknown;
  deviceScaleFactor?: number;
  width?: number;
  transfer?: "hlg" | "pq";
  hdrImages?: string[];
  useGpu?: boolean;
  codec?: string;
}

function makeInput(o: InputOverrides = {}): HdrPassthroughInput {
  const transfer = o.transfer ?? "hlg";
  return {
    job: { config: { fps: FPS30, format: o.format, motionBlur: o.motionBlur, useGpu: o.useGpu } },
    composition: {
      duration: 10,
      videos: o.videos ?? [videoElement()],
      audios: [],
      images: [],
      width: 1920,
      height: 1080,
    },
    width: o.width ?? 1920,
    height: 1080,
    totalFrames: 300,
    hasHdrContent: true,
    effectiveHdr: { transfer },
    preset: {
      codec: o.codec ?? "h265",
      preset: "medium",
      pixelFormat: "yuv420p10le",
      hdr: { transfer },
    },
    nativeHdrVideoIds: new Set((o.videos ?? [videoElement()]).map((v) => v.id)),
    nativeHdrImageIds: new Set(o.hdrImages ?? []),
    videoTransfers: new Map((o.videos ?? [videoElement()]).map((v) => [v.id, transfer])),
    projectDir: "/project",
    compiledDir: "/project/.compiled",
    buildCaptureOptions: () => ({ deviceScaleFactor: o.deviceScaleFactor }),
    abortSignal: undefined,
    assertNotAborted: () => {},
  } as unknown as HdrPassthroughInput;
}

interface PageSpec {
  layout?: { fit: "fill" | "cover" } | { reason: string };
  transitions?: unknown[];
  /** Adds overlay elements and timelines to a root holding `#wrap > video#v`. */
  build?: (ctx: { root: FakeElement; wrap: FakeElement; video: FakeElement }) => {
    timelines?: Record<string, FakeTimeline>;
    globalTimeline?: FakeTimeline;
    globals?: Record<string, unknown>;
    closedShadowRoots?: number;
    nativeListeners?: readonly string[];
    onceNativeListeners?: readonly string[];
  };
}

function makeSession(spec: PageSpec = {}): {
  session: LazyOverlaySession;
  opened: () => boolean;
  seeks: number[];
} {
  const root = new FakeElement("div", "root", {
    "data-composition-id": "main",
    "data-start": "0",
    "data-duration": "10",
  });
  const wrap = new FakeElement("div", "wrap");
  const video = new FakeElement("video", "v", { "data-start": "0", "data-duration": "10" });
  root.append(wrap.append(video));
  const extra = spec.build?.({ root, wrap, video }) ?? {};
  const { page, seeks } = createFakePage({
    root,
    duration: 10,
    transitions: spec.transitions,
    stubs: new Map([[inspectVideoLayout, () => spec.layout ?? { fit: "fill" }]]),
    ...extra,
  });
  let opened = false;
  const session: LazyOverlaySession = {
    get: async () => {
      opened = true;
      return { page } as never;
    },
    get opened() {
      return opened;
    },
    close: async () => {},
  };
  return { session, opened: () => opened, seeks };
}

function deps(meta: VideoMetadata = metadata(), exists = true): EligibilityDeps {
  return {
    fileExists: () => exists,
    probeMetadata: async () => meta,
    checkBlend: async () => ({ exact: true }),
    canPaceEncoder: () => true,
    inspectState: async () => null,
    loadCensus: () => undefined,
    videoLayerAt0: async () => undefined,
    inspectContent: async () => null,
  };
}

function captions(ctx: { root: FakeElement }) {
  const c1 = new FakeElement("div", "c1", { "data-start": "1", "data-duration": "2" });
  const c2 = new FakeElement("div", "c2", { "data-start": "3", "data-duration": "4" });
  ctx.root.append(c1, c2);
  const global = new FakeTimeline();
  const main = new FakeTimeline().set(c2, 5, { color: "#fff" });
  global.add(main, 0);
  return { timelines: { main }, globalTimeline: global };
}

async function check(
  input: HdrPassthroughInput,
  page: PageSpec = { build: captions },
  d: EligibilityDeps = deps(),
): Promise<PassthroughEligibility> {
  return checkPassthroughEligibility({ input, session: makeSession(page).session }, d);
}

describe("checkPassthroughEligibility", () => {
  it("accepts one full-bleed HLG video under clip-timed captions", async () => {
    const { session, seeks } = makeSession({ build: captions });
    const result = await checkPassthroughEligibility({ input: makeInput(), session }, deps());
    if (!result.eligible) throw new Error(`${result.reason}: ${result.detail}`);
    expect(result.video).toMatchObject({
      id: "v",
      srcPath: "/project/media/vlog.mov",
      mediaStart: 0,
      duration: 10,
      fit: "fill",
      transfer: "hlg",
      primaries: "bt2020",
      width: 3840,
      height: 2160,
    });
    expect(result.timing.totalFrames).toBe(300);
    expect(result.timing.changeFrames.length + 1).toBeLessThan(DEFAULT_MAX_OVERLAY_STATES);
    for (const f of [30, 90, 150, 210]) expect(result.timing.changeFrames).toContain(f);
    // The layout probe leaves the page at time 0.
    expect(seeks.at(-1)).toBe(0);
  });

  it("carries a trim offset through when the source covers it", async () => {
    const input = makeInput({ videos: [videoElement({ mediaStart: 5 })] });
    const result = await check(input);
    expect(result.eligible).toBe(true);
    expect(result.video?.mediaStart).toBe(5);

    const short = makeInput({ videos: [videoElement({ mediaStart: 12 })] });
    expect(await check(short)).toMatchObject({ eligible: false, reason: "source_unsupported" });
  });

  it("declines an ffmpeg whose blend does not match the layered path, before opening the page", async () => {
    const { session, opened } = makeSession();
    let checks = 0;
    const offByOne: EligibilityDeps = {
      ...deps(),
      checkBlend: async () => {
        checks++;
        return {
          exact: false,
          detail: "maskedmerge misses the layered blend on 7748 of 49152 samples",
        };
      },
    };
    const result = await checkPassthroughEligibility({ input: makeInput(), session }, offByOne);
    expect(result).toMatchObject({
      eligible: false,
      reason: "ffmpeg_unsupported",
      detail: "maskedmerge misses the layered blend on 7748 of 49152 samples",
    });
    expect(checks).toBe(1);
    expect(opened()).toBe(false);

    // An exact blend passes the gate.
    let exactChecks = 0;
    const exact: EligibilityDeps = {
      ...deps(),
      checkBlend: async () => {
        exactChecks++;
        return { exact: true };
      },
    };
    expect((await check(makeInput(), { build: captions }, exact)).eligible).toBe(true);
    expect(exactChecks).toBe(1);
  });

  it("declines a host where the encoder cannot be paced, before opening the page", async () => {
    const { session, opened } = makeSession();
    const result = await checkPassthroughEligibility(
      { input: makeInput(), session },
      { ...deps(), canPaceEncoder: () => false },
    );
    expect(result).toMatchObject({ eligible: false, reason: "ffmpeg_unsupported" });
    expect(opened()).toBe(false);
  });

  it.each([
    ["GPU encode", { useGpu: true }, "GPU encode selected"],
    ["another codec", { codec: "h264" }, "not h264"],
  ])(
    "declines %s before opening the page: the encode is paced on libx265",
    async (_n, o, detail) => {
      const { session, opened } = makeSession();
      let blendChecks = 0;
      const result = await checkPassthroughEligibility(
        { input: makeInput(o), session },
        {
          ...deps(),
          checkBlend: async () => {
            blendChecks++;
            return { exact: true };
          },
        },
      );
      expect(result).toMatchObject({
        eligible: false,
        reason: "ffmpeg_unsupported",
        detail: expect.stringContaining(detail),
      });
      expect(opened()).toBe(false);
      expect(blendChecks).toBe(0);
    },
  );

  it("runs the DevTools-only page gates before any seek or in-page probe", async () => {
    const { session, seeks } = makeSession({ build: captions });
    let contentChecks = 0;
    const result = await checkPassthroughEligibility(
      { input: makeInput(), session },
      {
        ...deps(),
        inspectState: async () => ({ reason: "seek_callback", detail: "a MutationObserver" }),
        inspectContent: async () => {
          contentChecks++;
          return null;
        },
      },
    );
    expect(result).toMatchObject({
      eligible: false,
      reason: "seek_callback",
      detail: "a MutationObserver",
    });
    expect(seeks).toHaveLength(0);
    expect(contentChecks).toBe(0);
  });

  it("reads the page state again after the analysis has seeked the composition", async () => {
    const { session, seeks } = makeSession({ build: captions });
    const seen: number[] = [];
    const result = await checkPassthroughEligibility(
      { input: makeInput(), session },
      {
        ...deps(),
        inspectState: async () => {
          seen.push(seeks.length);
          return seen.length === 1
            ? null
            : { reason: "seek_callback", detail: "a delayedCall the seeks registered" };
        },
      },
    );
    expect(result).toMatchObject({ eligible: false, reason: "seek_callback" });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(0);
    expect(seen[1]).toBeGreaterThan(0);
  });

  it("declines what the content gates find after the analysis", async () => {
    const verdict = await check(
      makeInput(),
      { build: captions },
      {
        ...deps(),
        inspectContent: async (_page, videoId, final) => {
          expect(videoId).toBe("v");
          expect(final).toBe(false);
          return { reason: "overlay_unsupported", detail: "1 <canvas>" };
        },
      },
    );
    expect(verdict).toMatchObject({
      eligible: false,
      reason: "overlay_unsupported",
      detail: "1 <canvas>",
    });
  });

  it("rejects two videos before opening the page", async () => {
    const { session, opened } = makeSession();
    const input = makeInput({ videos: [videoElement(), videoElement({ id: "v2" })] });
    const result = await checkPassthroughEligibility({ input, session }, deps());
    expect(result).toMatchObject({ eligible: false, reason: "video_count" });
    expect(opened()).toBe(false);
  });

  it("rejects a transformed video", async () => {
    const result = await check(makeInput(), { layout: { reason: "transform_or_filter" } });
    expect(result).toMatchObject({ eligible: false, reason: "transform_or_filter" });
  });

  it("rejects a border radius the layered path would clip the video to", async () => {
    const own = await check(makeInput(), {
      build: (ctx) => {
        ctx.video.style.borderTopLeftRadius = "48px";
        return captions(ctx);
      },
    });
    expect(own).toMatchObject({
      eligible: false,
      reason: "clip_or_mask",
      detail: "border-radius on #v",
    });

    const percent = await check(makeInput(), {
      build: (ctx) => {
        ctx.video.style.borderBottomRightRadius = "5%";
        return captions(ctx);
      },
    });
    expect(percent).toMatchObject({ eligible: false, reason: "clip_or_mask" });

    // An elliptical radius whose first value is 0 still rounds the corner.
    const elliptical = await check(makeInput(), {
      build: (ctx) => {
        ctx.video.style.borderTopRightRadius = "0px 24px";
        return captions(ctx);
      },
    });
    expect(elliptical).toMatchObject({ eligible: false, reason: "clip_or_mask" });

    const wrapper = await check(makeInput(), {
      build: (ctx) => {
        Object.assign(ctx.wrap.style, { overflow: "hidden", borderTopLeftRadius: "48px" });
        return captions(ctx);
      },
    });
    expect(wrapper).toMatchObject({
      eligible: false,
      reason: "clip_or_mask",
      detail: "border-radius on #wrap",
    });

    const outer = await check(makeInput(), {
      build: (ctx) => {
        Object.assign(ctx.root.style, { overflow: "clip", borderBottomLeftRadius: "12px" });
        return captions(ctx);
      },
    });
    expect(outer).toMatchObject({ eligible: false, reason: "clip_or_mask" });
  });

  it("ignores a radius on an ancestor that does not clip", async () => {
    const result = await check(makeInput(), {
      build: (ctx) => {
        ctx.wrap.style.borderTopLeftRadius = "48px";
        return captions(ctx);
      },
    });
    expect(result.eligible).toBe(true);
  });

  it("rejects a GSAP tween on the video or anything containing it", async () => {
    const onVideo = await check(makeInput(), {
      build: ({ video }) => {
        const global = new FakeTimeline();
        const main = new FakeTimeline().tween({
          start: 0,
          duration: 10,
          targets: [video],
          vars: { scale: 1.1 },
        });
        global.add(main, 0);
        return { timelines: { main }, globalTimeline: global };
      },
    });
    expect(onVideo).toMatchObject({ eligible: false, reason: "video_animated" });

    const onWrapper = await check(makeInput(), {
      build: ({ wrap }) => {
        const global = new FakeTimeline();
        const main = new FakeTimeline().set(wrap, 4, { opacity: 0.5 });
        global.add(main, 0);
        return { timelines: { main }, globalTimeline: global };
      },
    });
    expect(onWrapper).toMatchObject({ eligible: false, reason: "video_animated" });
  });

  it("rejects a CSS animation on the video and a clip window that hides it early", async () => {
    const css = await check(makeInput(), {
      build: ({ video }) => {
        video.animations.push({ playState: "running" });
        return {};
      },
    });
    expect(css).toMatchObject({ eligible: false, reason: "video_animated" });

    const clipped = await check(makeInput(), {
      build: ({ wrap }) => {
        wrap.attrs["data-start"] = "0";
        wrap.attrs["data-duration"] = "6";
        return {};
      },
    });
    expect(clipped).toMatchObject({ eligible: false, reason: "not_shown" });
  });

  it("passes overlay-timing verdicts through", async () => {
    const result = await check(makeInput(), {
      build: ({ root }) => {
        const cap = new FakeElement("div", "cap");
        root.append(cap);
        const global = new FakeTimeline();
        const main = new FakeTimeline().tween({
          start: 1,
          duration: 3,
          targets: [cap],
          vars: { x: 50 },
        });
        global.add(main, 0);
        return { timelines: { main }, globalTimeline: global };
      },
    });
    expect(result).toMatchObject({ eligible: false, reason: "overlay_continuous_animation" });

    const call = await check(makeInput(), {
      build: () => {
        const global = new FakeTimeline();
        const main = new FakeTimeline().call(2);
        global.add(main, 0);
        return { timelines: { main }, globalTimeline: global };
      },
    });
    expect(call).toMatchObject({ eligible: false, reason: "timeline_call" });
  });

  it("rejects shader transitions, remote and missing sources", async () => {
    expect(await check(makeInput(), { transitions: [{ shader: "x" }] })).toMatchObject({
      eligible: false,
      reason: "shader_transitions",
    });
    const remote = makeInput({ videos: [videoElement({ src: "https://example.com/a.mp4" })] });
    expect(await check(remote)).toMatchObject({ eligible: false, reason: "remote_source" });
    expect(await check(makeInput(), { build: captions }, deps(metadata(), false))).toMatchObject({
      eligible: false,
      reason: "source_missing",
    });
  });

  it("throws (so the caller falls back) on an input it cannot read", async () => {
    const { session } = makeSession();
    await expect(
      checkPassthroughEligibility({ input: {} as HdrPassthroughInput, session }, deps()),
    ).rejects.toThrow();
  });
});

describe("checkRenderGates", () => {
  it.each([
    { name: "webm output", o: { format: "webm" }, reason: "output_format" },
    { name: "supersampled capture", o: { deviceScaleFactor: 2 }, reason: "output_scale" },
    { name: "output size differs", o: { width: 1280 }, reason: "output_scale" },
    { name: "motion blur", o: { motionBlur: { samplesPerFrame: 8 } }, reason: "motion_blur" },
    { name: "HDR images", o: { hdrImages: ["img"] }, reason: "hdr_images" },
  ])("$name → $reason", ({ o, reason }) => {
    expect(checkRenderGates(makeInput(o as InputOverrides))).toMatchObject({
      eligible: false,
      reason,
    });
  });

  it("declines a range render, which captures a frame window of the film", () => {
    const ranged = {
      ...makeInput(),
      job: { ...makeInput().job, frameWindow: { startFrame: 30, endFrame: 90 } },
    } as HdrPassthroughInput;
    expect(checkRenderGates(ranged)).toMatchObject({ reason: "frame_window" });
  });

  it("rejects SDR renders and passes the default HDR mp4 render", () => {
    const sdr = { ...makeInput(), hasHdrContent: false } as HdrPassthroughInput;
    expect(checkRenderGates(sdr)).toMatchObject({ reason: "not_hdr" });
    expect(checkRenderGates(makeInput())).toBeNull();
    expect(checkRenderGates(makeInput({ format: "mp4" }))).toBeNull();
  });
});

describe("checkSourceMetadata", () => {
  const base = {
    transfer: "hlg" as const,
    mediaStart: 0,
    duration: 10,
    canvas: { width: 1920, height: 1080 },
  };

  it("accepts a same-aspect bt2020 HLG source that covers the window", () => {
    expect(checkSourceMetadata({ ...base, metadata: metadata() })).toBeNull();
    expect(checkSourceMetadata({ ...base, mediaStart: 10, metadata: metadata() })).toBeNull();
  });

  it.each([
    {
      name: "PQ source on an HLG render",
      meta: { colorSpace: { ...HLG, colorTransfer: "smpte2084" } },
      reason: "video_not_native_hdr",
    },
    {
      name: "SDR source",
      meta: { colorSpace: { ...HLG, colorTransfer: "bt709" } },
      reason: "video_not_native_hdr",
    },
    {
      name: "bt709 primaries",
      meta: { colorSpace: { ...HLG, colorPrimaries: "bt709" } },
      reason: "source_unsupported",
    },
    { name: "VFR", meta: { isVFR: true }, reason: "source_unsupported" },
    { name: "alpha", meta: { hasAlpha: true }, reason: "source_unsupported" },
    { name: "rotated", meta: { rotation: 90 }, reason: "source_unsupported" },
    { name: "anamorphic", meta: { sampleAspectRatio: 1.333 }, reason: "source_unsupported" },
    { name: "different aspect", meta: { width: 1080, height: 1920 }, reason: "object_fit" },
    {
      name: "too short",
      meta: { durationSeconds: 9, videoStreamDurationSeconds: 9 },
      reason: "source_unsupported",
    },
  ])("$name → $reason", ({ meta, reason }) => {
    expect(
      checkSourceMetadata({ ...base, metadata: metadata(meta as Partial<VideoMetadata>) }),
    ).toMatchObject({
      eligible: false,
      reason,
    });
  });

  it("rejects a video stream that starts a second or more after mediaStart", () => {
    const late = metadata({ videoStreamLeadSeconds: 1.5, videoStreamDurationSeconds: 18.5 });
    expect(checkSourceMetadata({ ...base, metadata: late })).toMatchObject({
      eligible: false,
      reason: "source_unsupported",
    });
    // Trimmed past most of the lead, or a sub-second lead: the layered path shows the video.
    expect(checkSourceMetadata({ ...base, mediaStart: 1, metadata: late })).toBeNull();
    const slight = metadata({ videoStreamLeadSeconds: 0.5, videoStreamDurationSeconds: 19.5 });
    expect(checkSourceMetadata({ ...base, metadata: slight })).toBeNull();
    const offset = metadata({ mediaTimeOffsetSeconds: 1 });
    expect(checkSourceMetadata({ ...base, metadata: offset })).toMatchObject({
      reason: "source_unsupported",
    });
  });

  it("scales a source within the aspect tolerance onto an odd canvas, and declines a crop", () => {
    // 1280x720 on 1279x719 differs in aspect by 6e-4; the parity harness's
    // `edge-odd-canvas` fixture renders it bit-identical to the layered path.
    const odd = { ...base, canvas: { width: 1279, height: 719 } };
    expect(
      checkSourceMetadata({ ...odd, metadata: metadata({ width: 1280, height: 720 }) }),
    ).toBeNull();
    // 4:3 under cover on 16:9 is a crop, which the composite does not reproduce.
    expect(
      checkSourceMetadata({ ...base, metadata: metadata({ width: 1440, height: 1080 }) }),
    ).toMatchObject({ reason: "object_fit", detail: "source 1440x1080 vs canvas 1920x1080" });
  });

  it("rejects a trim offset the source cannot cover", () => {
    expect(checkSourceMetadata({ ...base, mediaStart: 10.5, metadata: metadata() })).toMatchObject({
      reason: "source_unsupported",
    });
  });
});
