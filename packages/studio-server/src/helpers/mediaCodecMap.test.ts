import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FfprobeRunner } from "./mediaMetadata.js";
import {
  BROWSER_HOSTILE_CODECS,
  decideMediaProxyEligibility,
  createMediaCodecProbeCache,
  probeAssetCodec,
  proxyVariantFor,
  resolveProxyVariantRequest,
  scanProjectMedia,
  scanProjectMediaCodecMap,
  shouldPrewarmProxy,
  type AssetCodecFacts,
} from "./mediaCodecMap.js";

// Any real, existing file works as a stand-in ffprobe path — the runner
// passed to probeMediaMetadata is what's actually invoked, mirroring
// packages/lint/src/project.test.ts's hevc_preview_codec pattern (keeps this
// test independent of whether the host actually has ffprobe installed).
const FAKE_FFPROBE_PATH = process.execPath;

function makeRunner(
  codecByPath: Record<
    string,
    | string
    | {
        codecName: string;
        pixFmt?: string;
        tags?: Record<string, string>;
        size?: [number, number];
        bitRate?: string;
        colorTransfer?: string;
      }
  >,
): FfprobeRunner {
  return (_command, args) => {
    const filePath = args[args.length - 1] ?? "";
    const entry = codecByPath[filePath];
    const normalized = typeof entry === "string" ? { codecName: entry } : entry;
    const streams = normalized
      ? [
          {
            codec_type: "video",
            codec_name: normalized.codecName,
            pix_fmt: normalized.pixFmt,
            tags: normalized.tags,
            width: normalized.size?.[0],
            height: normalized.size?.[1],
            bit_rate: normalized.bitRate,
            color_transfer: normalized.colorTransfer,
            color_primaries: normalized.colorTransfer ? "bt2020" : undefined,
          },
        ]
      : [];
    return { status: 0, stdout: JSON.stringify({ streams }), stderr: "" };
  };
}

function countingRunner(runner: FfprobeRunner): {
  runner: FfprobeRunner;
  calls: () => number;
} {
  let calls = 0;
  return {
    runner: (command, args, options) => {
      calls++;
      return runner(command, args, options);
    },
    calls: () => calls,
  };
}

function videoHtml(...srcs: string[]): string {
  const tags = srcs
    .map(
      (src, i) =>
        `<video id="v${i}" class="clip" src="${src}" muted data-start="0" data-duration="5"></video>`,
    )
    .join("\n");
  return `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">${tags}</div></body></html>`;
}

let dirs: string[] = [];

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-media-codec-map-test-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env.HYPERFRAMES_FFPROBE_PATH = FAKE_FFPROBE_PATH;
});

