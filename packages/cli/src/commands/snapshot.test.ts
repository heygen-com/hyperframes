import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const snapshotState = vi.hoisted(() => ({
  openSettledPage: vi.fn(async () => {
    throw new Error("browser capture reached");
  }),
  closeServer: vi.fn(async () => undefined),
}));

vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capture/captureCompositionFrame.js")>()),
  openSettledCompositionPage: snapshotState.openSettledPage,
}));

vi.mock("../utils/staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({
    url: "http://127.0.0.1:1",
    close: snapshotState.closeServer,
  })),
}));

import snapshotCommand, {
  computeSnapshotTimes,
  formatSnapshotTimestamp,
  parseZoomScale,
  requireSnapshotFfmpeg,
  resolveSnapshotVideoClipStart,
  resolveSnapshotVideoFrameTime,
  resolveSnapshotVideoPlaybackRate,
  tailFrameTime,
} from "./snapshot.js";

describe("formatSnapshotTimestamp", () => {
  it.each([
    [1.12, "1.12s"],
    [0.30000000000000004, "0.3s"],
  ])("formats %s without discarding useful precision", (time, expected) => {
    expect(formatSnapshotTimestamp(time)).toBe(expected);
  });
});

// --zoom's crop-region math (selector bbox + padding + clamp, exact region
// form, no-match error) is owned by and tested in
// ../capture/captureCompositionFrame.test.ts alongside its implementation.

describe("tailFrameTime", () => {
  it("backs off ~3% of duration so the final frame isn't the blank exact-end", () => {
    // Verified on the V4 3D artifact: t=8.0 of an 8s clip rendered blank white,
    // t=7.76 rendered the final hero. 8 - 8*0.03 = 7.76.
    expect(tailFrameTime(8)).toBeCloseTo(7.76, 5);
  });

  it("uses a 50ms floor for short clips", () => {
    expect(tailFrameTime(1)).toBeCloseTo(0.95, 5); // 1 - 0.05 (floor beats 3%)
  });

  it("never goes negative", () => {
    expect(tailFrameTime(0)).toBe(0);
  });
});

describe("transparent snapshot capture", () => {
  it("asks Chrome to retain the alpha channel in review PNGs", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain(
      'page.screenshot({ path: framePath, type: "png", omitBackground: true })',
    );
  });

  it("exposes --proxy/--no-proxy and forwards the override to the static server", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain("proxy: {");
    expect(source).toContain("autoProxy: args.proxy as boolean | undefined");
    expect(source).toContain("opts.autoProxy");
  });

  it("resolves and forwards the shared local browser GPU policy", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveLocalBrowserGpuMode");
    expect(source).toContain("browserGpuMode: opts.browserGpuMode");
    expect(source).toContain('"browser-gpu": {');
  });
});

