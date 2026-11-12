import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "@hyperframes/engine";
import { runCompileStage } from "./render/stages/compileStage.js";
import { createRenderJob } from "./renderOrchestrator.js";
import { createFileServer } from "./fileServer.js";
import { plan } from "./distributed/plan.js";
import { materializePlanV2Target, planV2, readPlanV2Manifest } from "./distributed/planV2.js";
import { toExternalAssetKey } from "../utils/paths.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FAKE_CLIP = Buffer.from("not a video, and never opened");
const quietLog = { error() {}, warn() {}, info() {}, debug() {} };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function outsideProject(media: boolean) {
  const root = mkdtempSync(join(tmpdir(), "hf-outside-assets-"));
  roots.push(root);
  const projectDir = join(root, "project");
  mkdirSync(join(root, "outside"), { recursive: true });
  mkdirSync(projectDir);
  writeFileSync(join(root, "outside", "secret.png"), PNG_1X1);
  writeFileSync(join(root, "outside", "clip.mp4"), FAKE_CLIP);
  symlinkSync(join(root, "outside", "secret.png"), join(projectDir, "link.png"));
  const clip = `<video id="clip" src="${pathToFileURL(join(root, "outside", "clip.mp4"))}" data-start="0" data-duration="1" muted></video>
    <audio id="tone" src="../outside/clip.mp4" data-start="0" data-duration="1"></audio>`;
  writeFileSync(
    join(projectDir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8">
<style>.bg { background-image: url("../outside/secret.png"); }</style></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <img src="../outside/secret.png"><div style="background: url(../outside/secret.png)"></div>
    <img src="link.png">${media ? clip : ""}
  </div></body></html>`,
  );
  const secretKey = toExternalAssetKey(resolve(projectDir, "../outside/secret.png"));
  return { root, projectDir, secretKey };
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
  const job = createRenderJob({
    fps: { num: 30, den: 1 },
    quality: "draft",
    allowOutsideProjectAssets,
  });
  const result = await runCompileStage({
    projectDir,
    workDir,
    entryFile: "index.html",
    job,
    cfg: resolveConfig(),
    needsAlpha: false,
    log: quietLog,
    assertNotAborted: () => {},
  });
  const server = await createFileServer({
    projectDir,
    compiledDir: join(workDir, "compiled"),
    allowOutsideProjectAssets,
  });
  return { result, compiledDir: join(workDir, "compiled"), server };
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };

describe("render servers keep markup inside the project", () => {
  it.skipIf(!HAS_FFMPEG)(
    "in-process: copies and serves nothing from outside by default",
    async () => {
      const { projectDir, secretKey } = outsideProject(true);
      const { result, compiledDir, server } = await compileInProcess(projectDir);

      expect(
        [...result.compiled.externalAssets.keys()].filter((key) => key.startsWith("hf-ext/")),
      ).toEqual([]);
      expect(existsSync(join(compiledDir, "hf-ext"))).toBe(false);
      expect(result.composition.videos).toEqual([]);
      expect(result.composition.audios).toEqual([]);
      expect(result.composition.images.map((image) => image.src)).toEqual([]);
      expect(await statusOf(server, [`/${secretKey}`, "/outside/secret.png", "/link.png"])).toEqual(
        [404, 404, 404],
      );
    },
  );

  it.skipIf(!HAS_FFMPEG)("Plan v2: publishes nothing from outside by default", async () => {
    const { root, projectDir, secretKey } = outsideProject(true);
    const planDir = join(root, "v2");
    await planV2(projectDir, config, planDir);

    const artifacts = readPlanV2Manifest(planDir).artifacts;
    expect(artifacts.filter((artifact) => artifact.path.includes("hf-ext"))).toEqual([]);
    expect(artifacts.map((artifact) => artifact.sha256)).not.toContain(sha256(PNG_1X1));
    expect(artifacts.map((artifact) => artifact.sha256)).not.toContain(sha256(FAKE_CLIP));

    const chunkDir = join(root, "chunk");
    materializePlanV2Target(planDir, { role: "chunk", chunkIndex: 0 }, chunkDir);
    const compiledDir = join(chunkDir, "compiled");
    const server = await createFileServer({ projectDir: compiledDir, compiledDir });
    expect(await statusOf(server, [`/${secretKey}`, "/outside/secret.png", "/link.png"])).toEqual([
      404, 404, 404,
    ]);
  });

  it.skipIf(!HAS_FFMPEG)("trusted local renders still import outside files", async () => {
    const { root, projectDir, secretKey } = outsideProject(false);
    const { compiledDir, server } = await compileInProcess(projectDir, true);
    expect(existsSync(join(compiledDir, secretKey))).toBe(true);
    expect(await statusOf(server, [`/${secretKey}`, "/link.png"])).toEqual([200, 200]);

    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir, { allowOutsideProjectAssets: true });
    expect(existsSync(join(planDir, "compiled", secretKey))).toBe(true);
    expect(existsSync(join(planDir, "compiled", "link.png"))).toBe(true);
  });
});