afterEach(() => {
  delete process.env.HYPERFRAMES_FFPROBE_PATH;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("probeAssetCodec", () => {
  it("reports an HEVC asset as browser-hostile with the pinned representative mime", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(videoPath, makeRunner({ [videoPath]: "hevc" }));

    expect(facts).toEqual({
      codecName: "hevc",
      browserHostile: true,
      representativeMime: BROWSER_HOSTILE_CODECS.hevc?.representativeMime,
      hasAlpha: false,
    });
  });

  it("reports an H.264 asset as not browser-hostile", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(videoPath, makeRunner({ [videoPath]: "h264" }));

    expect(facts).toEqual({
      codecName: "h264",
      browserHostile: false,
      representativeMime: null,
      hasAlpha: false,
    });
  });

  it("treats VP9 as conditionally hostile so unsupported browsers can request a proxy", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.webm");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(videoPath, makeRunner({ [videoPath]: "vp9" }));

    expect(facts).toEqual({
      codecName: "vp9",
      browserHostile: true,
      representativeMime: BROWSER_HOSTILE_CODECS.vp9?.representativeMime,
      hasAlpha: false,
    });
  });

  it("reports ProRes as browser-hostile with no representative mime", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mov");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(videoPath, makeRunner({ [videoPath]: "prores" }));

    expect(facts).toEqual({
      codecName: "prores",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: false,
    });
  });

  it("flags an alpha-bearing pix_fmt (ProRes 4444) with hasAlpha", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mov");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(
      videoPath,
      makeRunner({
        [videoPath]: { codecName: "prores", pixFmt: "yuva444p10le" },
      }),
    );

    expect(facts).toEqual({
      codecName: "prores",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: true,
    });
  });

  it("flags a VP9 whose alpha is only in the ALPHA_MODE tag, so it gets the VP8 proxy", async () => {
    const project = tmpProject();
    const videoPath = join(project, "cutout.webm");
    writeFileSync(videoPath, "fake video bytes");

    // What ffprobe prints for a libvpx-vp9 yuva420p encode.
    const facts = await probeAssetCodec(
      videoPath,
      makeRunner({
        [videoPath]: { codecName: "vp9", pixFmt: "yuv420p", tags: { ALPHA_MODE: "1" } },
      }),
    );

    expect(facts?.hasAlpha).toBe(true);
    expect(proxyVariantFor(facts!)).toBe("vp8");
  });

  it("returns null (never throws) when ffprobe is unresolvable", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");
    process.env.HYPERFRAMES_FFPROBE_PATH = join(project, "missing-ffprobe");

    await expect(probeAssetCodec(videoPath)).resolves.toBeNull();
  });

  it("probes again after ffprobe failed instead of caching the failure", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");
    const cache = createMediaCodecProbeCache();
    process.env.HYPERFRAMES_FFPROBE_PATH = join(project, "missing-ffprobe");
    await expect(probeAssetCodec(videoPath, undefined, cache)).resolves.toBeNull();

    const facts = await probeAssetCodec(videoPath, makeRunner({ [videoPath]: "hevc" }), cache);

    expect(facts?.codecName).toBe("hevc");
  });
});

describe("BROWSER_HOSTILE_CODECS representative mimes", () => {
  // Pinned because nulling one is silent and expensive: the runtime skips
  // `canPlayType` when the mime is null (packages/core/src/runtime/mediaProxy.ts,
  // `maybeProxyProactively`) and proxies on EVERY browser, reinstating exactly
  // the transcodes the pre-warm split removed.
  it.each(["hevc", "av1", "vp9"])("keeps a canPlayType probe for %s", (codecName) => {
    expect(typeof BROWSER_HOSTILE_CODECS[codecName]?.representativeMime).toBe("string");
  });

  it("has no representative mime for prores, which is never decodable", () => {
    expect(BROWSER_HOSTILE_CODECS.prores?.representativeMime).toBeNull();
  });
});

describe("shouldPrewarmProxy", () => {
  function facts(codecName: string): AssetCodecFacts {
    return { codecName, browserHostile: true, representativeMime: null, hasAlpha: false };
  }

  it.each(["hevc", "prores", "theora"])(
    "pre-warms %s, which has no cross-platform browser decode",
    (codecName) => {
      expect(shouldPrewarmProxy(facts(codecName))).toBe(true);
    },
  );

  it.each(["vp9", "av1"])(
    "does not pre-warm %s, which every mainstream engine decodes itself",
    (codecName) => {
      expect(shouldPrewarmProxy(facts(codecName))).toBe(false);
    },
  );

  it("does not pre-warm a browser-safe codec", () => {
    expect(
      shouldPrewarmProxy({
        codecName: "h264",
        browserHostile: false,
        representativeMime: null,
        hasAlpha: false,
      }),
    ).toBe(false);
  });

  // `shouldPrewarmProxy` alone cannot catch a missing `Object.hasOwn` guard —
  // `.prewarm === true` is already strict against `Object.prototype.constructor`.
  // The input that misbehaves goes through `codecFactsFor`, which would report
  // an ordinary asset as browser-hostile.
  it("does not treat a codec named after an Object.prototype key as hostile", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(videoPath, makeRunner({ [videoPath]: "constructor" }));

    expect(facts).toEqual({
      codecName: "constructor",
      browserHostile: false,
      representativeMime: null,
      hasAlpha: false,
    });
    expect(shouldPrewarmProxy(facts!)).toBe(false);
  });
});

