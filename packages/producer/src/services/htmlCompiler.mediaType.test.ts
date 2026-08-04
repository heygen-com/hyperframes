import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "./htmlCompiler.js";
import { synthesizeMediaFixture } from "./mediaTypeTestFixtures.js";
import { Semaphore } from "../utils/semaphore.js";
import { sharedMediaProbeSemaphore } from "../utils/mediaProbeConcurrency.js";

describe("compileForRender media-type ownership", () => {
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

  it("shares a four-wide media-probe limiter across parallel sub-compositions", async () => {
    const originalAcquire = Semaphore.prototype.acquire;
    const limiterInstances = new Set<Semaphore>();
    let maxActive = 0;
    const acquireSpy = vi
      .spyOn(Semaphore.prototype, "acquire")
      .mockImplementation(async function (this: Semaphore) {
        const release = await originalAcquire.call(this);
        limiterInstances.add(this);
        maxActive = Math.max(maxActive, this.activeCount);
        return release;
      });

    try {
      const subCompositions: string[] = [];
      for (let index = 0; index < 8; index += 1) {
        const name = `probe-${index}.html`;
        writeFileSync(
          join(projectDir, name),
          `<!doctype html><html><body>
            <div data-composition-id="sub-${index}" data-width="32" data-height="32" data-duration="1">
              <video id="video-${index}" src="extensionless-video" data-start="0"></video>
            </div>
          </body></html>`,
        );
        subCompositions.push(
          `<div data-composition-id="sub-${index}" data-composition-src="${name}" data-start="0" data-duration="1"></div>`,
        );
      }
      const htmlPath = join(projectDir, "index.html");
      writeFileSync(
        htmlPath,
        `<!doctype html><html><body>
          <div data-composition-id="root" data-width="320" data-height="180" data-duration="1">
            ${subCompositions.join("\n")}
          </div>
        </body></html>`,
      );

      await compileForRender(projectDir, htmlPath, downloadDir);
      await vi.waitFor(
        () => {
          expect(sharedMediaProbeSemaphore.activeCount).toBe(0);
          expect(sharedMediaProbeSemaphore.waitingCount).toBe(0);
        },
        { timeout: 30_000, interval: 5 },
      );

      expect(limiterInstances.size).toBe(1);
      expect(maxActive).toBe(4);
    } finally {
      acquireSpy.mockRestore();
    }
  });
});
