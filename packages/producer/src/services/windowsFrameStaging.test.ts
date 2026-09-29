import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";
import { materializeExtractedFramesForCompiledDir } from "./render/shared.js";

const staging = vi.hoisted((): { requestedCopy?: boolean } => ({}));
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
}));
vi.mock("./render/stages/compileStage.js", () => ({
  runCompileStage: async () => ({
    compiled: { html: "<div></div>" },
    composition: { width: 320, height: 180, duration: 1, videos: [], images: [], audios: [] },
    deviceScaleFactor: 1,
    outputWidth: 320,
    outputHeight: 180,
    compileOnlyMs: 0,
    forceScreenshot: true,
  }),
}));
vi.mock("./render/stages/probeStage.js", () => ({
  runProbeStage: async ({ compiled }: { compiled: object }) => ({
    compiled,
    fileServer: null,
    probeSession: null,
    lastBrowserConsole: [],
    duration: 1,
    totalFrames: 30,
    browserProbeMs: 0,
  }),
}));
vi.mock("./render/stages/extractVideosStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/extractVideosStage.js")>()),
  runExtractVideosStage: async ({ materializeSymlinks }: { materializeSymlinks?: boolean }) => {
    staging.requestedCopy = materializeSymlinks;
    throw new Error("staging reached");
  },
}));

const dirs: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hf-windows-staging-"));
  dirs.push(root);
  const source = join(root, "cache");
  mkdirSync(source);
  const frame = join(source, "frame_000001.jpg");
  writeFileSync(frame, "frame bytes");
  return {
    root,
    source,
    compiled: join(root, "compiled"),
    extracted: { videoId: "clip", outputDir: source, framePaths: new Map([[0, frame]]) },
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("the actual local Windows renderer does not request eager frame copies", async () => {
  const { root } = fixture();
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    await expect(executeRenderJob(job, root, join(root, "output.mp4"))).rejects.toThrow(
      "staging reached",
    );
    expect(staging.requestedCopy).not.toBe(true);
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});

describe.skipIf(process.platform !== "win32")("real Windows frame staging", () => {
  it("uses a real junction after a symlink privilege denial without copying frames", () => {
    const { source, compiled, extracted } = fixture();
    const attempts: Array<string | undefined> = [];
    materializeExtractedFramesForCompiledDir([extracted], compiled, {
      fileSystem: {
        existsSync,
        mkdirSync,
        rmSync,
        symlinkSync: (target, path, type) => {
          attempts.push(type);
          if (attempts.length === 1)
            throw Object.assign(new Error("symlink denied"), { code: "EPERM" });
          symlinkSync(target, path, type);
        },
        cpSync: () => {
          throw new Error("junction-capable local staging must not copy");
        },
      },
    });
    expect(attempts).toEqual(["dir", "junction"]);
    expect(lstatSync(extracted.outputDir).isSymbolicLink()).toBe(true);
    writeFileSync(join(source, "frame_000001.jpg"), "updated cache bytes");
    expect(readFileSync(extracted.framePaths.get(0)!, "utf8")).toBe("updated cache bytes");
    rmSync(extracted.outputDir, { recursive: true });
    expect(readFileSync(join(source, "frame_000001.jpg"), "utf8")).toBe("updated cache bytes");
  });
});

it("distributed materialization stays physically self-contained after cache removal", () => {
  const { source, compiled, extracted } = fixture();
  materializeExtractedFramesForCompiledDir([extracted], compiled, { materializeSymlinks: true });
  expect(lstatSync(extracted.outputDir).isSymbolicLink()).toBe(false);
  rmSync(source, { recursive: true });
  expect(readFileSync(extracted.framePaths.get(0)!, "utf8")).toBe("frame bytes");
});

describe("Windows link fallbacks", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  beforeEach(() => Object.defineProperty(process, "platform", { value: "win32" }));
  afterEach(() => Object.defineProperty(process, "platform", platform));

  it.each(["EPERM", "EACCES", "UNKNOWN", "EINVAL", "ENOSYS", "EOPNOTSUPP", "ENOTSUP"])(
    "copies only after the junction is rejected with %s",
    (code) => {
      const { compiled, extracted } = fixture();
      const attempts: Array<string | undefined> = [];
      materializeExtractedFramesForCompiledDir([extracted], compiled, {
        fileSystem: {
          existsSync,
          mkdirSync,
          cpSync,
          rmSync,
          symlinkSync: (_target, _path, type) => {
            attempts.push(type);
            throw Object.assign(new Error("link unavailable"), {
              code: type === "junction" ? code : "EPERM",
            });
          },
        },
      });
      expect(attempts).toEqual(["dir", "junction"]);
      expect(lstatSync(extracted.outputDir).isSymbolicLink()).toBe(false);
      expect(readFileSync(extracted.framePaths.get(0)!, "utf8")).toBe("frame bytes");
    },
  );

  it("does not hide a disk failure from the junction attempt", () => {
    const { compiled, extracted } = fixture();
    const copy = vi.fn();
    expect(() =>
      materializeExtractedFramesForCompiledDir([extracted], compiled, {
        fileSystem: {
          existsSync,
          mkdirSync,
          rmSync,
          cpSync: copy,
          symlinkSync: (_target, _path, type) => {
            throw Object.assign(new Error(type === "junction" ? "disk full" : "denied"), {
              code: type === "junction" ? "ENOSPC" : "EPERM",
            });
          },
        },
      }),
    ).toThrow("disk full");
    expect(copy).not.toHaveBeenCalled();
  });
});