describe("decideMediaProxyEligibility", () => {
  it("allows browser-hostile video with or without alpha", () => {
    expect(
      decideMediaProxyEligibility({
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      }),
    ).toEqual({ eligible: true });
    expect(
      decideMediaProxyEligibility({
        codecName: "prores",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: true,
      }),
    ).toEqual({ eligible: true });
  });

  it("rejects browser-safe sources even when they carry alpha", () => {
    expect(
      decideMediaProxyEligibility({
        codecName: "vp8",
        browserHostile: false,
        representativeMime: "video/webm",
        hasAlpha: true,
      }),
    ).toEqual({ eligible: false, reason: "browser_safe_codec" });
    expect(
      decideMediaProxyEligibility({
        codecName: "h264",
        browserHostile: false,
        representativeMime: null,
        hasAlpha: false,
      }),
    ).toEqual({ eligible: false, reason: "browser_safe_codec" });
    expect(decideMediaProxyEligibility(null)).toEqual({
      eligible: false,
      reason: "unknown_codec",
    });
  });

  it("proxies an alpha VP9 source to the Chromium-compatible VP8 variant", () => {
    expect(
      decideMediaProxyEligibility({
        codecName: "vp9",
        browserHostile: true,
        representativeMime: 'video/webm; codecs="vp09.00.10.08"',
        hasAlpha: true,
      }),
    ).toEqual({ eligible: true });
  });
});

describe("a lighter copy of a file Chrome can play", () => {
  const playable = {
    codecName: "h264",
    browserHostile: false,
    representativeMime: null,
    hasAlpha: false,
    source: { width: 3840, height: 2160, bitDepth: 8, bitrate: 10_000_000 },
  };

  it("is allowed only for the box it is asked at, and only when the file is heavy there", () => {
    expect(decideMediaProxyEligibility(playable)).toEqual({
      eligible: false,
      reason: "browser_safe_codec",
    });
    expect(decideMediaProxyEligibility(playable, { width: 724, height: 362 })).toEqual({
      eligible: true,
    });
    expect(
      decideMediaProxyEligibility(
        { ...playable, source: { ...playable.source, width: 1920, height: 1080 } },
        { width: 2048, height: 1218 },
      ),
    ).toEqual({ eligible: false, reason: "browser_safe_codec" });
  });

  it("reads the size, bit depth and bitrate off the probe, and keeps them with the codec facts", async () => {
    const project = tmpProject();
    const videoPath = join(project, "cam.mov");
    writeFileSync(videoPath, "fake video bytes");

    const facts = await probeAssetCodec(
      videoPath,
      makeRunner({
        [videoPath]: {
          codecName: "hevc",
          pixFmt: "yuv420p10le",
          size: [3840, 2160],
          bitRate: "60000000",
        },
      }),
    );

    expect(facts?.source).toEqual({ width: 3840, height: 2160, bitDepth: 10, bitrate: 60_000_000 });
  });

  it("scans the sizes of the playable videos too, while the codec map keeps only the hostile ones", async () => {
    const project = tmpProject();
    writeFileSync(join(project, "cam.mp4"), "fake video bytes");
    writeFileSync(join(project, "broll.mov"), "fake video bytes");

    const scan = await scanProjectMedia(project, [{ html: videoHtml("cam.mp4", "broll.mov") }], {
      runner: makeRunner({
        [join(project, "cam.mp4")]: { codecName: "h264", size: [1920, 1080] },
        [join(project, "broll.mov")]: { codecName: "hevc", size: [3840, 2160] },
      }),
    });

    expect(Object.keys(scan.codecMap)).toEqual(["/broll.mov"]);
    expect(Object.keys(scan.sourceFacts).sort()).toEqual(["/broll.mov", "/cam.mp4"]);
    expect(scan.sourceFacts["/cam.mp4"]?.codec).toBe("h264");
    expect(scan.sourceFacts["/broll.mov"]?.codec).toBe("hevc");
  });
});

describe("proxyVariantFor", () => {
  it("uses VP8 for alpha and H.264 otherwise", () => {
    const facts = {
      codecName: "prores",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: true,
    };
    expect(proxyVariantFor(facts)).toBe("vp8");
    expect(proxyVariantFor({ ...facts, hasAlpha: false })).toBe("h264");
  });
});

