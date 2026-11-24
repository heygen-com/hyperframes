import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

// A project can arrive with a link at an output name; the helper must replace it, not write through it.
test(
  "mark replaces a link at its output name and leaves the link's target alone",
  { skip: process.platform === "win32" && "symbolic links need extra rights on Windows" },
  () => {
    const base = mkdtempSync(join(tmpdir(), "locate-link-"));
    try {
      const project = join(base, "project");
      mkdirSync(project);
      const victim = join(base, "victim.txt");
      writeFileSync(victim, "KEEP");
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=gray:s=320x180",
        "-frames:v",
        "1",
        join(project, "in.png"),
      ]);
      symlinkSync(victim, join(project, "check.png"));
      execFileSync(
        process.execPath,
        [LOCATE, "mark", "in.png", "--box", "0.1,0.1,0.5,0.5", "--out", "check.png"],
        { cwd: project, stdio: "pipe" },
      );
      assert.equal(readFileSync(victim, "utf8"), "KEEP");
      assert.ok(lstatSync(join(project, "check.png")).isFile());
      assert.deepEqual(readdirSync(project).sort(), ["check.png", "in.png"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  "overlay refuses an output folder that is a link, before writing anything",
  { skip: process.platform === "win32" && "symbolic links need extra rights on Windows" },
  () => {
    const base = mkdtempSync(join(tmpdir(), "locate-link-"));
    try {
      const project = join(base, "project");
      const outside = join(base, "outside");
      mkdirSync(project);
      mkdirSync(outside);
      writeFileSync(join(project, "in.png"), "not read");
      symlinkSync(outside, join(project, "grid"));
      const run = spawnSync(process.execPath, [LOCATE, "overlay", "in.png", "--out", "grid"], {
        cwd: project,
        encoding: "utf8",
      });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /grid: it is a link/);
      assert.deepEqual(readdirSync(outside), []);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
