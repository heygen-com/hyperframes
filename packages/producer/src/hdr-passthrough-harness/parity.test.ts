import { describe, expect, it } from "bun:test";
import {
  buildFramemd5Args,
  buildMetricsArgs,
  buildRenderArgs,
  buildRenderEnv,
  checkExpectedPath,
  checkSingleOutput,
  defaultCliCommand,
  fixtureExpectReason,
  selectProjects,
} from "./parity.js";

const renderOptions = {
  projectDir: "/fx/captions",
  outputPath: "/out/off.mp4",
  fps: 30,
  workers: 1,
  quality: "standard" as const,
  extraArgs: ["--crf", "18"],
};

describe("buildRenderArgs", () => {
  it("differs between the two sides only by the passthrough flag", () => {
    const off = buildRenderArgs({ ...renderOptions, side: "off" });
    const on = buildRenderArgs({ ...renderOptions, side: "on" });
    expect(off).toEqual([
      "render",
      "/fx/captions",
      "--output",
      "/out/off.mp4",
      "--fps",
      "30",
      "--workers",
      "1",
      "--quality",
      "standard",
      "--crf",
      "18",
    ]);
    expect(on.filter((arg) => arg !== "--experimental-hdr-passthrough")).toEqual(off);
    expect(off).not.toContain("--experimental-hdr-passthrough");
  });
});

describe("buildRenderEnv", () => {
  it("never leaks the passthrough env var into a render", () => {
    const env = buildRenderEnv({ HF_EXPERIMENTAL_HDR_PASSTHROUGH: "true", PATH: "/bin" });
    expect(env.HF_EXPERIMENTAL_HDR_PASSTHROUGH).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });
});

describe("defaultCliCommand", () => {
  it("runs the worktree CLI from source", () => {
    expect(defaultCliCommand("/repo")).toEqual([
      "/repo/node_modules/.bin/tsx",
      "/repo/packages/cli/src/cli.ts",
    ]);
  });
});

describe("buildMetricsArgs", () => {
  it("computes PSNR and SSIM on 10-bit planes of both inputs", () => {
    const args = buildMetricsArgs("/a.mp4", "/b.mp4", "psnr.log", "ssim.log");
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph.match(/format=yuv420p10le/g)).toHaveLength(2);
    expect(graph).toContain("psnr=stats_file=psnr.log");
    expect(graph).toContain("ssim=stats_file=ssim.log");
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 4)).toEqual([
      "-i",
      "/a.mp4",
      "-i",
      "/b.mp4",
    ]);
  });
});

describe("checkExpectedPath", () => {
  it("requires a completed passthrough on the positive fixture", () => {
    expect(checkExpectedPath({ kind: "passthrough" }, "passthrough").ok).toBe(true);
    expect(
      checkExpectedPath({ kind: "passthrough_error", detail: "not implemented" }, "passthrough").ok,
    ).toBe(false);
  });

  it("requires a fallback, optionally with a reason, on the negative fixture", () => {
    const transform = { kind: "ineligible", reason: "transform_or_filter" } as const;
    expect(checkExpectedPath(transform, "fallback", "transform_or_filter").ok).toBe(true);
    expect(checkExpectedPath(transform, "fallback", "opacity").ok).toBe(false);
    expect(checkExpectedPath({ kind: "passthrough" }, "fallback").ok).toBe(false);
  });
});

describe("checkSingleOutput", () => {
  it("fails a render that exited non-zero without probing", () => {
    const results = checkSingleOutput(
      {
        side: "off",
        outputPath: "/out/off.mp4",
        logPath: "/out/off.log",
        wallMs: 1,
        jobMs: null,
        exitCode: 1,
        path: { kind: "unknown" },
        probe: null,
      },
      { fps: 30, transfer: "hlg", durationSec: 20 },
    );
    expect(results).toEqual([{ name: "off.render", ok: false, detail: "exit 1" }]);
  });
});

describe("fixtureExpectReason", () => {
  it("uses the manifest reason, defaults old fallback manifests to not_full_canvas", () => {
    expect(fixtureExpectReason({ expect: "passthrough" })).toBeUndefined();
    expect(fixtureExpectReason({ expect: "passthrough", expectReason: "canvas" })).toBeUndefined();
    expect(fixtureExpectReason({ expect: "fallback" })).toBe("not_full_canvas");
    expect(fixtureExpectReason({ expect: "fallback", expectReason: "clip_or_mask" })).toBe(
      "clip_or_mask",
    );
  });
});

describe("selectProjects", () => {
  const projects = [{ name: "captions" }, { name: "transformed" }, { name: "ineligible-canvas" }];

  it("keeps every project without a filter and manifest order with one", () => {
    expect(selectProjects(projects, undefined)).toEqual(projects);
    expect(selectProjects(projects, "ineligible-canvas, captions").map((p) => p.name)).toEqual([
      "captions",
      "ineligible-canvas",
    ]);
  });

  it("rejects unknown names", () => {
    expect(() => selectProjects(projects, "captions,nope")).toThrow("nope");
  });
});

describe("buildFramemd5Args", () => {
  it("hashes every decoded frame of the first video stream", () => {
    const args = buildFramemd5Args("/out/on.mp4");
    expect(args).toEqual([
      "-hide_banner",
      "-v",
      "error",
      "-i",
      "/out/on.mp4",
      "-map",
      "0:v:0",
      "-f",
      "framemd5",
      "-",
    ]);
  });
});

describe("buildRenderArgs with a rational rate", () => {
  it("passes the rate to the CLI as given", () => {
    const args = buildRenderArgs({ ...renderOptions, side: "on", fps: "30000/1001" });
    expect(args[args.indexOf("--fps") + 1]).toBe("30000/1001");
  });
});
