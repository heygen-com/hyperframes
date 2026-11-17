import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

const clip = vi.hoisted(() => ({ path: "" }));
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (_url: string, destDir: string) => {
    const dest = join(destDir, "download_clip.mp4");
    copyFileSync(clip.path, dest);
    return dest;
  },
  fetchPublicHttpsText: async () => {
    throw new Error("offline test");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("gives a video bound to a link one name, the downloaded copy, so its sound is mixed once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-remote-bound-"));
  dirs.push(dir);
  clip.path = join(dir, "tone.mp4");
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=16x16:r=5:d=5",
  ];
  args.push("-f", "lavfi", "-i", "sine=d=5", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p");
  args.push("-c:a", "aac", "-y", clip.path);
  expect(spawnSync(ffmpeg, args).status).toBe(0);

  const url = "https://media.example.com/clip.mp4";
  const htmlPath = join(dir, "index.html");
  writeFileSync(
    htmlPath,
    `<!doctype html><html data-composition-variables='[{"id":"clip","type":"string","default":"tone.mp4"}]'><body><main data-composition-id="root" data-start="0" data-width="16" data-height="16"><video id="v" src="tone.mp4" data-var-src="clip" data-start="0" data-track-index="0"></video></main></body></html>`,
  );
  const compiled = await compileForRender(dir, htmlPath, join(dir, "out"), {
    allowSystemFontCapture: false,
    variables: { clip: url },
  });

  expect(compiled.html).not.toContain(`src="${url}"`);
  expect(compiled.html).not.toContain("data-var-src");
  expect(compiled.audios.map((a) => a.src)).toEqual(["_remote_media/download_clip.mp4"]);
});
