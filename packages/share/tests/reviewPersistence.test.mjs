import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import fs, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addVersion,
  bindShareHost,
  changeSpace,
  pendingReviewExport,
  recheckHeld,
  reviewDestination,
  reviewFiles,
  reviewVersion,
  ReviewFailed,
  shareForReview,
} from "../src/index.mjs";

const site = "https://hyperframes.dev";
const projectId = "review-project";
const ready = (id) => ({
  status: "ready",
  video_id: `video-${id}`,
  version_id: `version-${id}`,
  exported_at: "2026-11-04T00:00:00Z",
});
const bind = (dir, exportId = "render") =>
  bindShareHost({
    normalize: realpathSync,
    channelSite: site,
    signinSites: [site],
    projectFingerprint: async () => "rendered",
    latestExportFile: () => ({
      path: join(dir, ".hyperframes", "video.mp4"),
      fingerprint: "rendered",
      id: exportId,
    }),
  });
const probe = async () => ({ width: 1920, height: 1080, duration: 1 });
const request = (dir, client) => ({ projectPath: dir, title: "Video", client, probe });

async function project(t) {
  const dir = await mkdtemp(join(tmpdir(), "hf-share-persistence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const metadata = join(dir, ".hyperframes");
  await mkdir(metadata);
  const render = join(metadata, "video.mp4");
  await writeFile(render, "first video");
  await writeFile(
    join(metadata, "review.json"),
    JSON.stringify({ studioProjectId: "studio", projectId, opened: true }),
  );
  bind(dir);
  return { dir, metadata, render, stateFile: join(metadata, "review-export.json") };
}

// Hold a real second process at the create request, after its pending state has been written.
function uploader(t, dir) {
  const moduleUrl = new URL("../src/index.mjs", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { once } from "node:events";
    import { realpathSync } from "node:fs";
    import { access } from "node:fs/promises";
    import { join } from "node:path";
    import { addVersion, bindShareHost } from ${JSON.stringify(moduleUrl)};
    const dir = process.argv[1];
    bindShareHost({
      normalize: realpathSync, channelSite: ${JSON.stringify(site)},
      projectFingerprint: async () => "rendered",
      latestExportFile: () => ({
        path: join(dir, ".hyperframes", "video.mp4"), fingerprint: "rendered", id: "render",
      }),
    });
    const locked = await access(join(dir, ".hyperframes", "review-export.lock"))
      .then(() => true, () => false);
    if (locked) process.send({ waiting: true });
    const failure = await addVersion({
      projectPath: dir, title: "Video",
      probe: async () => ({ width: 1920, height: 1080, duration: 1 }),
      client: {
        createExport: async (_id, body) => {
          const response = once(process, "message");
          process.send({ operationId: body.client_operation_id });
          await response;
          throw new Error("Create response lost");
        },
      },
    });
    assert.match(failure, /Couldn't add this version/);
    process.disconnect();
  `;
  const proc = spawn(process.execPath, ["--input-type=module", "-e", script, dir], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  proc.stderr.on("data", (data) => (stderr += data));
  const exited = once(proc, "exit");
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    await exited;
  });
  const next = async () => {
    const [message] = await Promise.race([once(proc, "message"), exited]);
    assert.equal(typeof message, "object", stderr);
    return message;
  };
  return {
    next,
    loseResponse: async () => {
      proc.send("lose response");
      const [code] = await exited;
      assert.equal(code, 0, stderr);
    },
  };
}

async function retry(dir, operationId) {
  const createExport = async (_id, body) => {
    assert.equal(body.client_operation_id, operationId);
    return ready("new");
  };
  assert.equal(await addVersion(request(dir, { createExport })), null);
  assert.equal(await pendingReviewExport(dir), null);
}

test("a refused replay keeps its original operation and offers to export a new video", async (t) => {
  const { dir, render, stateFile } = await project(t);
  const sends = [];
  const snapshot = { space_id: "space", composition_id: "comp", snapshot_id: "snap" };
  const client = {
    createExport: async (_id, body) => {
      sends.push(body);
      if (sends.length === 1) throw new ReviewFailed(503, "unavailable");
      if (sends.length < 4) throw new ReviewFailed(422, "snapshot_mismatch");
      return ready("new");
    },
  };
  const version = { ...request(dir, client), filesForExport: async () => snapshot };
  assert.match(await addVersion(version), /Try again/);
  for (let replay = 0; replay < 2; replay++) {
    assert.match(await addVersion(version), /change the export settings and export again/i);
    const failure = await reviewVersion(dir);
    assert.equal(failure.retryable, false);
    assert.equal(failure.exportHelps, true);
    assert.equal(JSON.parse(await readFile(stateFile, "utf8")).pending.unanswered, true);
  }
  assert.deepEqual(sends, [sends[0], sends[0], sends[0]]);
  assert.deepEqual(sends[0].snapshot, snapshot);

  await writeFile(render, "new export with different settings");
  bind(dir, "re-export");
  assert.equal((await reviewVersion(dir)).failure, null);
  assert.equal(await addVersion(version), null);
  assert.notEqual(sends[3].client_operation_id, sends[0].client_operation_id);
  assert.equal(await pendingReviewExport(dir), null);
});

test("a snapshot refusal on the first send still adds the video without files", async (t) => {
  const { dir } = await project(t);
  const snapshot = { space_id: "space", composition_id: "comp", snapshot_id: "snap" };
  const sends = [];
  const client = {
    createExport: async (_id, body) => {
      sends.push(body);
      if (sends.length === 1) throw new ReviewFailed(422, "snapshot_mismatch");
      return ready("fallback");
    },
  };
  assert.equal(
    await addVersion({ ...request(dir, client), filesForExport: async () => snapshot }),
    null,
  );
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].snapshot, snapshot);
  assert.equal(sends[1].snapshot, undefined);
  assert.notEqual(sends[1].client_operation_id, sends[0].client_operation_id);
});

for (const whileLocked of [true, false]) {
  test(
    `a stale held response preserves a newer export (uploader locked: ${whileLocked})`,
    { timeout: 5000 },
    async (t) => {
      const { dir, render } = await project(t);
      const api = {
        createExport: async () => ({
          ...ready("held"),
          status: "screening",
          screening_state: "held",
        }),
      };
      await addVersion({ ...request(dir, api), open: () => false });
      assert.equal((await reviewVersion(dir)).held, true);
      const readStarted = Promise.withResolvers();
      const readReply = Promise.withResolvers();
      const recheck = recheckHeld(dir, {
        readExport: async (id, video) => {
          assert.equal(id, projectId);
          assert.equal(video, "video-held");
          readStarted.resolve();
          return readReply.promise;
        },
      });
      await readStarted.promise;
      await writeFile(render, "newer video");
      const other = uploader(t, dir);
      const { operationId } = await other.next();
      assert.ok(operationId);
      if (!whileLocked) await other.loseResponse();
      readReply.resolve(ready("held"));
      await recheck;
      assert.equal((await pendingReviewExport(dir))?.operationId, operationId);
      if (whileLocked) await other.loseResponse();
      await retry(dir, operationId);
    },
  );
}

test(
  "attaching files cannot overwrite another process's pending export",
  { timeout: 5000 },
  async (t) => {
    const { dir, render, stateFile } = await project(t);
    assert.equal(await addVersion(request(dir, { createExport: async () => ready("old") })), null);
    const readStarted = Promise.withResolvers();
    const releaseRead = Promise.withResolvers();
    const originalRead = fs.readFile;
    let stateReads = 0;
    t.mock.method(fs, "readFile", async (file, ...args) => {
      const contents = await originalRead(file, ...args);
      // The first read chooses the target version. The second is the files flag's read before write.
      if (file === stateFile && ++stateReads === 2) {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return contents;
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const files = reviewFiles({
      client: { attachSnapshot: async () => {} },
      forRender: async () => ({ space_id: "space", composition_id: "comp", snapshot_id: "snap" }),
    });
    const attach = files.attach(dir);
    await readStarted.promise;
    await writeFile(render, "newer video");
    const other = uploader(t, dir);
    const first = await other.next();
    const uploaded = first.waiting ? other.next() : Promise.resolve(first);
    releaseRead.resolve();
    await attach;
    const { operationId } = await uploaded;
    assert.ok(operationId);
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(state.last.versionId, "version-old");
    assert.equal(state.last.files, true);
    assert.equal(state.pending?.body.client_operation_id, operationId);
    await other.loseResponse();
    await retry(dir, operationId);
  },
);

test("malformed review identities stay on disk and cannot register another share", async (t) => {
  const { dir, metadata } = await project(t);
  const file = join(metadata, "review.json");
  const register = t.mock.fn(async () => ({ project_id: "duplicate" }));
  const share = async () => ({
    project_id: "duplicate",
    review_url: `${site}/r/token`,
    access_mode: "public",
    default_role: "commenter",
  });
  for (const contents of [
    "{}",
    "[]",
    "null",
    '{"studioProjectId":"studio","projectId":123}',
    '{"studioProjectId":"studio","registration":{"studio_project_id":"studio"}}',
  ]) {
    await writeFile(file, contents);
    await assert.rejects(
      shareForReview({
        projectPath: dir,
        title: "Video",
        client: { register, share, spaces: async () => [], signedInEmail: async () => null },
      }),
      /review\.json could not be read.*Restore this file from a backup/,
    );
    assert.equal(await readFile(file, "utf8"), contents);
  }
  assert.equal(register.mock.callCount(), 0);
});

test("malformed export state keeps its bytes and refuses a new operation", async (t) => {
  const { dir, stateFile } = await project(t);
  t.mock.method(console, "error", () => {});
  const createExport = t.mock.fn(async () => ready("new"));
  for (const contents of [
    "{}",
    "[]",
    "null",
    '{"pending":{},"last":null}',
    '{"pending":{"videoId":null,"body":{"client_operation_id":"kept"}}}',
    '{"pending":null,"last":{"fingerprint":"rendered"}}',
  ]) {
    await writeFile(stateFile, contents);
    await assert.rejects(pendingReviewExport(dir), /review-export\.json could not be read/);
    assert.match(
      await addVersion(request(dir, { createExport })),
      /review-export\.json could not be read.*Restore this file from a backup/,
    );
    assert.equal(await readFile(stateFile, "utf8"), contents);
  }
  assert.equal(createExport.mock.callCount(), 0);
});

test("a saved version without a fingerprint is left untracked", async (t) => {
  const { dir, stateFile } = await project(t);
  const contents = JSON.stringify({
    pending: null,
    last: { versionId: "version", exportedAt: "2026-11-04T00:00:00Z", projectId },
  });
  await writeFile(stateFile, contents);
  assert.equal((await reviewVersion(dir)).last, null);
  assert.equal(await readFile(stateFile, "utf8"), contents);
});

test("an unopened removal record can refuse sharing without a server project ID", async (t) => {
  const { dir, metadata } = await project(t);
  const file = join(metadata, "review.json");
  const contents = JSON.stringify({
    studioProjectId: "studio",
    projectId: null,
    opened: false,
    removed: true,
  });
  await writeFile(file, contents);
  const spaces = t.mock.fn(async () => []);
  await assert.rejects(reviewDestination({ projectPath: dir, client: { spaces } }), {
    reason: "review_project_removed",
  });
  assert.equal(spaces.mock.callCount(), 0);
  assert.equal(await readFile(file, "utf8"), contents);
});

test("a malformed workspace switch journal cannot be replaced by a new move", async (t) => {
  const { dir, metadata } = await project(t);
  const file = join(metadata, "review.switch.json");
  const register = t.mock.fn();
  const share = t.mock.fn();
  const upload = t.mock.fn();
  for (const contents of ["{}", "[]", "null", '{"from":"review-project","body":{}}']) {
    await writeFile(file, contents);
    await assert.rejects(
      changeSpace({
        projectPath: dir,
        title: "Video",
        spaceId: "new-space",
        client: { register, share },
        upload,
        canUpload: async () => null,
      }),
      /review\.switch\.json could not be read.*Restore this file from a backup/,
    );
    assert.equal(await readFile(file, "utf8"), contents);
  }
  assert.equal(register.mock.callCount(), 0);
  assert.equal(share.mock.callCount(), 0);
  assert.equal(upload.mock.callCount(), 0);
});
