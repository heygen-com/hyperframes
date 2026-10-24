import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildPublishFileMap, stagePublishFiles } from "../utils/publishProject.js";
import {
  type GifPrep,
  OFFLOAD_MIN_BYTES,
  offloadHeavyMedia,
  type Reencoder,
  type UploadableFile,
} from "./offload.js";

const HEAVY = Buffer.alloc(OFFLOAD_MIN_BYTES, 1);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-offload-test-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-offload-cache-"));
  dirs.push(dir);
  return join(dir, "cloud-assets.json");
}

function fakeUpload() {
  let n = 0;
  return vi.fn(async (file: UploadableFile) => {
    n += 1;
    return { asset_id: `asset_${n}`, url: `https://assets.example/${n}/${file.filename}` };
  });
}

// HEAD answers like the asset CDN: the stored size, or 404 once the asset is gone.
function fakeHead(status: number, size: number): typeof fetch {
  return vi.fn(
    async () => new Response(null, { status, headers: { "content-length": String(size) } }),
  ) as unknown as typeof fetch;
}

// Encoders read a temp snapshot of the staged bytes, never the project file.
const staged = (name: string) =>
  expect.stringMatching(new RegExp(`hf-offload-src-[^/\\\\]+[/\\\\]${name}$`));

const html = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

