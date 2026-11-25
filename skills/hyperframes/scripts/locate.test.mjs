import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

function grayImage(path) {
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=320x180",
    "-frames:v",
    "1",
    path,
  ]);
}

// fails without the fix: ffmpeg -y opened each output by name, so a link planted there had its target overwritten.
function linkedOutputsStayLinksTargets(t, steps) {
  const dir = mkdtempSync(join(tmpdir(), "locate-links-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const project = join(dir, "project");
  mkdirSync(project);
  const image = join(project, "in.png");
  grayImage(image);
  for (const [args, names] of steps) {
    for (const name of names) {
      writeFileSync(join(dir, `victim-${name}`), "victim");
      symlinkSync(join(dir, `victim-${name}`), join(project, name));
    }
    execFileSync(process.execPath, [LOCATE, args[0], image, ...args.slice(1)], {
      cwd: project,
      stdio: ["ignore", "ignore", "inherit"],
    });
    for (const name of names) {
      assert.equal(readFileSync(join(dir, `victim-${name}`), "utf8"), "victim", name);
      assert.equal(lstatSync(join(project, name)).isFile(), true, name);
      assert.equal(readFileSync(join(project, name)).subarray(1, 4).toString(), "PNG", name);
    }
  }
}

test("mark replaces a link at check.png instead of writing through it", (t) =>
  linkedOutputsStayLinksTargets(t, [[["mark", "--box", "0.1,0.1,0.5,0.5"], ["check.png"]]]));

test(
  "overlay and region replace links at gv.png, gh.png and gc.png instead of writing through them",
  { skip: !hasDrawtext() && "ffmpeg without the drawtext filter" },
  (t) =>
    linkedOutputsStayLinksTargets(t, [
      [["overlay"], ["gv.png", "gh.png"]],
      [["region", "--vids", "4,5", "--hids", "4,5"], ["gc.png"]],
    ]),
);
