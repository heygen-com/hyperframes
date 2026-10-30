import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileForRender } from "./htmlCompiler.js";
import { preflightCompositionAssetMediaTypes } from "./assetMediaType.js";

const FIXTURE = fileURLToPath(
  new URL("../../tests/fixtures/heic/rotated-grid.heic", import.meta.url),
);

describe("compileForRender with a tiled HEIC image", () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-heif-"));
    copyFileSync(FIXTURE, join(projectDir, "photo.heic"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><body>
        <div data-composition-id="root" data-width="700" data-height="1100" data-duration="2">
          <img id="photo" src="photo.heic" data-start="0" data-duration="2">
        </div>
      </body></html>`,
    );
  });

  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  it("reads as a moving video to the media-type preflight when left unconverted", async () => {
    await expect(
      preflightCompositionAssetMediaTypes({
        projectDir,
        compiledDir: join(projectDir, "unused"),
        composition: {
          videos: [],
          audios: [],
          images: [{ id: "photo", src: "photo.heic" } as never],
        },
      }),
    ).rejects.toMatchObject({
      code: "ASSET_MEDIA_TYPE_MISMATCH",
      mismatches: [{ expected: "image", detected: "video" }],
    });
  });

  it("hands the preflight a JPEG, so the image passes", async () => {
    const compiled = await compileForRender(
      projectDir,
      join(projectDir, "index.html"),
      join(projectDir, "downloads"),
    );
    const [image] = compiled.images;
    expect(image!.src).toMatch(/^_heif_images\/hfheif-v1-[0-9a-f]{24}\.jpg$/);
    expect(compiled.html).not.toContain("photo.heic");

    const compiledDir = join(projectDir, "compiled");
    for (const [rel, abs] of compiled.externalAssets) {
      mkdirSync(dirname(join(compiledDir, rel)), { recursive: true });
      copyFileSync(abs, join(compiledDir, rel));
    }
    await expect(
      preflightCompositionAssetMediaTypes({ projectDir, compiledDir, composition: compiled }),
    ).resolves.toBeUndefined();
  });
});