describe("snapshot lint preflight", () => {
  async function runEntryMismatch(candidate: string): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-snapshot-entry-mismatch-"));
    const candidatePath = join(project, candidate);
    mkdirSync(dirname(candidatePath), { recursive: true });
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      candidatePath,
      `<html><body><div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    snapshotState.openSettledPage.mockClear();
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });

    try {
      await expect(
        snapshotCommand.run?.({ args: { dir: project } } as never),
      ).rejects.toMatchObject({
        name: "CliRuntimeError",
      });
      expect(snapshotState.openSettledPage).not.toHaveBeenCalled();
      return lines.join("\n");
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  }

  it("does not suggest a directory for a standalone file that is not index.html", async () => {
    const output = await runEntryMismatch("compositions/card.html");

    expect(output).toContain("compositions/card.html");
    expect(output).not.toContain("hyperframes snapshot <project>/compositions");
    expect(output).toContain("snapshot accepts project directories, not individual HTML files");
  });

  it("suggests the reported index.html directory with the re-rooting caveat", async () => {
    const output = await runEntryMismatch("compositions/index.html");

    expect(output).toContain("hyperframes snapshot <project>/compositions");
    expect(output).toContain("assets are self-contained under that directory");
  });
});

describe("resolveSnapshotVideoFrameTime", () => {
  it("keeps media active at the inclusive clip end and samples its last decodable frame", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 15,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 15,
        sourceDuration: 15,
      }),
    ).toBeCloseTo(15 - 1 / 30, 6);
  });

  it("keeps ordinary in-window media timestamps unchanged", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 7.5,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 7.5,
        sourceDuration: 15,
      }),
    ).toBe(7.5);
  });

  it("does not activate media after the clip end", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 15.001,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 15.001,
        sourceDuration: 15,
      }),
    ).toBeNull();
  });

  it.each([
    {
      name: "before clip start",
      input: {
        globalTime: 4.9,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 0,
        sourceDuration: 10,
      },
      expected: null,
    },
    {
      name: "negative relative time",
      input: {
        globalTime: 5,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: -0.1,
        sourceDuration: 10,
      },
      expected: null,
    },
    {
      name: "unknown source duration",
      input: {
        globalTime: 15,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 0,
      },
      expected: 10 - 1 / 30,
    },
    {
      name: "offset clip inclusive end",
      input: {
        globalTime: 15,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 10,
      },
      expected: 10 - 1 / 30,
    },
    {
      name: "clip end within floating-point tolerance",
      input: {
        globalTime: 15 + 5e-10,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 10,
      },
      expected: 10 - 1 / 30,
    },
  ])("handles $name", ({ input, expected }) => {
    const result = resolveSnapshotVideoFrameTime(input);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected, 6);
  });
});

describe("resolveSnapshotVideoClipStart", () => {
  it("offsets a scene-local video start by its later template host", () => {
    expect(
      resolveSnapshotVideoClipStart({
        authoredStart: 0,
        runtimeResolvedStart: 3,
      }),
    ).toBe(3);
  });

  it("uses the runtime's recursively resolved start for deeply nested media", () => {
    expect(
      resolveSnapshotVideoClipStart({
        authoredStart: 1,
        runtimeResolvedStart: 8,
      }),
    ).toBe(8);
  });

  it("keeps authored starts as a compatibility fallback", () => {
    expect(
      resolveSnapshotVideoClipStart({
        authoredStart: 3,
        runtimeResolvedStart: null,
      }),
    ).toBe(3);
  });
});

describe("resolveSnapshotVideoPlaybackRate", () => {
  it("prefers the authored data-playback-rate over the browser default", () => {
    expect(resolveSnapshotVideoPlaybackRate({ authoredRate: "1.8", defaultRate: 1 })).toBe(1.8);
  });
});

describe("computeSnapshotTimes (FINDING [7]: tail is always captured)", () => {
  it("default frames: last point is the readable tail, never exact duration", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5 });
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(7.76, 5);
    expect(times[times.length - 1]).toBeLessThan(8); // not the blank exact-end
    expect(appendedTail).toBe(false);
  });

  it("single frame samples the midpoint", () => {
    expect(computeSnapshotTimes(8, { frames: 1 }).times).toEqual([4]);
  });

  it("explicit --at: keeps the user's times AND appends an end-of-timeline frame", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 2, 3] });
    expect(times.slice(0, 3)).toEqual([1, 2, 3]);
    expect(times[times.length - 1]).toBeCloseTo(7.76, 5);
    expect(appendedTail).toBe(true);
  });

  it("explicit --at: does not double-add when the user already sampled the tail", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 7.76] });
    expect(times).toEqual([1, 7.76]);
    expect(appendedTail).toBe(false);
  });

  it("explicit --at: a sample at exact duration counts as the tail (no append)", () => {
    const { appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 8] });
    expect(appendedTail).toBe(false);
  });

  it("respects includeEnd:false opt-out for --at", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, {
      frames: 5,
      at: [1, 2],
      includeEnd: false,
    });
    expect(times).toEqual([1, 2]);
    expect(appendedTail).toBe(false);
  });

  it("preserves exact explicit transition timestamps", () => {
    const exactTransition = 3.3666666666666667;
    const { times } = computeSnapshotTimes(8, {
      frames: 5,
      at: [exactTransition],
      includeEnd: false,
    });
    expect(times).toEqual([exactTransition]);
  });
});

describe("parseZoomScale (--zoom-scale)", () => {
  it("defaults to 3 when unset", () => {
    expect(parseZoomScale(undefined)).toBe(3);
  });

  it("honors an explicit scale", () => {
    expect(parseZoomScale("2")).toBe(2);
  });

  it("falls back to the default for invalid or non-positive input", () => {
    expect(parseZoomScale("abc")).toBe(3);
    expect(parseZoomScale("0")).toBe(3);
    expect(parseZoomScale("-1")).toBe(3);
  });
});

describe("requireSnapshotFfmpeg", () => {
  it("rejects video snapshot extraction when FFmpeg is unavailable", () => {
    expect(() => requireSnapshotFfmpeg(undefined)).toThrow(
      /FFmpeg is required to extract video frames for snapshots/,
    );
  });

  it("preserves the resolved FFmpeg executable", () => {
    expect(requireSnapshotFfmpeg("C:\\tools\\ffmpeg.exe")).toBe("C:\\tools\\ffmpeg.exe");
  });
});
