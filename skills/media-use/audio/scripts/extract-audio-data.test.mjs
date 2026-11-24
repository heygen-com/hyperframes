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
// main() as the script runs it, with the analysis stubbed: numpy and ffmpeg are not what is under test.
const RUN = `import runpy, sys, types
sys.modules.setdefault("numpy", types.SimpleNamespace(ndarray=object))
sys.path.insert(0, sys.argv[1])
main = runpy.run_path(sys.argv[1] + "/extract-audio-data.py")["main"]
main.__globals__["extract"] = lambda path, fps, bands: {"totalFrames": 0, "bands": bands, "frames": []}
sys.argv = ["extract-audio-data.py", "in.mp3", "-o", sys.argv[2]]
main()`;

for (const [kind, plant] of [
  ["symbolic link", (target, at) => symlinkSync(target, at)],
  ["hard link", (target, at) => linkSync(target, at)],
]) {
  // fails without the fix: main() wrote with open(path, "w"), which truncates the target of a link at path.
  test(
    `extract-audio-data replaces a ${kind} at audio-data.json, never its target`,
    { skip: !python },
    (t) => {
      const dir = mkdtempSync(join(tmpdir(), "audio-data-link-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const victim = join(dir, "victim.txt");
      writeFileSync(victim, "victim");
      const out = join(dir, "audio-data.json");
      plant(victim, out);
      const result = spawnSync(python, ["-c", RUN, scripts, out], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(victim, "utf8"), "victim");
      assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), {
        totalFrames: 0,
        bands: 16,
        frames: [],
      });
      const entry = lstatSync(out);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.nlink, 1);
      assert.deepEqual(readdirSync(dir).sort(), ["audio-data.json", "victim.txt"]);
    },
  );
}
