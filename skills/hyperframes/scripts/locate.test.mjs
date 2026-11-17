import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const LOCATE = join(dirname(fileURLToPath(import.meta.url)), "locate.mjs");
const posixOnly = { skip: process.platform === "win32" && "the stand-in tools are POSIX scripts" };

// Stand-ins for ffprobe and ffmpeg. ffmpeg records its filter and the mode of each folder in
// TMPDIR, and with STOP_LOCATE set it sends that signal to the script that started it.
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "hf-locate-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // Characters ffmpeg's filter syntax treats as special, in the folder the font copy goes in.
  const temp = join(base, "t'm,p:[x];y");
  const bin = join(base, "bin");
  mkdirSync(temp);
  mkdirSync(bin);
  const record = join(base, "calls.jsonl");
  const tools = {
    ffprobe: `console.log("90,90");`,
    ffmpeg: `const { appendFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const temp = process.env.TMPDIR;
const folders = readdirSync(temp).map((name) => [name, (statSync(join(temp, name)).mode & 0o777).toString(8)]);
const filter = process.argv[process.argv.indexOf("-vf") + 1];
appendFileSync(${JSON.stringify(record)}, JSON.stringify({ filter, folders }) + "\\n");
if (process.env.STOP_LOCATE) process.kill(process.ppid, process.env.STOP_LOCATE);`,
  };
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(join(bin, name), `#!${process.execPath}\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const run = (env = {}) =>
    spawnSync(process.execPath, [LOCATE, "overlay", join(base, "in.png"), "--out", base], {
      env: { ...process.env, PATH: bin, TMPDIR: temp, ...env },
      encoding: "utf8",
    });
  const calls = () =>
    readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { base, temp, run, calls };
}

// The fixture's TMPDIR as the filter must spell it: ' and : escaped for the option list, then
// every backslash and ' [ ] , ; escaped again for the filtergraph.
const FILTER_TEMP = String.raw`t\\\'m\,p\\:\[x\]\;y`;

test(
  "the grid font lives in a private folder of the run's own, removed afterwards",
  posixOnly,
  (t) => {
    const { base, temp, run, calls } = fixture(t);

    const result = run();

    assert.equal(result.status, 0, result.stderr);
    for (const { filter, folders } of calls()) {
      assert.equal(folders.length, 1);
      const [[name, mode]] = folders;
      assert.match(name, /^locate-font-/);
      assert.equal(mode, "700");
      assert.ok(filter.includes(`fontfile=${base}/${FILTER_TEMP}/${name}/font.ttf:`), filter);
    }
    assert.deepEqual(readdirSync(temp), []);
  },
);

test("a stopped run removes its font folder", posixOnly, (t) => {
  const { temp, run, calls } = fixture(t);

  run({ STOP_LOCATE: "SIGTERM" });

  assert.ok(calls().length > 0);
  assert.deepEqual(readdirSync(temp), []);
});
