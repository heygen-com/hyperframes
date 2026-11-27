import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindShareHost, reviewVersion } from "../src/index.mjs";

// fails without the fix: the host's lookup was called without waiting, so a host that reads the disk off its main
// thread (a promise) read as no MP4, and Share said to export first.
test("a host whose export lookup answers later still offers its MP4 as ready", async (t) => {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), "share-async-lookup-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".hyperframes"));
  const file = join(dir, ".hyperframes/video.mp4");
  await writeFile(file, "video");
  bindShareHost({
    normalize: realpathSync,
    channelSite: "https://hyperframes.dev",
    projectFingerprint: async () => "rendered",
    latestExportFile: async () => ({ path: file, fingerprint: "rendered", id: "r1" }),
  });
  const version = await reviewVersion(dir);
  assert.equal(version.source, "ready");
  assert.equal(version.failure, null);
});
