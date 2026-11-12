import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Any host stands in for Windows here: "/share-host/..." plays the part of another computer's share.
const SHARE = "/share-host/";
const touched = vi.hoisted(() => ({ paths: [] as string[] }));
const onShare = (path: string) => resolve(String(path)).startsWith("/share-host/");

vi.mock("@hyperframes/parsers/asset-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/asset-resolution")>();
  return { ...actual, namesAnotherNetworkRoot: (_base: string, target: string) => onShare(target) };
});

for (const fsModule of ["fs", "node:fs"]) {
  vi.doMock(fsModule, async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const existsSync = (path: string) => {
      touched.paths.push(String(path));
      return actual.existsSync(path);
    };
    return { ...actual, existsSync, default: { ...actual, existsSync } };
  });
}

const recordProbe = async (path: string) => {
  touched.paths.push(path);
  return { durationSeconds: 1, isVFR: false };
};
vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...actual,
    extractMediaMetadata: recordProbe,
    probeMediaProfile: async (path: string) => {
      touched.paths.push(path);
      return { hasVideoStream: true, hasAudioStream: true, visualKind: "moving" };
    },
    analyzeKeyframeIntervals: async (path: string) => {
      touched.paths.push(path);
      return { isProblematic: false, maxIntervalSeconds: 0 };
    },
  };
});
vi.mock("../utils/ffprobe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/ffprobe.js")>();
  return { ...actual, extractMediaMetadata: recordProbe, extractAudioMetadata: recordProbe };
});

const { compileForRender } = await import("./htmlCompiler.js");
const { resolveLocalImageSourcePath } = await import("./animatedGifPrep.js");

describe("composition paths on another network root", () => {
  let projectDir: string | undefined;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = undefined;
    touched.paths.length = 0;
  });

  it("are never looked at by the render compile probes", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-network-root-"));
    writeFileSync(join(projectDir, "local.mp4"), "fixture");
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body>
        <div data-composition-id="root" data-width="320" data-height="180" data-duration="1">
          <video id="timed" src="/${SHARE}timed.mp4" data-start="0" data-duration="1"></video>
          <video id="untimed" src="/${SHARE}untimed.mp4" data-start="0"></video>
          <audio id="voice" src="/${SHARE}voice.wav" data-start="0"></audio>
          <img src="/${SHARE}anim.gif">
          <video id="local" src="local.mp4" data-start="0" data-duration="1"></video>
        </div>
        <script src="/${SHARE}gsap/dist/gsap.min.js"></script>
      </body></html>`,
    );

    await compileForRender(projectDir, htmlPath, join(projectDir, "downloads"));
    await new Promise<void>((done) => setTimeout(done, 0));

    expect(touched.paths.filter(onShare)).toEqual([]);
    expect(touched.paths.some((path) => path.endsWith("local.mp4"))).toBe(true);
  });

  it("are never looked at when an image src is resolved", () => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-network-root-img-"));
    const downloadDir = join(projectDir, "downloads");
    expect(
      resolveLocalImageSourcePath(`/${SHARE}anim.gif`, { projectDir, downloadDir }),
    ).toBeNull();
    expect(touched.paths.filter(onShare)).toEqual([]);
  });
});