describe("resolveProxyVariantRequest", () => {
  it("infers the alpha-aware variant for an unlisted runtime rescue", () => {
    const facts = {
      codecName: "prores",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: true,
    };
    expect(resolveProxyVariantRequest("auto", facts)).toBe("vp8");
    expect(resolveProxyVariantRequest("h264", facts)).toBeNull();
  });
});

describe("scanProjectMediaCodecMap", () => {
  it("probes the actual quoted source with mixed literal and escaped percent spelling", async () => {
    const project = tmpProject();
    const videoPath = join(project, "it's 100%.mp4");
    writeFileSync(videoPath, "fake video bytes");
    const html = `<video title="src='fake.mp4'" data-src="lazy.mp4" src="it&#39;s%20100%.mp4"></video>`;
    const map = await scanProjectMediaCodecMap(project, [{ html }], {
      runner: makeRunner({ [videoPath]: "hevc" }),
    });
    expect(Object.keys(map)).toEqual(["/it's 100%.mp4"]);
  });

  it("omits an asset from the map (no throw) when ffprobe is unresolvable", async () => {
    const project = tmpProject();
    writeFileSync(join(project, "clip.mp4"), "fake video bytes");
    process.env.HYPERFRAMES_FFPROBE_PATH = join(project, "missing-ffprobe");

    const map = await scanProjectMediaCodecMap(project, [{ html: videoHtml("clip.mp4") }]);

    expect(map).toEqual({});
  });

  it("keys the map by project-root-relative URL pathnames: decoded, forward-slash, leading-slash", async () => {
    const project = tmpProject();
    mkdirSync(join(project, "assets", "sub"), { recursive: true });
    writeFileSync(join(project, "assets", "sub", "clip.mp4"), "fake video bytes");
    writeFileSync(join(project, "assets", "my clip.mp4"), "fake video bytes");

    const html = videoHtml("assets/sub/clip.mp4", "assets/my%20clip.mp4");
    const map = await scanProjectMediaCodecMap(project, [{ html }], {
      runner: makeRunner({
        [join(project, "assets", "sub", "clip.mp4")]: "hevc",
        [join(project, "assets", "my clip.mp4")]: "h264",
      }),
    });

    expect(Object.keys(map)).toEqual(["/assets/sub/clip.mp4"]);
    expect(map["/assets/sub/clip.mp4"]?.browserHostile).toBe(true);
    expect(map["/assets/my clip.mp4"]).toBeUndefined();
  });

  it("rewrites a sub-composition's ../-traversing src via compSrcPath before resolving (rewriteAssetPath)", async () => {
    const project = tmpProject();
    mkdirSync(join(project, "assets"), { recursive: true });
    mkdirSync(join(project, "compositions"), { recursive: true });
    writeFileSync(join(project, "assets", "clip.mp4"), "fake video bytes");

    const map = await scanProjectMediaCodecMap(
      project,
      [
        {
          html: videoHtml("../assets/clip.mp4"),
          compSrcPath: "compositions/scene.html",
        },
      ],
      { runner: makeRunner({ [join(project, "assets", "clip.mp4")]: "hevc" }) },
    );

    // The key is root-relative (what the served DOM resolves to), not the
    // sub-composition-relative authored src.
    expect(Object.keys(map)).toEqual(["/assets/clip.mp4"]);
    expect(map["/assets/clip.mp4"]?.browserHostile).toBe(true);
  });

  it("caches by path + mtime + size, invalidating same-mtime re-exports and touched files", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");
    const pinnedMtime = new Date(Date.now() - 60_000);
    utimesSync(videoPath, pinnedMtime, pinnedMtime);
    const html = videoHtml("clip.mp4");
    const cache = createMediaCodecProbeCache();
    const probe = countingRunner(makeRunner({ [videoPath]: "hevc" }));

    const first = await scanProjectMediaCodecMap(project, [{ html }], {
      cache,
      runner: probe.runner,
    });
    expect(first["/clip.mp4"]?.codecName).toBe("hevc");
    expect(probe.calls()).toBe(1);

    const second = await scanProjectMediaCodecMap(project, [{ html }], {
      cache,
      runner: probe.runner,
    });
    expect(second["/clip.mp4"]?.codecName).toBe("hevc");
    expect(probe.calls()).toBe(1);

    writeFileSync(videoPath, "larger fake video bytes");
    utimesSync(videoPath, pinnedMtime, pinnedMtime);
    const resized = await scanProjectMediaCodecMap(project, [{ html }], {
      cache,
      runner: probe.runner,
    });
    expect(resized["/clip.mp4"]?.codecName).toBe("hevc");
    expect(probe.calls()).toBe(2);

    const future = new Date(Date.now() + 60_000);
    utimesSync(videoPath, future, future);

    const third = await scanProjectMediaCodecMap(project, [{ html }], {
      cache,
      runner: probe.runner,
    });
    expect(third["/clip.mp4"]?.codecName).toBe("hevc");
    expect(probe.calls()).toBe(3);
  });

  it("bounds the long-lived probe cache while retaining the newest assets", async () => {
    const project = tmpProject();
    const cache = createMediaCodecProbeCache();
    const paths = Array.from({ length: 513 }, (_, index) => `clip-${index}.mp4`);
    const codecByPath: Record<string, string> = {};
    for (const path of paths) {
      const absolutePath = join(project, path);
      writeFileSync(absolutePath, "fake video bytes");
      codecByPath[absolutePath] = "hevc";
    }

    await scanProjectMediaCodecMap(project, [{ html: videoHtml(...paths) }], {
      cache,
      runner: makeRunner(codecByPath),
    });

    expect(cache.size).toBe(512);
    expect(paths.slice(0, 8).some((path) => !cache.has(join(project, path)))).toBe(true);
    expect(cache.has(join(project, "clip-512.mp4"))).toBe(true);
  });
});

