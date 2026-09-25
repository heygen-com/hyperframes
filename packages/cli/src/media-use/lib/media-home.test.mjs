import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

test("a test that never points the media home anywhere fails instead of writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-home-guard-"));
  const probe = join(dir, "probe.test.mjs");
  const lib = fileURLToPath(new URL("./media-home.mjs", import.meta.url));
  writeFileSync(
    probe,
    `import { test } from "node:test";\nimport { globalMediaDir } from ${JSON.stringify(lib)};\ntest("reach", () => globalMediaDir());\n`,
  );
  const env = { ...process.env };
  delete env.HYPERFRAMES_MEDIA_HOME;
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", probe], { encoding: "utf8", env });
  assert.notEqual(run.status, 0, run.stdout);
  assert.match(`${run.stdout}${run.stderr}`, /set HYPERFRAMES_MEDIA_HOME to a temp dir/);
});
