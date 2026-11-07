import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile, symlink, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  shareSources,
  shareSourceFingerprint,
  createProjectShareSourceStore,
} from "../src/shareSources.mjs";
import { projectFingerprint } from "../src/projectSnapshot.mjs";
import { captureProject } from "../src/sources/capture.mjs";
import { sourceApi } from "../src/sources/api.mjs";
import { SyncApiError } from "../src/sources/errors.mjs";
import { V1_LIMITS } from "../src/sources/limits.mjs";
import { bindShareHost } from "../src/host.mjs";

bindShareHost({ reviewUploadOrigins: ["https://storage.test"] });

const signed = {
  token: "test-token",
  owner: "owner",
  heygen: "https://app.test",
  heygenApi: "https://api.test",
};
async function fixture(t, files = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hf-source-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.html"), "<html>video</html>");
  for (const [file, content] of Object.entries(files)) await writeFile(join(root, file), content);
  const rendered = await projectFingerprint(root);
  const store = createProjectShareSourceStore();
  return {
    root,
    rendered,
    store,
    key: { backend: signed.heygenApi, account: signed.owner, projectPath: root },
  };
}
function fakeServer(overrides = {}) {
  const calls = { create: 0, begin: [], puts: [], submit: 0, snapshot: 0 };
  let held;
  let composition;
  const receipt = (status = "pending") => ({
    uploadId: "upload",
    compositionId: composition,
    snapshotId: "snapshot",
    status,
    errorCode: null,
    baseSnapshotId: null,
    resolvesConflictSnapshotIds: [],
    manifestSha256: held.manifest.sha256,
    uploadDeadline: "2099-01-01T00:00:00Z",
    verificationDeadline: null,
    completedAt: null,
    result:
      status === "completed"
        ? {
            snapshotId: "snapshot",
            publicationOutcome: "published",
            conflictedWithSnapshotId: null,
          }
        : null,
  });
  const api = {
    limits: async () => ({
      at: "read",
      syncAllowed: true,
      maxCompositions: 5,
      compositions: 0,
      push: V1_LIMITS,
    }),
    create: async (_space, id) => {
      calls.create++;
      composition = id;
      return { id };
    },
    begin: async (_space, id, request) => {
      composition = id;
      held = request;
      calls.begin.push(request);
      return { ...receipt(), created: true, present: [], needed: request.manifest.document.files };
    },
    uploadUrls: async (_space, _comp, _upload, files) =>
      files.map((file) => ({
        ...file,
        url: `https://storage.test/${file.sha256}`,
        headers: {},
        expiresAt: "2099-01-01T00:00:00Z",
        parts: [],
      })),
    submit: async () => {
      calls.submit++;
      return receipt("completed");
    },
    status: async () => receipt("completed"),
    snapshot: async (_space, id, snapshot) => {
      calls.snapshot++;
      return {
        id: snapshot,
        compositionId: id,
        manifestSha256: held.manifest.sha256,
        manifest: held.manifest,
        publicationOutcome: "published",
      };
    },
    ...overrides,
  };
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.authorization, undefined);
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), url.split("/").at(-1));
    calls.puts.push(bytes);
    return new Response(null, { status: 200 });
  };
  return { api, calls, fetchImpl, receipt };
}

for (const path of [".media/voice.mp3", ".hyperframes/studio-manual-edits.json"]) {
  test(`changing ${path} refuses source preparation and final attachment to the old render`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.root, "index.html"), '<audio src=".media/voice.mp3"></audio>');
    await mkdir(dirname(join(f.root, path)), { recursive: true });
    await writeFile(join(f.root, path), "original");
    const rendered = await projectFingerprint(f.root);
    const content = await shareSourceFingerprint(f.root);
    const server = fakeServer();
    const source = shareSources({
      access: async () => signed,
      spaceId: "personal",
      ...server,
      fingerprint: async (root) =>
        content === (await shareSourceFingerprint(root)) ? projectFingerprint(root) : null,
    });
    await writeFile(join(f.root, path), "changed");
    assert.equal(await projectFingerprint(f.root), rendered);
    assert.equal((await source.prepare(f.root, rendered)).reason, "source_render_changed");
    assert.equal(server.calls.begin.length, 0);
    assert.equal(await source.filesForExport(f.root, rendered), null);
    await writeFile(join(f.root, path), "original");
    assert.equal((await source.prepare(f.root, rendered)).at, "ready");
    assert.ok(await source.filesForExport(f.root, rendered));
    await writeFile(join(f.root, path), "changed after preparation");
    assert.equal(await source.filesForExport(f.root, rendered), null);
  });
}

