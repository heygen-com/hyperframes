import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "@hyperframes/engine";
import { runCompileStage } from "./render/stages/compileStage.js";
import { runExtractVideosStage } from "./render/stages/extractVideosStage.js";
import { createRenderJob } from "./renderOrchestrator.js";
import { createFileServer } from "./fileServer.js";
import { plan } from "./distributed/plan.js";
import { materializePlanV2Target, planV2, readPlanV2Manifest } from "./distributed/planV2.js";
import { toExternalAssetKey } from "../utils/paths.js";

const tool = vi.hoisted(() => ({ calls: [] as string[], clip: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const recorded = <T extends object>(run: T): T =>
    new Proxy(run, {
      apply(target, thisArg, args: unknown[]) {
        tool.calls.push(JSON.stringify(args.slice(0, 2)));
        return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
      },
    });
  return {
    ...actual,
    spawn: recorded(actual.spawn),
    spawnSync: recorded(actual.spawnSync),
    execFile: recorded(actual.execFile),
    execFileSync: recorded(actual.execFileSync),
  };
});

vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (_url: string, destDir: string) => {
    const path = join(destDir, "remote-clip.mp4");
    copyFileSync(tool.clip, path);
    return path;
  },
}));

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const roots: string[] = [];

beforeAll(() => {
  if (!HAS_FFMPEG) return;
  tool.clip = join(mkdtempSync(join(tmpdir(), "hf-outside-clip-")), "clip.mp4");
  const made = spawnSync("ffmpeg", [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=30", "-t", "1"],
    ...["-pix_fmt", "yuv420p", tool.clip],
  ]);
  expect(made.status).toBe(0);
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
afterAll(() => {
  if (tool.clip) rmSync(resolve(tool.clip, ".."), { recursive: true, force: true });
});

const scene = `<div data-composition-id="scene" data-width="320" data-height="240" data-duration="1"><p>OUTSIDE-SCENE</p></div>`;

function outsideProject(media: boolean) {
  const root = mkdtempSync(join(tmpdir(), "hf-outside-assets-"));
  roots.push(root);
  const projectDir = join(root, "project");
  const outsideDir = join(root, "outside");
  mkdirSync(outsideDir, { recursive: true });
  mkdirSync(join(projectDir, "scenes"), { recursive: true });
  writeFileSync(join(outsideDir, "secret.png"), PNG_1X1);
  copyFileSync(tool.clip, join(outsideDir, "clip.mp4"));
  writeFileSync(join(outsideDir, "scene.html"), scene);
  symlinkSync(join(outsideDir, "secret.png"), join(projectDir, "link.png"));
  const outsideClip = join(outsideDir, "clip.mp4");
  const video = (id: string, src: string) =>
    `<video id="${id}" src="${src}" data-start="0" data-duration="1" muted></video>`;
  const mediaHtml = [
    video("absolute", outsideClip),
    video("fileurl", pathToFileURL(outsideClip).href),
    video("dotdot", "../outside/clip.mp4"),
    video("encoded", "..%2Foutside%2Fclip.mp4"),
    video("remote", "https://media.example.com/clip.mp4"),
    `<audio id="tone" src="../outside/clip.mp4" data-start="0" data-duration="1"></audio>`,
  ].join("");
  writeFileSync(
    join(projectDir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8">
<style>.bg { background-image: url("../outside/secret.png"); }</style></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <img src="../outside/secret.png"><div style="background: url(../outside/secret.png)"></div>
    <img src="link.png">${media ? mediaHtml : ""}
  </div></body></html>`,
  );
  const secretKey = toExternalAssetKey(resolve(projectDir, "../outside/secret.png"));
  return { root, projectDir, outsideDir, secretKey };
}

function symlinkedComposition(link: "scene" | "entry") {
  const { root, projectDir, outsideDir } = outsideProject(false);
  symlinkSync(join(outsideDir, "scene.html"), join(projectDir, "scenes", "a.html"));
  const host = `<!doctype html><html><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <div data-composition-src="scenes/a.html" data-start="0" data-duration="1"></div>
  </div></body></html>`;
  writeFileSync(join(outsideDir, "index.html"), host);
  rmSync(join(projectDir, "index.html"));
  if (link === "entry") symlinkSync(join(outsideDir, "index.html"), join(projectDir, "index.html"));
  else writeFileSync(join(projectDir, "index.html"), host);
  return { root, projectDir };
}

async function statusOf(
  server: { url: string; close: () => void },
  paths: string[],
): Promise<number[]> {
  try {
    return await Promise.all(paths.map(async (path) => (await fetch(server.url + path)).status));
  } finally {
    server.close();
  }
}

async function compileInProcess(projectDir: string, allowOutsideProjectAssets?: boolean) {
  const workDir = join(projectDir, "..", "work");
  mkdirSync(workDir, { recursive: true });
  const warnings: string[] = [];
  const log = { error() {}, info() {}, debug() {}, warn: (line: string) => warnings.push(line) };
  const job = createRenderJob({
    fps: { num: 30, den: 1 },
    quality: "draft",
    allowOutsideProjectAssets,
  });
  const cfg = resolveConfig();
  const result = await runCompileStage({
    ...{ projectDir, workDir, entryFile: "index.html", job, cfg, log },
    ...{ needsAlpha: false, assertNotAborted: () => {} },
  });
  const compiledDir = join(workDir, "compiled");
  const extract = () =>
    runExtractVideosStage({
      ...{ projectDir, compiledDir, job, cfg, log, composition: result.composition },
      ...{ abortSignal: undefined, assertNotAborted: () => {} },
    });
  const serve = () => createFileServer({ projectDir, compiledDir, allowOutsideProjectAssets });
  return { result, compiledDir, extract, serve, warnings };
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };

describe.skipIf(!HAS_FFMPEG)("render servers keep markup inside the project", () => {
  it("in-process: copies, serves and opens nothing from outside by default", async () => {
    const { projectDir, outsideDir, secretKey } = outsideProject(true);
    tool.calls.length = 0;
    const { result, compiledDir, extract, serve, warnings } = await compileInProcess(projectDir);
    const extracted = await extract();

    expect(
      [...result.compiled.externalAssets.keys()].filter((key) => key.startsWith("hf-ext/")),
    ).toEqual([]);
    expect(existsSync(join(compiledDir, "hf-ext"))).toBe(false);
    expect(result.composition.videos.map((video) => video.id)).toEqual(["remote"]);
    expect(result.composition.audios.filter((audio) => audio.id === "tone")).toEqual([]);
    expect(result.composition.images).toEqual([]);
    for (const id of ["absolute", "fileurl", "dotdot", "encoded", "tone"]) {
      expect(warnings.some((line) => line.includes(`"${id}" source is missing`))).toBe(true);
    }
    expect(extracted.extractionResult?.extracted.map((frames) => frames.videoId)).toEqual([
      "remote",
    ]);
    expect(tool.calls.filter((call) => call.includes(outsideDir))).toEqual([]);
    expect(
      await statusOf(await serve(), [`/${secretKey}`, "/outside/secret.png", "/link.png"]),
    ).toEqual([404, 404, 404]);
  });

  it("Plan v2: publishes and opens nothing from outside by default", async () => {
    const { root, projectDir, outsideDir, secretKey } = outsideProject(true);
    const planDir = join(root, "v2");
    tool.calls.length = 0;
    await planV2(projectDir, config, planDir);

    const artifacts = readPlanV2Manifest(planDir).artifacts;
    expect(artifacts.filter((artifact) => artifact.path.includes("hf-ext"))).toEqual([]);
    const digests = artifacts.map((artifact) => artifact.sha256);
    expect(digests).not.toContain(sha256(PNG_1X1));
    expect(digests).toContain(sha256(readFileSync(tool.clip)));
    expect(tool.calls.filter((call) => call.includes(outsideDir))).toEqual([]);

    const chunkDir = join(root, "chunk");
    materializePlanV2Target(planDir, { role: "chunk", chunkIndex: 0 }, chunkDir);
    const compiledDir = join(chunkDir, "compiled");
    const server = await createFileServer({ projectDir: compiledDir, compiledDir });
    expect(await statusOf(server, [`/${secretKey}`, "/outside/secret.png", "/link.png"])).toEqual([
      404, 404, 404,
    ]);
  });

  it.each(["scene", "entry"] as const)(
    "refuses a symlinked %s that leads outside",
    async (link) => {
      const { root, projectDir } = symlinkedComposition(link);
      await expect(compileInProcess(projectDir)).rejects.toThrow(/outside the project folder/);
      await expect(planV2(projectDir, config, join(root, "v2"))).rejects.toThrow(
        /outside the project folder/,
      );
    },
  );

  it("trusted local renders still import outside files", async () => {
    const { root, projectDir, secretKey } = outsideProject(false);
    const { compiledDir, serve } = await compileInProcess(projectDir, true);
    expect(existsSync(join(compiledDir, secretKey))).toBe(true);
    expect(await statusOf(await serve(), [`/${secretKey}`, "/link.png"])).toEqual([200, 200]);

    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir, { allowOutsideProjectAssets: true });
    expect(existsSync(join(planDir, "compiled", secretKey))).toBe(true);
    expect(existsSync(join(planDir, "compiled", "link.png"))).toBe(true);

    const linked = symlinkedComposition("scene");
    const { result } = await compileInProcess(linked.projectDir, true);
    expect(result.compiled.html).toContain("OUTSIDE-SCENE");
  });
});
