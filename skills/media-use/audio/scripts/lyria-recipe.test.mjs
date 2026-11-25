import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  lstatSync,
  mkdtempSync,
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
