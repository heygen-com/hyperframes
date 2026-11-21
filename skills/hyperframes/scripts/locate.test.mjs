import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCATE = fileURLToPath(new URL("./locate.mjs", import.meta.url));
const SHARED_FONT_PATH = "/tmp/locate-font.ttf";

function hasDrawtext() {
  const filters = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  return filters.status === 0 && /\bdrawtext\b/.test(filters.stdout);
}

function sharedFontState() {
  const stat = lstatSync(SHARED_FONT_PATH, { throwIfNoEntry: false, bigint: true });
  return stat ? `${stat.ino}:${stat.mtimeNs}` : null;
}

test(
  "overlay draws its grids without reading or writing a font at a shared /tmp path",
  { skip: !hasDrawtext() && "ffmpeg without the drawtext filter" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "locate-test-"));
    try {
      const image = join(dir, "in.png");
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=gray:s=320x180",
        "-frames:v",
        "1",
        image,
      ]);
      const before = sharedFontState();
      execFileSync(process.execPath, [LOCATE, "overlay", image, "--out", join(dir, "grid")], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      assert.ok(existsSync(join(dir, "grid", "gv.png")));
      assert.ok(existsSync(join(dir, "grid", "gh.png")));
      assert.equal(sharedFontState(), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