describe("HDR video previews through the SDR tone-mapped copy", () => {
  const hlgClip = { codecName: "h264", pixFmt: "yuv420p", colorTransfer: "arib-std-b67" };

  async function probe(entry: Parameters<typeof makeRunner>[0][string], hasFilters: boolean) {
    vi.resetModules();
    vi.doMock("./hdrFilters.js", () => ({ ffmpegHasHdrFilters: async () => hasFilters }));
    vi.doMock("@hyperframes/parsers/ff-binaries", () => ({
      findFfBinary: (name: string) => (name === "ffprobe" ? FAKE_FFPROBE_PATH : "/fake/ffmpeg"),
    }));
    process.env.HYPERFRAMES_FFPROBE_PATH = FAKE_FFPROBE_PATH;
    const fresh = await import("./mediaCodecMap.js");
    const filePath = join(mkdtempSync(join(tmpdir(), "hf-hdr-clip-")), "clip.mp4");
    writeFileSync(filePath, "x");
    return fresh.probeAssetCodec(
      filePath,
      makeRunner({ [filePath]: entry }),
      fresh.createMediaCodecProbeCache(),
    );
  }

  afterEach(() => {
    vi.doUnmock("./hdrFilters.js");
    vi.doUnmock("@hyperframes/parsers/ff-binaries");
    vi.restoreAllMocks();
  });

  it("marks an HLG H.264 clip browser-hostile so it gets the same copy the export uses", async () => {
    const facts = await probe(hlgClip, true);
    expect(facts?.browserHostile).toBe(true);
    expect(decideMediaProxyEligibility(facts)).toEqual({ eligible: true });
  });

  it("treats an HDR clip as not playable whatever its codec, so a browser that decodes HEVC still swaps it", async () => {
    const facts = await probe({ ...hlgClip, codecName: "hevc" }, true);
    expect(facts?.browserHostile).toBe(true);
    expect(facts?.representativeMime).toBeNull();
    const vp9 = await probe({ ...hlgClip, codecName: "vp9" }, true);
    expect(vp9?.representativeMime).toBeNull();
  });

  it("leaves an SDR H.264 clip native", async () => {
    const facts = await probe({ codecName: "h264", pixFmt: "yuv420p" }, true);
    expect(facts?.browserHostile).toBe(false);
  });

  it("plays the clip natively and says why once when ffmpeg has no zscale/tonemap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const facts = await probe(hlgClip, false);
    expect(facts?.browserHostile).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("libzimg");
  });
});
