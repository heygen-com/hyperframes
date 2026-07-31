import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compileForRender } from "./htmlCompiler.js";
import { synthesizeMediaFixture } from "./mediaTypeTestFixtures.js";

const HAS_MEDIA_TOOLS =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!HAS_MEDIA_TOOLS)("compileForRender media-type ownership", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-media-type-"));
  const downloadDir = join(projectDir, "downloads");
  const stillPath = join(projectDir, "extensionless-still");
  const videoPath = join(projectDir, "extensionless-video");

  beforeAll(() => {
    mkdirSync(downloadDir, { recursive: true });
    synthesizeMediaFixture([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-f",
      "image2",
      stillPath,
    ]);
    synthesizeMediaFixture([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x32:d=1:r=30",
      "-c:v",
      "mpeg4",
      "-f",
      "mp4",
      videoPath,
    ]);
  }, 30_000);

  afterAll(() => {
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
  });

  async function compile(mediaMarkup: string) {
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body>
        <div data-composition-id="root" data-width="320" data-height="180" data-duration="1">
          ${mediaMarkup}
        </div>
      </body></html>`,
    );
    return compileForRender(projectDir, htmlPath, downloadDir);
  }

  it("does not leak image-under-video through the generic no-video-stream path", async () => {
    await expect(
      compile('<video id="clip" src="extensionless-still" data-start="0"></video>'),
    ).rejects.toMatchObject({
      code: "ASSET_MEDIA_TYPE_MISMATCH",
      owner: "user",
      retryable: false,
    });
  });

  it("does not silently drop a silent video authored as audio", async () => {
    await expect(
      compile('<audio id="voice" src="extensionless-video" data-start="0"></audio>'),
    ).rejects.toMatchObject({
      code: "ASSET_MEDIA_TYPE_MISMATCH",
      owner: "user",
      retryable: false,
    });
  });
});
