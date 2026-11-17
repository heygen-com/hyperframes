import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const LOCATE = join(dirname(fileURLToPath(import.meta.url)), "locate.mjs");

// Stand-ins for ffprobe and ffmpeg: ffmpeg records each drawtext font and the mode of its folder.
function fakeTools(bin, record) {
  mkdirSync(bin);
  const tools = {
    ffprobe: `console.log("90,90");`,
    ffmpeg: `const { appendFileSync, statSync } = require("node:fs");
const { dirname } = require("node:path");
for (const font of process.argv.join(" ").matchAll(/fontfile=([^:]+):/g)) {
  const mode = (statSync(dirname(font[1])).mode & 0o777).toString(8);
  appendFileSync(${JSON.stringify(record)}, JSON.stringify({ font: font[1], mode }) + "\\n");
}`,
  };
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(join(bin, name), `#!${process.execPath}\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
}

test(
  "the grid font lives in a private folder of the run's own, removed afterwards",
  { skip: process.platform === "win32" && "the stand-in tools are POSIX scripts" },
  (t) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "hf-locate-")));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const temp = join(base, "tmp");
    mkdirSync(temp);
    const record = join(base, "fonts.jsonl");
    fakeTools(join(base, "bin"), record);

    const run = spawnSync(
      process.execPath,
      [LOCATE, "overlay", join(base, "in.png"), "--out", join(base, "out")],
      { env: { ...process.env, PATH: join(base, "bin"), TMPDIR: temp }, encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr);
    const fonts = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(fonts.length > 0);
    for (const { font, mode } of fonts) {
      assert.equal(relative(temp, font).startsWith(".."), false, font);
      assert.equal(mode, "700");
      assert.equal(existsSync(dirname(font)), false);
    }
  },
);
