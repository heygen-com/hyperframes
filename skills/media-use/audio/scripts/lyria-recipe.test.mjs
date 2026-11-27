import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0,
);
// The WAV write as generate_bgm runs it; the Lyria session before it is not what is under test.
const RUN = `import runpy, sys
from pathlib import Path
write_wav = runpy.run_path(sys.argv[1] + "/lyria-recipe.py")["write_wav"]
write_wav(Path(sys.argv[2]), bytes(8))`;

for (const [kind, plant] of [
  ["symbolic link", (target, at) => symlinkSync(target, at)],
  ["dangling symbolic link", (target, at) => symlinkSync(`${target}.missing`, at)],
  ["hard link", (target, at) => linkSync(target, at)],
]) {
  // fails without the fix: generate_bgm wrote with wave.open(path, "wb"), which truncates the target of a link at path.
  test(
    `lyria-recipe replaces a ${kind} at the output name, never its target`,
    { skip: !python },
    (t) => {
      const dir = mkdtempSync(join(tmpdir(), "lyria-link-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const victim = join(dir, "victim.txt");
      writeFileSync(victim, "victim");
      const out = join(dir, "bgm.wav");
      plant(victim, out);
      const result = spawnSync(python, ["-c", RUN, scripts, out], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(victim, "utf8"), "victim");
      const wav = readFileSync(out);
      assert.equal(wav.subarray(0, 4).toString("latin1"), "RIFF");
      assert.equal(wav.length, 44 + 8);
      const entry = lstatSync(out);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.nlink, 1);
      assert.deepEqual(readdirSync(dir).sort(), ["bgm.wav", "victim.txt"]);
    },
  );
}

const posix = process.platform !== "win32";

/** A file's permissions and bytes, read through one handle. */
function modeAndBytes(path) {
  const file = openSync(path, "r");
  try {
    return [fstatSync(file).mode & 0o777, readFileSync(file)];
  } finally {
    closeSync(file);
  }
}

// fails without the fix: the new file came out with default permissions, so a private WAV became readable by others.
test(
  "lyria-recipe keeps the permissions of the WAV it replaces",
  { skip: !python || !posix },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lyria-mode-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, "bgm.wav");
    writeFileSync(out, "old", { mode: 0o600 });
    const result = spawnSync(python, ["-c", RUN, scripts, out], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const [mode, wav] = modeAndBytes(out);
    assert.equal(mode, 0o600);
    assert.equal(wav.length, 44 + 8);
    assert.deepEqual(readdirSync(dir), ["bgm.wav"]);
  },
);

// fails without the fix: the rename replaced a WAV that may not be written, which the write in place refused.
test(
  "lyria-recipe refuses a read-only WAV at the output name and leaves it as it was",
  { skip: !python || !posix || process.getuid() === 0 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lyria-readonly-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, "bgm.wav");
    writeFileSync(out, "old", { mode: 0o444 });
    const result = spawnSync(python, ["-c", RUN, scripts, out], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PermissionError/);
    assert.deepEqual(modeAndBytes(out), [0o444, Buffer.from("old")]);
    assert.deepEqual(readdirSync(dir), ["bgm.wav"]);
  },
);

// fails without the fix: the temp file was created with default permissions and published as it was.
test(
  "lyria-recipe creates its temp file owner-only and gives a new WAV the default permissions",
  { skip: !python || !posix },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lyria-new-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, "bgm.wav");
    const seen = `import os, runpy, sys
from pathlib import Path
recipe = runpy.run_path(sys.argv[1] + "/lyria-recipe.py")
real = os.fchmod
def fchmod(fd, mode):
    print(oct(os.fstat(fd).st_mode & 0o777), oct(mode))
    real(fd, mode)
os.fchmod = fchmod
os.umask(0o027)
recipe["write_wav"](Path(sys.argv[2]), bytes(8))`;
    const result = spawnSync(python, ["-c", seen, scripts, out], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "0o600 0o640");
    assert.equal(lstatSync(out).mode & 0o777, 0o640);
  },
);
