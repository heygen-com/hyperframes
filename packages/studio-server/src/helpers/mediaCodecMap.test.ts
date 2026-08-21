import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  scanProjectMediaCodecMap,
} from "./mediaCodecMap.js";

// Any real, existing file works as a stand-in ffprobe path — the runner
// passed to probeMediaMetadata is what's actually invoked, mirroring
// packages/lint/src/project.test.ts's hevc_preview_codec pattern (keeps this
// test independent of whether the host actually has ffprobe installed).
const FAKE_FFPROBE_PATH = process.execPath;

function makeRunner(
  codecByPath: Record<string, string | { codecName: string; pixFmt?: string }>,
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
      representativeMime: BROWSER_HOSTILE_CODECS.hevc,
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
      representativeMime: BROWSER_HOSTILE_CODECS.vp9,
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

  it("returns null (never throws) when ffprobe is unresolvable", async () => {
    const project = tmpProject();
    const videoPath = join(project, "clip.mp4");
    writeFileSync(videoPath, "fake video bytes");
    process.env.HYPERFRAMES_FFPROBE_PATH = join(project, "missing-ffprobe");

    await expect(probeAssetCodec(videoPath)).resolves.toBeNull();
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
