import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { addVersion, bindShareHost, refreshReviewExport, ReviewFailed } from "../src/index.mjs";

const run = promisify(execFile);
const moduleUrl = new URL("../src/index.mjs", import.meta.url).href;
async function fixture(t) {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), "hf-failed-export-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(join(dir, ".hyperframes", "video.mp4"), "video");
  await writeFile(
    join(dir, ".hyperframes", "review.json"),
    JSON.stringify({
      studioProjectId: "studio",
      projectId: "project",
      opened: true,
    }),
  );
  bindShareHost({
    normalize: realpathSync,
    channelSite: "https://hyperframes.dev",
    projectFingerprint: async () => "rendered",
    latestExportFile: () => ({
      path: join(dir, ".hyperframes", "video.mp4"),
      fingerprint: "rendered",
      id: "render",
    }),
  });
  return dir;
}
async function readFromAnotherProcess(dir, fingerprint = "rendered", renderId = "render") {
  const script = `
    import { realpathSync } from 'node:fs';
    import { join } from 'node:path';
    import { bindShareHost, reviewVersion } from ${JSON.stringify(moduleUrl)};
    const [dir, fingerprint, renderId] = process.argv.slice(1);
    bindShareHost({ normalize: realpathSync, channelSite: 'https://hyperframes.dev',
      projectFingerprint: async () => fingerprint,
      latestExportFile: () => ({ path: join(dir, '.hyperframes', 'video.mp4'), fingerprint, id: renderId }),
    });
    console.log(JSON.stringify(await reviewVersion(dir)));
  `;
  const { stdout } = await run(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    dir,
    fingerprint,
    renderId,
  ]);
  return JSON.parse(stdout);
}
const pending = {
  projectId: "project",
  videoId: "failed-video",
  body: {
    title_snapshot: "Video",
    coordinate_width: 100,
    coordinate_height: 100,
    duration_seconds: 1,
    render_settings: {},
    source_revision_id: null,
    source_fingerprint: "rendered",
    local_upload: {
      checksum_sha256: createHash("sha256").update("video").digest("base64"),
      content_type: "video/mp4",
      size_bytes: 5,
    },
    client_operation_id: "operation",
  },
};
const ready = {
  status: "ready",
  video_id: "new-video",
  version_id: "new-version",
  exported_at: "2026-11-08T00:00:00Z",
};
for (const update of [false, true]) {
  test(`a rejected ${update ? "update" : "first export"} survives a new process until a successful retry`, async (t) => {
    const dir = await fixture(t);
    const file = join(dir, ".hyperframes", "review-export.json");
    const last = update
      ? {
          projectId: "project",
          versionId: "old-version",
          fingerprint: "old-render",
          exportedAt: "2026-11-07T00:00:00Z",
        }
      : null;
    await writeFile(file, JSON.stringify({ pending, last }));
    await refreshReviewExport(dir, {
      readExport: async () => ({
        status: "failed",
        error: { reason: "content_rejected", message: "raw-sensitive-message" },
      }),
    });
    const fresh = await readFromAnotherProcess(dir);
    assert.equal(fresh.failure, "This video can't be shared.");
    assert.equal(fresh.retryable, false);
    assert.equal(fresh.last?.exportedAt ?? null, last?.exportedAt ?? null);
    assert.equal((await readFromAnotherProcess(dir)).failure, fresh.failure);
    assert.equal((await readFromAnotherProcess(dir, "new-render")).failure, null);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.pending, null);
    assert.equal(JSON.stringify(saved).includes("raw-sensitive-message"), false);
    const error = await addVersion({
      projectPath: dir,
      projectId: "project",
      title: "Video",
      probe: async () => ({ width: 100, height: 100, duration: 1 }),
      client: { createExport: async () => ready },
    });
    assert.equal(error, null);
    const succeeded = await readFromAnotherProcess(dir);
    assert.equal(succeeded.failure, null);
    assert.equal(succeeded.last.exportedAt, ready.exported_at);
  });
}

