import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addVersion, bindShareHost, withProjectShareLock } from "../src/index.mjs";

test("an upload reserves its in-process state before waiting for the file lock", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "share-start-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".hyperframes"));
  const file = join(dir, ".hyperframes/video.mp4");
  await writeFile(file, "video");
  bindShareHost({
    normalize: realpathSync,
    projectFingerprint: async () => "rendered",
    latestExportFile: () => ({ path: file, fingerprint: "rendered", id: "r1" }),
  });
  const states = [];
  let creates = 0;
  const request = {
    projectPath: dir,
    title: "Video",
    projectId: "project",
    probe: async () => ({ width: 100, height: 100, duration: 1 }),
    onProgress: (value) => states.push(value?.step ?? null),
    client: {
      createExport: async () => {
        creates++;
        return {
          status: "ready",
          video_id: "video",
          version_id: "version",
          exported_at: "2026-11-04T00:00:00Z",
        };
      },
    },
  };
  let pending;
  await withProjectShareLock(dir, "export", async () => {
    pending = addVersion(request);
    assert.deepEqual(states, ["preparing"]);
    assert.equal(await addVersion(request), null);
    assert.equal(creates, 0);
  });
  assert.equal(await pending, null);
  assert.equal(creates, 1);
  assert.equal(states.filter((state) => state === null).length, 1);
});
