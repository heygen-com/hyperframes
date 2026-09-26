import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cachePut } from "./cache.mjs";
import { globalMediaDir } from "./media-home.mjs";

const HOME = mkdtempSync(join(tmpdir(), "media-home-"));
process.env.HYPERFRAMES_MEDIA_HOME = HOME;

test("the global cache writes into the media home a test points it at", () => {
  const work = mkdtempSync(join(tmpdir(), "media-home-src-"));
  const file = join(work, "clip.wav");
  writeFileSync(file, "media-home regression bytes");
  cachePut(file, { id: "bgm_001", type: "bgm", provenance: { prompt: "media home probe" } });
  const manifest = join(HOME, ".media", "manifest.jsonl");
  assert.ok(existsSync(manifest), "the temp media home holds the global manifest");
  assert.match(readFileSync(manifest, "utf8"), /media home probe/);
  assert.equal(globalMediaDir(), join(HOME, ".media"));
});

// A child process that resolves the media dir, with only the given media-home variables set.
function runProbe(env) {
  const lib = new URL("./media-home.mjs", import.meta.url).href;
  const childEnv = { ...process.env };
  delete childEnv.HYPERFRAMES_MEDIA_HOME;
  delete childEnv.HYPERFRAMES_MEDIA_HOME_REQUIRED;
  delete childEnv.NODE_TEST_CONTEXT;
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(lib)}); console.log("dir=" + m.globalMediaDir());`,
    ],
    { encoding: "utf8", env: { ...childEnv, ...env } },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("a repo test run that never points the media home anywhere fails instead of writing", () => {
  const { status, output } = runProbe({ HYPERFRAMES_MEDIA_HOME_REQUIRED: "1" });
  assert.notEqual(status, 0, output);
  assert.match(output, /set HYPERFRAMES_MEDIA_HOME to a temp dir/);
});

// Node sets NODE_TEST_CONTEXT for every project's test runs, so another project whose own tests
// spawn this CLI must get the person's real library, not the guard.
test("another project's node --test run still resolves the real media home", () => {
  const home = mkdtempSync(join(tmpdir(), "media-home-user-"));
  const { status, output } = runProbe({
    HOME: home,
    USERPROFILE: home,
    NODE_TEST_CONTEXT: "child-v8",
  });
  assert.equal(status, 0, output);
  assert.ok(output.includes(`dir=${join(home, ".media")}`), output);
});