test("malformed optional failure metadata is ignored and valid failures never follow another project", async (t) => {
  const dir = await fixture(t);
  const file = join(dir, ".hyperframes", "review-export.json");
  await writeFile(file, JSON.stringify({ pending, last: null }));
  await refreshReviewExport(dir, {
    readExport: async () => ({ status: "failed", error: { reason: "content_rejected" } }),
  });
  await writeFile(
    join(dir, ".hyperframes", "review.json"),
    JSON.stringify({
      studioProjectId: "other-studio",
      projectId: "other-project",
      opened: true,
    }),
  );
  assert.equal((await readFromAnotherProcess(dir)).failure, null);
  await writeFile(
    file,
    JSON.stringify({ pending: null, last: null, failure: { projectId: "other-project" } }),
  );
  assert.equal((await readFromAnotherProcess(dir)).failure, null);
});

test("a replacement render with the same source cannot inherit the failed upload", async (t) => {
  const dir = await fixture(t);
  await addVersion({
    projectPath: dir,
    projectId: "project",
    title: "Video",
    allowPending: true,
    open: () => false,
    probe: async () => ({ width: 100, height: 100, duration: 1 }),
    client: { createExport: async () => ({ status: "processing", video_id: "video" }) },
  });
  await refreshReviewExport(dir, {
    readExport: async () => ({ status: "failed", error: { reason: "content_rejected" } }),
  });
  assert.equal((await readFromAnotherProcess(dir)).failure, "This video can't be shared.");
  assert.equal((await readFromAnotherProcess(dir, "rendered", "new-render-id")).failure, null);
});

test("legacy pending uploads use the video checksum before binding a recovered failure", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, ".hyperframes", "review-export.json"),
    JSON.stringify({ pending, last: null }),
  );
  await writeFile(join(dir, ".hyperframes", "video.mp4"), "replacement-video");
  await refreshReviewExport(dir, {
    readExport: async () => ({ status: "failed", error: { reason: "content_rejected" } }),
  });
  assert.equal((await readFromAnotherProcess(dir)).failure, null);
});

test("malformed optional failure leaves a valid pending upload and previous version intact", async (t) => {
  const dir = await fixture(t);
  const file = join(dir, ".hyperframes", "review-export.json");
  const last = {
    projectId: "project",
    versionId: "old",
    fingerprint: "rendered",
    exportedAt: "before",
  };
  await writeFile(file, JSON.stringify({ pending, last, failure: { projectId: "project" } }));
  const value = await readFromAnotherProcess(dir);
  assert.equal(value.failure, null);
  assert.equal(value.last.exportedAt, "before");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).pending, pending);
});

for (const update of [false, true]) {
  test(`registration 403 for ${update ? "update" : "first share"} persists across processes and allows retry`, async (t) => {
    const dir = await fixture(t);
    const file = join(dir, ".hyperframes", "review-export.json");
    const last = update
      ? { projectId: "project", versionId: "old", fingerprint: "old", exportedAt: "2026-11-01" }
      : null;
    await writeFile(file, JSON.stringify({ pending: null, last }));
    const request = {
      projectPath: dir,
      projectId: "project",
      title: "Video",
      probe: async () => ({ width: 100, height: 100, duration: 1 }),
    };
    const failure = await addVersion({
      ...request,
      client: {
        createExport: async () => {
          throw new ReviewFailed(403, "export_blocked");
        },
      },
    });
    assert.match(failure, /moderation strikes/);
    const fresh = await readFromAnotherProcess(dir);
    assert.equal(fresh.failure, failure);
    assert.equal(fresh.retryable, false);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.pending, null);
    assert.deepEqual(saved.last, last);
    assert.equal(
      await addVersion({ ...request, client: { createExport: async () => ready } }),
      null,
    );
    assert.equal((await readFromAnotherProcess(dir)).failure, null);
  });
}