describe("offloadHeavyMedia", () => {
  it("rewrites every reference in the staged copy and drops the file from the zip", async () => {
    const indexHtml = html(
      `<style>.bg { background: url("media/bg.png"); }</style>` +
        `<video src="media/clip.mp4" poster="media/bg.png"><source src="./media/clip.mp4" /></video>` +
        `<img srcset="media/bg.png 1x, media/small.png 2x" />` +
        `<div style="background-image: url(media/bg.png)"></div>` +
        `<audio src="/media/voice.mp3#t=2"></audio>` +
        `<div data-composition-src="compositions/scene.html"></div>`,
    );
    const dir = project({
      "index.html": indexHtml,
      // Sub-compositions are inlined into the root, so a root-relative src resolves from the project root.
      "compositions/scene.html": html(
        `<video src="media/clip.mp4"></video><img src="../media/bg.png" />`,
      ),
      "styles/main.css": `.x { background: url('../media/bg.png'); }`,
      "media/clip.mp4": HEAVY,
      "media/bg.png": HEAVY,
      "media/voice.mp3": HEAVY,
      "media/small.png": "tiny",
    });
    const fileMap = buildPublishFileMap(dir);
    const upload = fakeUpload();

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload,
      cachePath: cachePath(),
    });

    const url = (path: string) => report.find((item) => item.path === path)!.url!;
    expect(report.map((item) => [item.path, item.action])).toEqual([
      ["media/bg.png", "upload"],
      ["media/clip.mp4", "upload"],
      ["media/voice.mp3", "upload"],
    ]);
    const index = fileMap.get("index.html")!.toString();
    expect(index).toContain(`url("${url("media/bg.png")}")`);
    expect(index).toContain(`src="${url("media/clip.mp4")}" poster="${url("media/bg.png")}"`);
    expect(index).toContain(`<source src="${url("media/clip.mp4")}"`);
    expect(index).toContain(`srcset="${url("media/bg.png")} 1x, media/small.png 2x"`);
    expect(index).toContain(`url(${url("media/bg.png")})`);
    expect(index).toContain(`<audio src="${url("media/voice.mp3")}#t=2"`);
    const scene = fileMap.get("compositions/scene.html")!.toString();
    expect(scene).toContain(`<video src="${url("media/clip.mp4")}"`);
    expect(scene).toContain(`<img src="${url("media/bg.png")}"`);
    expect(fileMap.get("styles/main.css")!.toString()).toContain(`url('${url("media/bg.png")}')`);
    expect([...fileMap.keys()].sort()).toEqual([
      "compositions/scene.html",
      "index.html",
      "media/small.png",
      "styles/main.css",
    ]);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(indexHtml);
  });

  it("reuses a cached asset that is still served, without uploading again", async () => {
    const dir = project({
      "index.html": html(`<video src="clip.mp4"></video>`),
      "clip.mp4": HEAVY,
    });
    const cache = cachePath();
    const upload = fakeUpload();
    const opts = { apiBaseUrl: "https://api.example", upload, cachePath: cache };

    await offloadHeavyMedia(dir, buildPublishFileMap(dir), opts);
    const second = buildPublishFileMap(dir);
    const report = await offloadHeavyMedia(dir, second, {
      ...opts,
      fetchImpl: fakeHead(200, HEAVY.byteLength),
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(report).toEqual([
      expect.objectContaining({
        path: "clip.mp4",
        action: "cached",
        url: "https://assets.example/1/clip.mp4",
      }),
    ]);
    expect(second.get("index.html")!.toString()).toContain("https://assets.example/1/clip.mp4");
  });

  it("treats a cache file holding null as empty", async () => {
    const dir = project({
      "index.html": html(`<video src="clip.mp4"></video>`),
      "clip.mp4": HEAVY,
    });
    const cache = cachePath();
    writeFileSync(cache, "null");

    await expect(
      offloadHeavyMedia(dir, buildPublishFileMap(dir), {
        apiBaseUrl: "https://api.example",
        upload: fakeUpload(),
        cachePath: cache,
      }),
    ).resolves.toHaveLength(1);
  });

  it("uploads again when the cached asset URL no longer serves the file", async () => {
    const dir = project({
      "index.html": html(`<video src="clip.mp4"></video>`),
      "clip.mp4": HEAVY,
    });
    const opts = {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      cachePath: cachePath(),
    };

    await offloadHeavyMedia(dir, buildPublishFileMap(dir), opts);
    const report = await offloadHeavyMedia(dir, buildPublishFileMap(dir), {
      ...opts,
      fetchImpl: fakeHead(404, 0),
    });
    // Served, but at a size other than the one uploaded.
    await offloadHeavyMedia(dir, buildPublishFileMap(dir), {
      ...opts,
      fetchImpl: fakeHead(200, HEAVY.byteLength - 1),
    });

    expect(opts.upload).toHaveBeenCalledTimes(3);
    expect(report[0]).toMatchObject({ action: "upload", url: "https://assets.example/2/clip.mp4" });
  });

  it("re-encodes media the asset API refuses and uploads the accepted format", async () => {
    const dir = project({
      "index.html": html(`<video src="take.mkv"></video>`),
      "take.mkv": HEAVY,
    });
    const reencoder: Reencoder = {
      choose: vi.fn(async () => "video" as const),
      run: vi.fn(async () => ({
        bytes: Buffer.from("h264"),
        filename: "take.mp4",
        contentType: "video/mp4",
      })),
    };
    const upload = fakeUpload();
    const fileMap = buildPublishFileMap(dir);

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload,
      reencoder,
      cachePath: cachePath(),
    });

    expect(reencoder.run).toHaveBeenCalledWith(staged("take.mkv"), "video", undefined);
    expect(upload.mock.calls[0]![0]).toMatchObject({
      filename: "take.mp4",
      contentType: "video/mp4",
    });
    expect(report[0]).toMatchObject({ path: "take.mkv", action: "reencode" });
    expect(fileMap.get("index.html")!.toString()).toContain("https://assets.example/1/take.mp4");
    expect(fileMap.has("take.mkv")).toBe(false);
  });

  it("fails naming the file when a re-encode is still over the asset cap", async () => {
    const dir = project({
      "index.html": html(`<video src="long.mkv"></video>`),
      "long.mkv": HEAVY,
    });
    const reencoder: Reencoder = {
      choose: async () => "video",
      run: async () => ({
        bytes: { byteLength: 201 * 1024 * 1024 } as Uint8Array,
        filename: "long.mp4",
        contentType: "video/mp4",
      }),
    };
    const upload = fakeUpload();

    await expect(
      offloadHeavyMedia(dir, buildPublishFileMap(dir), {
        apiBaseUrl: "https://api.example",
        upload,
        reencoder,
        cachePath: cachePath(),
      }),
    ).rejects.toThrow(/^long\.mkv is 201(\.0)? MB after re-encoding/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rewrites plain string literals in scripts and data, keeping a copy of a path a script builds", async () => {
    const dir = project({
      "index.html": html(
        `<script src="main.js"></script>` +
          `<script>fetch('./media/clip.mp4'); video.src = \`media/clip.mp4\`;</script>`,
      ),
      "main.js": `new Audio("music.mp3").play(); const voice = \`media/\${name}\`; // voice.mp3`,
      "data/cues.json": `{"track": "music.mp3"}`,
      "media/clip.mp4": HEAVY,
      "music.mp3": HEAVY,
      "voice.mp3": HEAVY,
    });
    const fileMap = buildPublishFileMap(dir);

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      cachePath: cachePath(),
    });

    const url = (path: string) => report.find((item) => item.path === path)!.url!;
    const index = fileMap.get("index.html")!.toString();
    expect(index).toContain(`fetch('${url("media/clip.mp4")}')`);
    expect(index).toContain(`video.src = \`${url("media/clip.mp4")}\``);
    expect(fileMap.get("main.js")!.toString()).toContain(`new Audio("${url("music.mp3")}")`);
    expect(fileMap.get("data/cues.json")!.toString()).toBe(`{"track": "${url("music.mp3")}"}`);
    expect(report.find((item) => item.path === "voice.mp3")).toBeUndefined();
    expect(fileMap.has("voice.mp3")).toBe(true);
    expect(fileMap.has("music.mp3")).toBe(false);
    expect(fileMap.has("media/clip.mp4")).toBe(false);
  });

  it("converts a still image the API refuses and leaves an animated one in the zip", async () => {
    const dir = project({
      "index.html": html(`<img src="still.avif" /><img src="moving.avif" />`),
      "still.avif": HEAVY,
      "moving.avif": Buffer.alloc(OFFLOAD_MIN_BYTES, 2),
    });
    const reencoder: Reencoder = {
      choose: async (sourcePath) => (sourcePath.endsWith("still.avif") ? "image" : null),
      run: async () => ({
        bytes: Buffer.from("png"),
        filename: "still.png",
        contentType: "image/png",
      }),
    };
    const upload = fakeUpload();
    const fileMap = buildPublishFileMap(dir);

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload,
      reencoder,
      cachePath: cachePath(),
    });

    expect(report).toEqual([expect.objectContaining({ path: "still.avif", action: "reencode" })]);
    expect(upload.mock.calls[0]![0]).toMatchObject({ contentType: "image/png" });
    expect(fileMap.has("still.avif")).toBe(false);
    expect(fileMap.has("moving.avif")).toBe(true);
    expect(fileMap.get("index.html")!.toString()).toContain(`<img src="moving.avif">`);
  });

  it("offloads the video the renderer's GIF prep makes from an entry GIF, and drops the GIF", async () => {
    const dir = project({
      "index.html": html(`<img src="media/loop.gif" data-loop="true" data-duration="4" />`),
      "compositions/scene.html": html(`<img src="media/other.gif" />`),
      "media/loop.gif": HEAVY,
      "media/other.gif": HEAVY,
    });
    const gifPrep = vi.fn<GifPrep>(async (input, options) => {
      const outputPath = join(options.outputDir, "hfgif-v1-abc.webm");
      writeFileSync(outputPath, HEAVY);
      return {
        html: input.replace(
          `<img src="media/loop.gif" data-loop="true" data-duration="4" />`,
          `<video src="${options.outputSrcPrefix}/hfgif-v1-abc.webm" loop></video>`,
        ),
        preparedGifs: [{ sourceSrc: "media/loop.gif", outputPath }],
      };
    });
    const fileMap = buildPublishFileMap(dir);

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      gifPrep,
      reencoder: { choose: async () => null, run: vi.fn() },
      cachePath: cachePath(),
    });

    expect(gifPrep.mock.calls[0]![1]).toMatchObject({
      projectDir: dir,
      outputSrcPrefix: "_animated_gif",
    });
    expect(report).toEqual([
      expect.objectContaining({ path: "_animated_gif/hfgif-v1-abc.webm", action: "upload" }),
    ]);
    expect(fileMap.get("index.html")!.toString()).toContain(
      `<video src="https://assets.example/1/hfgif-v1-abc.webm" loop>`,
    );
    expect(fileMap.has("media/loop.gif")).toBe(false);
    expect(fileMap.has("_animated_gif/hfgif-v1-abc.webm")).toBe(false);
    // Sub-compositions are prepared by the renderer after inlining, so their GIFs stay in the zip.
    expect(fileMap.has("media/other.gif")).toBe(true);
  });

  it("prepares a nested entry's GIF from the file next to it, as the renderer resolves it", async () => {
    const nested = Buffer.alloc(OFFLOAD_MIN_BYTES, 2);
    const dir = project({
      "index.html": html(""),
      "compositions/scene.html": html(`<img src="logo.gif" />`),
      "compositions/logo.gif": nested,
      "logo.gif": HEAVY,
    });
    let prepared: Buffer | undefined;
    const gifPrep = vi.fn<GifPrep>(async (input, options) => {
      prepared = readFileSync(options.sourceAssets!.get("logo.gif")!);
      const outputPath = join(options.outputDir, "hfgif-v1-abc.webm");
      writeFileSync(outputPath, HEAVY);
      return {
        html: input.replace(
          `<img src="logo.gif" />`,
          `<video src="../_animated_gif/hfgif-v1-abc.webm"></video>`,
        ),
        preparedGifs: [{ sourceSrc: "logo.gif", outputPath }],
      };
    });
    const fileMap = buildPublishFileMap(dir);

    await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      entryPath: "compositions/scene.html",
      upload: fakeUpload(),
      gifPrep,
      cachePath: cachePath(),
    });

    expect(prepared?.equals(nested)).toBe(true);
    expect(fileMap.has("compositions/logo.gif")).toBe(false);
    expect(fileMap.has("logo.gif")).toBe(true);
  });

  it("hashes and encodes media over 4 GiB from disk, never reading it whole", async () => {
    const dir = project({ "index.html": html(`<video src="take.mov"></video>`), "take.mov": "" });
    truncateSync(join(dir, "take.mov"), 2 ** 32 + 1);
    const fileMap = stagePublishFiles(dir, OFFLOAD_MIN_BYTES);
    const run = vi.fn(async () => ({
      bytes: Buffer.from("mp4"),
      filename: "take.mp4",
      contentType: "video/mp4",
    }));

    const [item] = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      reencoder: { choose: async () => "video", run },
      cachePath: cachePath(),
    });

    expect(run).toHaveBeenCalledWith(join(dir, "take.mov"), "video", undefined);
    expect(item).toMatchObject({ path: "take.mov", action: "reencode", size_bytes: 2 ** 32 + 1 });
    expect(fileMap.has("take.mov")).toBe(false);
  }, 60_000);

  it("uploads media staged on disk as a stream of the file", async () => {
    const dir = project({
      "index.html": html(`<video src="clip.mp4"></video>`),
      "clip.mp4": HEAVY,
    });
    const upload = fakeUpload();

    await offloadHeavyMedia(dir, stagePublishFiles(dir, OFFLOAD_MIN_BYTES), {
      apiBaseUrl: "https://api.example",
      upload,
      cachePath: cachePath(),
    });

    expect(upload).toHaveBeenCalledWith({
      path: join(dir, "clip.mp4"),
      size: HEAVY.byteLength,
      filename: "clip.mp4",
      contentType: "video/mp4",
    });
  });

  it("stops without caching when media staged on disk changes during its encode", async () => {
    const dir = project({
      "index.html": html(`<audio src="voice.flac"></audio>`),
      "voice.flac": HEAVY,
    });
    const fileMap = stagePublishFiles(dir, OFFLOAD_MIN_BYTES);
    const cache = cachePath();
    const run = vi.fn(async (sourcePath: string) => {
      utimesSync(sourcePath, new Date(), new Date(Date.now() + 5_000));
      return { bytes: Buffer.from("wav"), filename: "voice.wav", contentType: "audio/wav" };
    });

    await expect(
      offloadHeavyMedia(dir, fileMap, {
        apiBaseUrl: "https://api.example",
        upload: fakeUpload(),
        reencoder: { choose: async () => "audio", run },
        cachePath: cache,
      }),
    ).rejects.toThrow(/changed on disk/);
    expect(existsSync(cache)).toBe(false);
  });

  it("re-encodes the staged bytes, not a file saved on disk after staging", async () => {
    const dir = project({
      "index.html": html(`<audio src="voice.flac"></audio>`),
      "voice.flac": HEAVY,
    });
    const fileMap = buildPublishFileMap(dir);
    writeFileSync(join(dir, "voice.flac"), Buffer.alloc(OFFLOAD_MIN_BYTES, 9));
    let encoded: Buffer | undefined;
    const run = vi.fn(async (sourcePath: string) => {
      encoded = readFileSync(sourcePath);
      return { bytes: Buffer.from("wav"), filename: "voice.wav", contentType: "audio/wav" };
    });

    await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      reencoder: { choose: async () => "audio", run },
      cachePath: cachePath(),
    });

    expect(encoded?.equals(HEAVY)).toBe(true);
  });

  it("cuts a re-encoded video to the windows its clips play and shifts their starts to match", async () => {
    const dir = project({
      "index.html": html(
        `<video id="a" src="long.mkv" data-start="0" data-duration="2" data-media-start="10"></video>` +
          `<video id="b" src="long.mkv" data-start="2" data-duration="2" data-media-start="100.5" data-playback-rate="2"></video>`,
      ),
      "long.mkv": HEAVY,
    });
    const run = vi.fn(async () => ({
      bytes: Buffer.from("cut"),
      filename: "long.mp4",
      contentType: "video/mp4",
    }));
    const fileMap = buildPublishFileMap(dir);

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      reencoder: { choose: async () => "video", trimGrid: async () => 30, run },
      cachePath: cachePath(),
    });

    expect(run).toHaveBeenCalledWith(staged("long.mkv"), "video", [
      { start: 9.5, end: 12.5 },
      { start: 100, end: 105 },
    ]);
    expect(report[0]).toMatchObject({ path: "long.mkv", trimmed_to_seconds: 8 });
    const index = fileMap.get("index.html")!.toString();
    expect(index).toMatch(/id="a"[^>]*data-media-start="0.5"/);
    expect(index).toMatch(/id="b"[^>]*data-media-start="3.5"/);
  });

  it("cuts on the source's own frames at 29.97 fps and re-encodes when the cut changes", async () => {
    const clip = (start: number) =>
      html(`<video src="long.mkv" data-duration="2" data-media-start="${start}"></video>`);
    const dir = project({ "index.html": clip(10), "long.mkv": HEAVY });
    const fps = 30000 / 1001;
    const run = vi.fn(async () => ({
      bytes: Buffer.from("cut"),
      filename: "long.mp4",
      contentType: "video/mp4",
    }));
    const opts = {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      reencoder: { choose: async () => "video" as const, trimGrid: async () => fps, run },
      // Any cached URL is still served, so only the key decides reuse.
      fetchImpl: fakeHead(200, 3),
      cachePath: cachePath(),
    };

    await offloadHeavyMedia(dir, buildPublishFileMap(dir), opts);
    writeFileSync(join(dir, "index.html"), clip(20));
    await offloadHeavyMedia(dir, buildPublishFileMap(dir), opts);
    await offloadHeavyMedia(dir, buildPublishFileMap(dir), opts);

    expect(run).toHaveBeenCalledTimes(2);
    const calls = run.mock.calls as unknown as Array<[string, string, Array<{ start: number }>]>;
    for (const [, , segments] of calls) {
      const frames = segments[0]!.start * fps;
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-6);
    }
  });

  it("keeps the whole file when a use is not a bounded clip or a script names it", async () => {
    const looped = project({
      "index.html": html(
        `<video src="long.mkv" data-duration="2" data-media-start="10" loop></video>`,
      ),
      "long.mkv": HEAVY,
    });
    const scripted = project({
      "index.html": html(`<video src="long.mkv" data-duration="2" data-media-start="10"></video>`),
      "main.js": "const name = `long.mkv`.replace('.mkv', '');",
      "long.mkv": HEAVY,
    });
    const variableBound = project({
      "index.html": html(
        `<video data-var-src="clip" src="long.mkv" data-duration="2" data-media-start="10"></video>`,
      ),
      "long.mkv": HEAVY,
    });
    const fragment = project({
      "index.html": html(
        `<video src="long.mkv#t=10,12" data-duration="2" data-media-start="10"></video>`,
      ),
      "long.mkv": HEAVY,
    });
    const automated = project({
      "index.html": html(
        `<video src="long.mkv" data-duration="2" data-media-start="10" data-automation="x"></video>`,
      ),
      "long.mkv": HEAVY,
    });
    const offsetParent = project({
      "index.html": html(
        `<div data-media-start="3"><video src="long.mkv" data-duration="2" data-media-start="10"></video></div>`,
      ),
      "long.mkv": HEAVY,
    });
    const nested = project({
      "index.html": html(
        `<div data-composition-id="root"><div data-composition-id="inner">` +
          `<video src="long.mkv" data-duration="2" data-media-start="10"></video></div></div>`,
      ),
      "long.mkv": HEAVY,
    });
    const retimedById = project({
      "index.html": html(
        `<video id="a" src="long.mkv" data-start="0" data-duration="2" data-media-start="10"></video>` +
          `<script>const a = document.getElementById("a"); a.setAttribute("data-media-start", "100"); a.volume = 0.5;</script>`,
      ),
      "long.mkv": HEAVY,
    });
    const retimedByDataset = project({
      "index.html": html(
        `<video id="a" src="long.mkv" data-duration="2" data-media-start="10"></video><script src="main.js"></script>`,
      ),
      "main.js": `document.getElementById("a").dataset.mediaStart = "100";`,
      "long.mkv": HEAVY,
    });
    const namedInPage = project({
      "index.html": html(
        `<video src="long.mkv" data-duration="2" data-media-start="10"></video><p data-note="long.mkv"></p>`,
      ),
      "long.mkv": HEAVY,
    });
    for (const dir of [
      looped,
      scripted,
      variableBound,
      fragment,
      automated,
      offsetParent,
      nested,
      retimedById,
      retimedByDataset,
      namedInPage,
    ]) {
      const run = vi.fn(async () => ({
        bytes: Buffer.from("full"),
        filename: "long.mp4",
        contentType: "video/mp4",
      }));
      const fileMap = buildPublishFileMap(dir);
      await offloadHeavyMedia(dir, fileMap, {
        apiBaseUrl: "https://api.example",
        upload: fakeUpload(),
        reencoder: { choose: async () => "video", trimGrid: async () => 30, run },
        cachePath: cachePath(),
      });
      expect(run).toHaveBeenCalledWith(staged("long.mkv"), "video", undefined);
      expect(fileMap.get("index.html")!.toString()).toContain(`data-media-start="10"`);
    }
  });

  it("keeps a heavy file no reference names in the zip, since --variables can pick it at render time", async () => {
    const dir = project({
      "index.html": html(`<video data-var-src="clip" src="media/a.mp4"></video>`),
      "media/a.mp4": HEAVY,
      "media/b.mp4": HEAVY,
    });
    const fileMap = buildPublishFileMap(dir);
    const upload = fakeUpload();

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload,
      cachePath: cachePath(),
    });

    expect(report.map((item) => item.path)).toEqual(["media/a.mp4"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(fileMap.has("media/b.mp4")).toBe(true);
  });

  it("keeps a heavy file a script builds from split strings in the zip", async () => {
    const dir = project({
      "index.html": html(
        `<video id="v" data-start="0" data-duration="2"></video><script>v.src = "media/" + "clip" + ".mp4";</script>`,
      ),
      "media/clip.mp4": HEAVY,
    });
    const fileMap = buildPublishFileMap(dir);
    const upload = fakeUpload();

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload,
      cachePath: cachePath(),
    });

    expect(report).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(fileMap.has("media/clip.mp4")).toBe(true);
  });

  it("keeps a zip copy of an offloaded file a script can also build from split strings", async () => {
    const dir = project({
      "index.html": html(
        `<video id="v" src="media/clip.mp4"></video>` +
          `<script>document.getElementById("v").src = "media/" + "clip" + ".mp4";</script>`,
      ),
      "media/clip.mp4": HEAVY,
    });
    const fileMap = buildPublishFileMap(dir);

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload: fakeUpload(),
      cachePath: cachePath(),
    });

    expect(report).toEqual([
      expect.objectContaining({ path: "media/clip.mp4", kept_in_archive: true }),
    ]);
    expect(fileMap.has("media/clip.mp4")).toBe(true);
  });

  it("prepares an entry GIF staged on disk from a checked private copy", async () => {
    const files = {
      "index.html": html(`<img src="media/loop.gif" />`),
      "media/loop.gif": HEAVY,
    };
    const prepared: Buffer[] = [];
    const gifPrep = vi.fn<GifPrep>(async (input, options) => {
      const source = options.sourceAssets.get("media/loop.gif")!;
      // An edit while the renderer hashes and encodes must not reach what it caches.
      writeFileSync(join(options.projectDir, "media/loop.gif"), Buffer.alloc(9));
      prepared.push(readFileSync(source));
      const outputPath = join(options.outputDir, "hfgif-v1-abc.webm");
      writeFileSync(outputPath, "webm");
      return {
        html: input.replace(
          `<img src="media/loop.gif" />`,
          `<video src="_animated_gif/hfgif-v1-abc.webm"></video>`,
        ),
        preparedGifs: [{ sourceSrc: "media/loop.gif", outputPath }],
      };
    });
    const opts = { apiBaseUrl: "https://api.example", upload: fakeUpload(), gifPrep };

    const dir = project(files);
    await offloadHeavyMedia(dir, stagePublishFiles(dir, OFFLOAD_MIN_BYTES), {
      ...opts,
      cachePath: cachePath(),
    });
    expect(prepared[0]?.equals(HEAVY)).toBe(true);

    const edited = project(files);
    const fileMap = stagePublishFiles(edited, OFFLOAD_MIN_BYTES);
    writeFileSync(join(edited, "media/loop.gif"), Buffer.alloc(9));
    await expect(
      offloadHeavyMedia(edited, fileMap, { ...opts, cachePath: cachePath() }),
    ).rejects.toThrow(/changed on disk/);
  });

  it("never decodes a media file as text, since one can exceed the longest string allowed", async () => {
    const dir = project({
      "index.html": html(`<video src="clip.mp4"></video>`),
      "clip.mp4": HEAVY,
    });
    const fileMap = buildPublishFileMap(dir);
    const binary = Buffer.alloc(16);
    binary.toString = () => {
      throw new Error("decoded a binary entry");
    };
    fileMap.set("media/raw.bin", binary);

    await expect(
      offloadHeavyMedia(dir, fileMap, {
        apiBaseUrl: "https://api.example",
        upload: fakeUpload(),
        cachePath: cachePath(),
      }),
    ).resolves.toHaveLength(1);
  });

  it("leaves small media and remote URLs alone", async () => {
    const dir = project({
      "index.html": html(
        `<img src="logo.png" /><img src="spin.gif" /><video src="https://cdn.example/a.mp4"></video>`,
      ),
      "logo.png": "small",
      "spin.gif": "small",
    });
    const fileMap = buildPublishFileMap(dir);
    const upload = fakeUpload();
    const gifPrep = vi.fn<GifPrep>();

    const report = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example",
      upload,
      gifPrep,
      cachePath: cachePath(),
    });

    expect(report).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(gifPrep).not.toHaveBeenCalled();
    expect(fileMap.has("logo.png")).toBe(true);
  });
});