test("source upload verifies before attachment and a fresh adapter reuses the exact published snapshot", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const options = { access: async () => signed, spaceId: "personal", ...server };
  const source = shareSources(options);
  assert.equal(await source.filesForExport(f.root, f.rendered), null);
  const result = await source.prepare(f.root, f.rendered);
  assert.equal(result.at, "ready");
  assert.equal(server.calls.puts.length, 1);
  assert.equal(server.calls.submit, 1);
  assert.deepEqual(await source.filesForExport(f.root, f.rendered), result.snapshot);
  assert.equal((await shareSources(options).prepare(f.root, f.rendered)).at, "ready");
  assert.equal(server.calls.begin.length, 1);
  assert.equal(server.calls.snapshot, 1);
  const binding = await f.store.read(f.key);
  assert.equal(binding.inflight, null);
  assert.equal(binding.base.snapshotId, "snapshot");
});

test("changed assets invalidate prepared source even when the HTML render fingerprint stays unchanged", async (t) => {
  const f = await fixture(t, { "media.mp4": "first" });
  const source = shareSources({
    access: async () => signed,
    spaceId: "personal",
    ...fakeServer(),
    fingerprint: async () => f.rendered,
  });
  assert.equal((await source.prepare(f.root, f.rendered)).at, "ready");
  await writeFile(join(f.root, "media.mp4"), "other");
  assert.equal(await source.filesForExport(f.root, f.rendered), null);
});

test("eligibility and busy edits refuse before creating cloud compositions", async (t) => {
  const f = await fixture(t);
  const server = fakeServer({ limits: async () => ({ syncAllowed: false }) });
  assert.deepEqual(
    await shareSources({ access: async () => signed, spaceId: "personal", ...server }).prepare(
      f.root,
      f.rendered,
    ),
    { at: "unavailable", reason: "source_plan_required" },
  );
  assert.equal(server.calls.create, 0);
  await mkdir(join(f.root, ".hyperframes"), { recursive: true });
  await writeFile(join(f.root, ".hyperframes/history-turn.json"), "{}");
  const next = fakeServer();
  assert.equal(
    (
      await shareSources({ access: async () => signed, spaceId: "personal", ...next }).prepare(
        f.root,
        f.rendered,
      )
    ).reason,
    "source_edit_in_progress",
  );
  assert.equal(next.calls.create, 0);
});

test("lost Begin response retries the durable idempotency key, without creating a second composition", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const begin = server.api.begin;
  let fail = true;
  server.api.begin = async (...args) => {
    const answer = await begin(...args);
    if (fail) {
      fail = false;
      throw new Error("network lost");
    }
    return answer;
  };
  const opts = { access: async () => signed, spaceId: "personal", ...server };
  await assert.rejects(shareSources(opts).prepare(f.root, f.rendered), /network lost/);
  assert.equal((await shareSources(opts).prepare(f.root, f.rendered)).at, "ready");
  assert.equal(server.calls.begin[0].idempotencyKey, server.calls.begin[1].idempotencyKey);
  assert.deepEqual(server.calls.begin[0].manifest, server.calls.begin[1].manifest);
});

test("confirmed expired upload clears its intent so a retry starts with a new key", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const begin = server.api.begin;
  server.api.begin = async (...args) => {
    const answer = await begin(...args);
    return server.calls.begin.length === 1 ? { ...answer, status: "expired" } : answer;
  };
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });

  assert.equal((await source.prepare(f.root, f.rendered)).reason, "source_upload_expired");
  assert.equal((await f.store.read(f.key)).inflight, null);
  assert.equal((await source.prepare(f.root, f.rendered)).at, "ready");
  assert.notEqual(server.calls.begin[0].idempotencyKey, server.calls.begin[1].idempotencyKey);
});

test("an unwritable pending upload is cancelled so unchanged files can retry with a new key", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const grants = server.api.uploadUrls;
  server.api.uploadUrls = async () => {
    throw new SyncApiError("file-not-writable");
  };
  server.api.status = async () => server.receipt("pending");
  let cancelled = 0;
  server.api.cancel = async () => {
    cancelled++;
    return { ...server.receipt("failed"), errorCode: "cancelled" };
  };
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
  assert.equal((await source.prepare(f.root, f.rendered)).reason, "source_upload_not_writable");
  assert.equal(cancelled, 1);
  assert.equal((await f.store.read(f.key)).inflight, null);
  server.api.uploadUrls = grants;
  assert.equal((await source.prepare(f.root, f.rendered)).at, "ready");
  assert.notEqual(server.calls.begin[0].idempotencyKey, server.calls.begin[1].idempotencyKey);
});

