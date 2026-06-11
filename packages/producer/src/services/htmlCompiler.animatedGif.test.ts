import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { compileForRender } from "./htmlCompiler.js";

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function ascii(value: string): number[] {
  return Array.from(value).map((char) => char.charCodeAt(0));
}

function frame(delayCentiseconds: number): number[] {
  return [
    0x21,
    0xf9,
    0x04,
    0x00,
    ...u16(delayCentiseconds),
    0x00,
    0x00,
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x02,
    0x02,
    0x4c,
    0x01,
    0x00,
  ];
}

function gif(frames: number[], loopCount?: number): Uint8Array {
  const loop =
    loopCount === undefined
      ? []
      : [0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 0x03, 0x01, ...u16(loopCount), 0x00];
  return Uint8Array.from([
    ...ascii("GIF89a"),
    ...u16(1),
    ...u16(1),
    0x00,
    0x00,
    0x00,
    ...loop,
    ...frames,
    0x3b,
  ]);
}

function preparedGifCachePath(
  cacheDir: string,
  bytes: Uint8Array,
  loopIterations: number,
  padSeconds: number,
): string {
  const hash = createHash("sha256")
    .update("hfgif-v1")
    .update("\0")
    .update(String(loopIterations))
    .update("\0")
    .update(String(padSeconds))
    .update("\0")
    .update(bytes)
    .digest("hex");
  return join(cacheDir, `hfgif-v1-${hash.slice(0, 24)}.webm`);
}

describe("compileForRender animated GIF inputs", () => {
  it("rewrites animated GIF images to prepared synced videos", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-gif-"));
    const cacheDir = join(projectDir, "gif-cache");
    mkdirSync(cacheDir, { recursive: true });

    const bytes = gif([...frame(5), ...frame(15)], 0);
    writeFileSync(join(projectDir, "reaction.gif"), bytes);
    // 0.2s source in a 2s clip window: prep bakes 10 loop iterations (pad 0).
    writeFileSync(preparedGifCachePath(cacheDir, bytes, 10, 0), "webm");
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="3">
    <img id="reaction" class="clip sticker" data-start="1" data-duration="2" src="reaction.gif" />
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.root = { duration: function() { return 3; } };
    </script>
  </div>
</body></html>`,
    );

    const compiled = await compileForRender(
      projectDir,
      join(projectDir, "index.html"),
      projectDir,
      {
        animatedGifCacheDir: cacheDir,
      },
    );
    const { document } = parseHTML(compiled.html);
    const video = document.querySelector("video#reaction");
    const src = video?.getAttribute("src") ?? "";

    expect(document.querySelector("img#reaction")).toBeNull();
    expect(video?.getAttribute("class")).toBe("clip sticker");
    expect(video?.hasAttribute("loop")).toBe(true);
    expect(video?.getAttribute("data-hf-prepared-gif")).toBe("true");
    expect(video?.getAttribute("data-end")).toBe("3");
    expect(src).toMatch(/^_animated_gif\/hfgif-v1-/);
    expect(compiled.videos.some((entry) => entry.id === "reaction")).toBe(true);
    expect(compiled.images.some((entry) => entry.id === "reaction")).toBe(false);
    expect(compiled.externalAssets.has(src)).toBe(true);
    expect(existsSync(join(projectDir, src))).toBe(true);
  });
});
