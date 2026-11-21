import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "@hyperframes/engine";
import { runCompileStage } from "./render/stages/compileStage.js";
import {
  appendVideoAudioFromProbe,
  runExtractVideosStage,
} from "./render/stages/extractVideosStage.js";
import { runAudioStage } from "./render/stages/audioStage.js";
import { collectRenderMedia } from "./renderMediaCollector.js";
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

// Runs once, right after the named file is read: lets a test change the file between the pre-flight's read and the reader's.
const afterRead = vi.hoisted(() => ({ path: "", run: () => {} }));

vi.mock("@hyperframes/parsers/asset-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/asset-resolution")>();
  return {
    ...actual,
    readProjectFile: (path: string) => {
      const read = actual.readProjectFile(path);
      if (afterRead.path === path) {
        afterRead.path = "";
        afterRead.run();
      }
      return read;
    },
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
    video("data-scheme", "data:x/../../outside/clip.mp4"),
    video("blob-scheme", "BLOB:a/../../outside/clip.mp4"),
    `<audio id="tone" src="../outside/clip.mp4" data-start="0" data-duration="1"></audio>`,
    `<audio id="tone-scheme" src="Data:x/../../outside/clip.mp4" data-start="0" data-duration="1"></audio>`,
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

async function compileInProcess(
  projectDir: string,
  allowOutsideProjectAssets?: boolean,
  includeOutsideScripts?: boolean,
) {
  const workDir = join(projectDir, "..", "work");
  mkdirSync(workDir, { recursive: true });
  const warnings: string[] = [];
  const log = { error() {}, info() {}, debug() {}, warn: (line: string) => warnings.push(line) };
  const job = createRenderJob({
    fps: { num: 30, den: 1 },
    quality: "draft",
    allowOutsideProjectAssets,
    includeOutsideScripts,
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
  const serve = () =>
    createFileServer({ projectDir, compiledDir, allowOutsideProjectAssets, includeOutsideScripts });
  return { result, compiledDir, extract, serve, warnings };
}

function privateOutsideProject() {
  const root = mkdtempSync(join(tmpdir(), "hf-private-outside-"));
  roots.push(root);
  const projectDir = join(root, "work", "project");
  const [ssh, shared] = [join(root, ".ssh"), join(root, "work", "shared")];
  for (const dir of [projectDir, ssh, shared]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(ssh, "id_key"), "PRIVATE");
  writeFileSync(join(ssh, "pic.png"), PNG_1X1);
  copyFileSync(tool.clip, join(ssh, "clip.mp4"));
  const gif = ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=16x16:rate=10", "-t", "0.3"];
  expect(spawnSync("ffmpeg", [...gif, join(ssh, "anim.gif")]).status).toBe(0);
  writeFileSync(join(ssh, "scene.html"), scene);
  writeFileSync(join(shared, "logo.png"), PNG_1X1);
  writeFileSync(join(shared, "notes.txt"), "notes");
  symlinkSync(join(ssh, "pic.png"), join(projectDir, "link.png"));
  symlinkSync(join(shared, "logo.png"), join(projectDir, "keep.png"));
  symlinkSync(join(ssh, "id_key"), join(projectDir, "brand.ttf"));
  symlinkSync(join(shared, "notes.txt"), join(projectDir, "notes.ttf"));
  const pic = join(ssh, "pic.png");
  const video = (id: string, src: string) =>
    `<video id="${id}" src="${src}" data-start="0" data-duration="1" muted></video>`;
  writeFileSync(
    join(projectDir, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="../../.ssh/id_key">
<style>.bg { background-image: url("../../.ssh/pic.png"); }
@font-face { font-family: B; src: url("brand.ttf"); } @font-face { font-family: N; src: url("notes.ttf"); }</style></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <img src="../../.ssh/pic.png"><img src="${pic}"><img src="${pathToFileURL(pic).href}">
    <img src="..%2F..%2F.ssh%2Fpic.png"><div style="background: url(${pic})"></div>
    <a href="../../.ssh/id_key">key</a><a href="../shared/notes.txt">notes</a>
    <img src="../shared/logo.png"><img src="../../.ssh/anim.gif">${video("dotdot", "../../.ssh/clip.mp4")}
    ${video("fileurl", pathToFileURL(join(ssh, "clip.mp4")).href)}
  </div></body></html>`,
  );
  const key = (path: string) => toExternalAssetKey(resolve(path));
  return {
    root,
    projectDir,
    privateKeys: [key(pic), key(join(ssh, "id_key"))],
    logo: key(join(shared, "logo.png")),
  };
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
const FFMPEG_WORK = { timeout: 30_000 };

describe.skipIf(!HAS_FFMPEG)("render servers keep markup inside the project", FFMPEG_WORK, () => {
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
    expect(result.composition.audios.filter((audio) => audio.id.startsWith("tone"))).toEqual([]);
    expect(result.composition.images).toEqual([]);
    const dropped = ["absolute", "fileurl", "dotdot", "encoded", "data-scheme", "blob-scheme"];
    for (const id of [...dropped, "tone", "tone-scheme"]) {
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

  it("plans copy nothing through top-level links whose names start with two dots", async () => {
    const { root, projectDir, outsideDir } = outsideProject(false);
    symlinkSync(join(outsideDir, "secret.png"), join(projectDir, "..x"));
    symlinkSync(join(outsideDir, "scene.html"), join(projectDir, "..."));
    symlinkSync(outsideDir, join(projectDir, "..dir"), "dir");
    const outsideBytes = readdirSync(outsideDir).map((name) =>
      sha256(readFileSync(join(outsideDir, name))),
    );

    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir);
    const planned = filesUnder(join(planDir, "compiled"));
    expect(planned.filter((file) => file.startsWith(".."))).toEqual([]);
    for (const file of planned) {
      expect(outsideBytes).not.toContain(sha256(readFileSync(join(planDir, "compiled", file))));
    }

    await planV2(projectDir, config, join(root, "v2"));
    const artifacts = readPlanV2Manifest(join(root, "v2")).artifacts;
    expect(artifacts.filter((artifact) => outsideBytes.includes(artifact.sha256))).toEqual([]);
  });

  it("plans still copy an ordinary project file whose name starts with two dots", async () => {
    const { root, projectDir } = outsideProject(false);
    writeFileSync(join(projectDir, "..x"), "IN-PROJECT");
    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir);
    expect(readFileSync(join(planDir, "compiled", "..x"), "utf-8")).toBe("IN-PROJECT");
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

  it("trusted local renders leave out private and non-media files outside the project", async () => {
    const { root, projectDir, privateKeys, logo } = privateOutsideProject();
    tool.calls.length = 0;
    const { result, compiledDir, serve, warnings } = await compileInProcess(projectDir, true);

    expect(filesUnder(compiledDir).sort()).toEqual([logo, "index.html"]);
    expect(result.composition.videos).toEqual([]);
    expect(tool.calls.filter((call) => call.includes(".ssh") && !call.includes("ffprobe"))).toEqual(
      [],
    );
    const warned = warnings.join("\n");
    const references = ["id_key", "pic.png", "clip.mp4", "anim.gif"].map((f) => `../../.ssh/${f}`);
    for (const reference of references) {
      expect(warned).toContain(
        `index.html references ${reference}, which is outside the project in a private location; it was left out of the render.`,
      );
    }
    expect(warned).toMatch(
      /Media "fileurl" references file:.*\.ssh\/clip\.mp4, which is outside the project in a private/,
    );
    expect(warned).toContain(
      "../shared/notes.txt, which is outside the project and is not an image",
    );
    expect(warned).toMatch(
      /brand\.ttf references .*\.ssh\/id_key, which is outside the project in a private/,
    );
    expect(warned).toMatch(
      /notes\.ttf references .*notes\.txt, which is outside the project and is not an image/,
    );
    const compiledHtml = readFileSync(join(compiledDir, "index.html"), "utf-8");
    expect(compiledHtml).not.toContain(Buffer.from("PRIVATE").toString("base64"));
    expect(compiledHtml).not.toContain(Buffer.from("notes").toString("base64"));
    expect(compiledHtml).toContain('url("brand.ttf")');
    expect(
      await statusOf(await serve(), [
        ...privateKeys.map((k) => `/${k}`),
        "/link.png",
        `/${logo}`,
        "/keep.png",
        "/brand.ttf",
      ]),
    ).toEqual([404, 404, 404, 200, 200, 404]);

    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir, { allowOutsideProjectAssets: true });
    const planned = filesUnder(join(planDir, "compiled"));
    expect(planned.filter((file) => /\.ssh|notes|link\.png|brand\.ttf/.test(file))).toEqual([]);
    expect(planned).toEqual(expect.arrayContaining([logo, "keep.png"]));
  });

  it("trusted local renders refuse a linked composition in a private location", async () => {
    const { root, projectDir } = privateOutsideProject();
    mkdirSync(join(projectDir, "scenes"));
    symlinkSync(join(root, ".ssh", "scene.html"), join(projectDir, "scenes", "a.html"));
    const host = `<div data-composition-src="scenes/a.html" data-start="0" data-duration="1"></div>`;
    const html = readFileSync(join(projectDir, "index.html"), "utf-8").replace(
      "</div></body>",
      `${host}</div></body>`,
    );
    writeFileSync(join(projectDir, "index.html"), html);
    await expect(compileInProcess(projectDir, true)).rejects.toThrow(
      /outside the project in a private location/,
    );
  });

  it("trusted local renders still import outside files", async () => {
    const { root, projectDir, secretKey } = outsideProject(false);
    const { compiledDir, serve } = await compileInProcess(projectDir, true);
    expect(existsSync(join(compiledDir, secretKey))).toBe(true);
    expect(await statusOf(await serve(), [`/${secretKey}`, "/link.png"])).toEqual([200, 200]);

    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir, { allowOutsideProjectAssets: true });
    expect(existsSync(join(planDir, "compiled", secretKey))).toBe(true);
    expect(existsSync(join(planDir, "compiled", "link.png"))).toBe(true);
  });

  it.each(["scene", "entry"] as const)(
    "trusted local renders refuse a symlinked %s outside the project unless told to run it",
    async (link) => {
      const { root, projectDir } = symlinkedComposition(link);
      const needsFlag =
        /outside the project, and any scripts in it would run; move it into the project, or pass --include-outside-files/;
      await expect(compileInProcess(projectDir, true)).rejects.toThrow(needsFlag);
      const planDir = join(root, "plan");
      await expect(
        plan(projectDir, config, planDir, { allowOutsideProjectAssets: true }),
      ).rejects.toThrow(needsFlag);

      const { result } = await compileInProcess(projectDir, true, true);
      expect(result.compiled.html).toContain("OUTSIDE-SCENE");
    },
  );

  it("trusted local renders refuse a scene swapped for an outside link after the pre-flight", async () => {
    const { root, projectDir } = symlinkedComposition("scene");
    const scenePath = join(projectDir, "scenes", "a.html");
    rmSync(scenePath);
    writeFileSync(scenePath, scene.replace("OUTSIDE-SCENE", "INSIDE-SCENE"));
    afterRead.path = scenePath;
    afterRead.run = () => {
      rmSync(scenePath);
      symlinkSync(join(root, "outside", "scene.html"), scenePath);
    };
    await expect(compileInProcess(projectDir, true)).rejects.toThrow(
      /scenes\/a\.html: it is outside the project, and any scripts in it would run/,
    );
    expect(afterRead.path).toBe("");
  });
});

function outsideScriptsProject() {
  const { root, projectDir, outsideDir, secretKey } = outsideProject(false);
  writeFileSync(join(outsideDir, "tool.js"), "window.OUTSIDE_TOOL = 1;");
  writeFileSync(join(outsideDir, "tool.mjs"), "export const OUTSIDE_TOOL = 1;");
  writeFileSync(join(outsideDir, "look.css"), ".x { color: red; }");
  symlinkSync(join(outsideDir, "tool.mjs"), join(projectDir, "linked.mjs"));
  const html = readFileSync(join(projectDir, "index.html"), "utf-8").replace(
    "</head>",
    `<link rel="stylesheet" href="../outside/look.css"><script src="../outside/tool.js"></script></head>`,
  );
  writeFileSync(join(projectDir, "index.html"), html);
  const key = (file: string) => toExternalAssetKey(join(outsideDir, file));
  return { root, projectDir, secretKey, tool: key("tool.js"), css: key("look.css") };
}

describe.skipIf(!HAS_FFMPEG)("outside scripts in a trusted local render", FFMPEG_WORK, () => {
  it("are left out with a warning naming the flag, while media and CSS still come in", async () => {
    const { root, projectDir, secretKey, tool, css } = outsideScriptsProject();
    const { result, compiledDir, serve, warnings } = await compileInProcess(projectDir, true);

    expect(filesUnder(compiledDir).sort()).toEqual([css, secretKey, "index.html"].sort());
    expect(result.compiled.html).toContain('src="../outside/tool.js"');
    expect(warnings.join("\n")).toContain(
      "index.html references ../outside/tool.js, which is a script outside the project; it was left out of the render. Move it into the project, or pass --include-outside-files to hyperframes render, to run it.",
    );
    expect(await statusOf(await serve(), ["/linked.mjs", "/link.png"])).toEqual([404, 200]);

    const planDir = join(root, "plan");
    await plan(projectDir, config, planDir, { allowOutsideProjectAssets: true });
    const planned = filesUnder(join(planDir, "compiled"));
    expect(planned).not.toContain(tool);
    expect(planned).not.toContain("linked.mjs");
    expect(planned).toEqual(expect.arrayContaining([css, secretKey, "link.png"]));
  });

  it("come in with --include-outside-files", async () => {
    const { root, projectDir, tool } = outsideScriptsProject();
    const { compiledDir, serve, warnings } = await compileInProcess(projectDir, true, true);

    expect(existsSync(join(compiledDir, tool))).toBe(true);
    expect(warnings.join("\n")).not.toContain("script outside the project");
    expect(await statusOf(await serve(), [`/${tool}`, "/linked.mjs"])).toEqual([200, 200]);

    const planDir = join(root, "plan");
    const included = { allowOutsideProjectAssets: true, includeOutsideScripts: true };
    await plan(projectDir, config, planDir, included);
    expect(filesUnder(join(planDir, "compiled"))).toEqual(
      expect.arrayContaining([tool, "linked.mjs"]),
    );
  });
});

// These sources skip the earlier filters on purpose: each reader must refuse them on its own.
describe.skipIf(!HAS_FFMPEG)("render readers open nothing outside the project", () => {
  const escaping = (file: string) => [
    `data:x/../../outside/${file}`,
    `BLOB:a/../../outside/${file}`,
  ];
  const videos = escaping("clip.mp4")
    .map(
      (src, i) =>
        `<video id="v${i}" src="${src}" data-start="0" data-duration="1" data-has-audio="true"></video>`,
    )
    .join("");

  function reachedReaders(media: string) {
    const { root, projectDir, outsideDir } = outsideProject(false);
    const workDir = join(root, "work");
    const compiledDir = join(workDir, "compiled");
    mkdirSync(compiledDir, { recursive: true });
    const collected = collectRenderMedia(
      `<div data-composition-id="root" data-width="320" data-height="240" data-duration="1">${media}</div>`,
    );
    const composition = { ...collected, duration: 1, width: 320, height: 240 };
    tool.calls.length = 0;
    const openedOutside = () => tool.calls.filter((call) => call.includes(outsideDir));
    return { projectDir, workDir, compiledDir, composition, openedOutside };
  }

  it.each(["force-sdr", "auto"] as const)(
    "video frame extraction and HDR probes (hdrMode %s)",
    async (hdrMode) => {
      const images = escaping("secret.png")
        .map((src, i) => `<img id="i${i}" src="${src}" data-start="0" data-duration="1">`)
        .join("");
      const { projectDir, compiledDir, composition, openedOutside } = reachedReaders(
        videos + images,
      );
      expect(composition.videos).toHaveLength(2);
      expect(composition.images).toHaveLength(2);
      const job = createRenderJob({ fps: { num: 30, den: 1 }, quality: "draft", hdrMode });
      const log = { error() {}, info() {}, debug() {}, warn() {} };
      await runExtractVideosStage({
        ...{ projectDir, compiledDir, job, cfg: resolveConfig(), log, composition },
        ...{ abortSignal: undefined, assertNotAborted: () => {} },
      }).catch(() => undefined);
      expect(openedOutside()).toEqual([]);
    },
  );

  it("audio probes of video sound", async () => {
    const { projectDir, compiledDir, composition, openedOutside } = reachedReaders(videos);
    composition.audios.length = 0;
    await appendVideoAudioFromProbe({ projectDir, compiledDir, composition });
    expect(openedOutside()).toEqual([]);
    expect(composition.audios).toEqual([]);
  });

  it("audio mix", async () => {
    const audios = escaping("clip.mp4")
      .map((src, i) => `<audio id="a${i}" src="${src}" data-start="0" data-duration="1"></audio>`)
      .join("");
    const { projectDir, workDir, compiledDir, composition, openedOutside } = reachedReaders(audios);
    expect(composition.audios).toHaveLength(2);
    const result = await runAudioStage({
      ...{ projectDir, workDir, compiledDir, audios: composition.audios },
      ...{ totalFrames: 30, fps: { num: 30, den: 1 }, ffmpegProcessTimeout: 30_000, audioGain: 1 },
      ...{ abortSignal: undefined, assertNotAborted: () => {} },
    });
    expect(openedOutside()).toEqual([]);
    expect(result.hasAudio).toBe(false);
  });
});
