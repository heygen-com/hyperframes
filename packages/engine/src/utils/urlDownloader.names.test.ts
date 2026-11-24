import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setDownloadFetchForTests, downloadToTemp } from "./urlDownloader.js";

const dirs: string[] = [];

afterEach(() => {
  _setDownloadFetchForTests();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function download(url: string): Promise<string> {
  _setDownloadFetchForTests(
    vi.fn(async () => new Response("media", { headers: { "content-length": "5" } })) as never,
  );
  const dir = mkdtempSync(join(tmpdir(), "hf-url-names-"));
  dirs.push(dir);
  const path = await downloadToTemp(url, dir, 1_000);
  expect(readFileSync(path, "utf8")).toBe("media");
  return basename(path);
}

const SAFE_NAME = /^download_[0-9a-f]{12}\.[A-Za-z0-9]{1,10}$/;

// fails without the fix: the URL path's extension was copied into the file name as is
describe("a downloaded file's name", () => {
  it.each([
    ["https://cdn.example/a.mp4$&x", ".mp4"],
    ["https://cdn.example/a.png$'x", ".png"],
    ["https://cdn.example/a.webm$`x", ".webm"],
    ["https://cdn.example/a.mp3$$x", ".mp3"],
    ["https://cdn.example/a.mp4'onerror=x", ".mp4"],
    ["https://cdn.example/a.jpg=(x)&y", ".jpg"],
    [`https://cdn.example/a.${"m".repeat(300)}`, `.${"m".repeat(10)}`],
    ["https://cdn.example/a.$&", ".mp4"],
  ])("keeps only a short alphanumeric extension for %s", async (url, ext) => {
    const name = await download(url);
    expect(name).toMatch(SAFE_NAME);
    expect(name.endsWith(ext)).toBe(true);
  });

  it("keeps a plain extension", async () => {
    expect(await download("https://cdn.example/clip.MOV")).toMatch(/^download_[0-9a-f]{12}\.MOV$/);
  });
});