for (const status of ["verifying", "completed"]) {
  test(`unwritable recovery retains an upload that raced cancellation into ${status}`, async (t) => {
    const f = await fixture(t);
    const server = fakeServer();
    server.api.uploadUrls = async () => {
      throw new SyncApiError("file-not-writable");
    };
    let reads = 0;
    server.api.status = async () => {
      const receipt = server.receipt(++reads === 1 ? "pending" : status);
      if (receipt.result) receipt.result.publicationOutcome = "conflict_saved";
      return receipt;
    };
    server.api.cancel = async () => {
      throw new SyncApiError("upload-not-pending");
    };
    const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
    assert.equal(
      (await source.prepare(f.root, f.rendered)).reason,
      status === "verifying" ? "source_verification_pending" : "source_conflict",
    );
    assert.equal((await f.store.read(f.key)).inflight.uploadId, "upload");
    assert.equal(server.calls.begin.length, 1);
  });
}

test("changed source cancels the previous pending upload before using a new key", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const submit = server.api.submit;
  server.api.submit = async () => {
    throw new Error("lost connection");
  };
  server.api.status = async () => server.receipt("pending");
  let cancelled = 0;
  server.api.cancel = async () => {
    cancelled++;
    return { ...server.receipt("failed"), errorCode: "cancelled" };
  };
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });

  await assert.rejects(source.prepare(f.root, f.rendered), /lost connection/);
  await writeFile(join(f.root, "index.html"), "<html>updated</html>");
  server.api.submit = submit;
  assert.equal((await source.prepare(f.root, await projectFingerprint(f.root))).at, "ready");
  assert.equal(cancelled, 1);
  assert.notEqual(server.calls.begin[0].idempotencyKey, server.calls.begin[1].idempotencyKey);
});

test("conflict and pending verification cannot be attached and keep recovery intent", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  server.api.submit = async () => ({
    ...server.receipt("completed"),
    result: { snapshotId: "snapshot", publicationOutcome: "conflict_saved" },
  });
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
  assert.equal((await source.prepare(f.root, f.rendered)).reason, "source_conflict");
  assert.equal(await source.filesForExport(f.root, f.rendered), null);
  assert.ok((await f.store.read(f.key)).inflight);
  server.api.submit = async () => server.receipt("verifying");
  const pending = shareSources({
    access: async () => signed,
    spaceId: "personal",
    ...server,
    verificationTimeoutMs: 0,
  });
  assert.equal((await pending.prepare(f.root, f.rendered)).reason, "source_verification_pending");
});

test("Desktop-owned source is read-only and never re-shared into a different workspace", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const capture = await captureProject(f.root);
  const binding = {
    ...f.key,
    version: 1,
    compositionId: "desktop",
    ownerSpaceId: "team",
    base: { manifestSha256: capture.manifest.sha256, snapshotId: "desktop-snapshot" },
    inflight: null,
  };
  const opts = {
    access: async () => signed,
    spaceId: "personal",
    existingBinding: async () => binding,
    ...server,
  };
  assert.equal(
    (await shareSources(opts).prepare(f.root, f.rendered)).reason,
    "source_other_workspace",
  );
  binding.ownerSpaceId = "personal";
  binding.sharedFrom = { reviewProjectId: "someone-elses-share" };
  assert.equal(
    (await shareSources(opts).prepare(f.root, f.rendered)).reason,
    "source_owned_by_someone_else",
  );
  assert.equal(server.calls.create, 0);
});

test("binding reads reject copied folders, account changes, and symlink state files", async (t) => {
  const f = await fixture(t);
  await shareSources({ access: async () => signed, spaceId: "personal", ...fakeServer() }).prepare(
    f.root,
    f.rendered,
  );
  await assert.rejects(f.store.read({ ...f.key, account: "other" }), /another account/);
  const g = await fixture(t);
  const hash = createHash("sha256").update(signed.heygenApi).digest("hex").slice(0, 16);
  const name = `.hyperframes/share-sync.${hash}.json`;
  await mkdir(join(g.root, ".hyperframes"));
  await writeFile(join(g.root, name), await readFile(join(f.root, name)));
  await assert.rejects(g.store.read(g.key), /another account/);
  await rm(join(g.root, name));
  await symlink(join(f.root, name), join(g.root, name));
  await assert.rejects(g.store.read(g.key));
});

test("HTTP adapter identifies CLI and sends credentials only to the API host", async () => {
  const requests = [];
  const api = sourceApi({
    access: async () => signed,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        data: {
          upload_id: "up",
          composition_id: "comp",
          snapshot_id: "snap",
          status: "pending",
          manifest_sha256: "hash",
          upload_deadline: "2099-01-01T00:00:00Z",
        },
      });
    },
  });
  await api.begin("space", "comp", {
    idempotencyKey: "key",
    baseSnapshotId: null,
    manifest: { sha256: "hash", document: {} },
  });
  assert.equal(JSON.parse(requests[0].init.body).client_type, "cli");
  assert.equal(requests[0].init.headers.authorization, "Bearer test-token");
  assert.match(requests[0].url, /^https:\/\/api.test\/v3\//);
});
