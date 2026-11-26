import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  rename,
  symlink,
  mkdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  shareSources,
  shareSourceFingerprint,
  createProjectShareSourceStore,
} from "../src/shareSources.mjs";
import { projectFingerprint, referencedHiddenDigest } from "../src/projectSnapshot.mjs";
import { captureProject } from "../src/sources/capture.mjs";
import { sourceApi } from "../src/sources/api.mjs";
import { SyncApiError } from "../src/sources/errors.mjs";
import { parseStoredManifest } from "../src/sources/manifest.mjs";
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
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
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

test("read-only sharing never starts or recovers an upload and attaches only an exact published snapshot", async (t) => {
  const f = await fixture(t);
  const server = fakeServer();
  const options = { access: async () => signed, spaceId: "personal", ...server };
  const read = shareSources({ ...options, reuseOnly: true });
  assert.equal((await read.prepare(f.root, f.rendered)).reason, "source_sync_required");
  assert.equal(server.calls.create, 0);
  assert.deepEqual(server.calls.begin, []);
  const synced = await shareSources(options).prepare(f.root, f.rendered);
  assert.equal(synced.at, "ready");
  assert.deepEqual(await read.prepare(f.root, f.rendered), synced);
  assert.deepEqual(await read.filesForExport(f.root, f.rendered), synced.snapshot);
  const saved = await f.store.read(f.key);
  await f.store.write({ ...saved, ownerSpaceId: "moved" });
  assert.equal(await read.filesForExport(f.root, f.rendered), null);
  await f.store.write(saved);
  assert.equal(
    (
      await shareSources({ ...options, reuseOnly: true, spaceId: "other" }).prepare(
        f.root,
        f.rendered,
      )
    ).at,
    "unavailable",
  );
  await writeFile(join(f.root, "index.html"), "updated");
  assert.equal(await read.filesForExport(f.root, f.rendered), null);
  assert.equal(
    (await read.prepare(f.root, await projectFingerprint(f.root))).reason,
    "source_sync_required",
  );
  assert.equal(server.calls.begin.length, 1);
  assert.equal(server.calls.puts.length, 1);
});

test("source preparation silently omits private files and folders at any depth", async (t) => {
  const names = [
    ".git/config",
    ".env-production",
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pypirc",
    "pip.conf",
    "pip.ini",
    ".netrc",
    "_netrc",
    ".git-credentials",
    ".gitconfig",
    ".mcp.json",
    "credentials.json",
    "serviceaccountkey.json",
    "service-account.json",
    "service_account.json",
    "id_rsa",
    "id_dsa.old",
    "id_ecdsa",
    "id_ed25519",
    "file.pem",
    "file.key",
    "file.p12",
    "file.pfx",
    "file.p8",
    "file.ppk",
    "file.jks",
    "file.keystore",
    "file.kdbx",
    "terraform.tfstate",
    "terraform.tfstate.backup",
    "dev.tfvars",
    "dev.tfvars.json",
    "mixed/SERVICE-ACCOUNT.JSON",
    ".ssh/config",
    ".aws/config",
    ".gnupg/state",
    ".docker/config",
    ".kube/config",
    ".azure/state",
    ".claude/state",
    ".codex/state",
    ".cursor/state",
    ".agents/state",
    ".gemini/state",
    ".vscode/state",
    ".idea/state",
    ".config/gh/state",
    ".config/gcloud/state",
  ];
  const paths = names.flatMap((name) => [name, `nested/${name}`]);
  const f = await fixture(t, {
    ...Object.fromEntries(paths.map((path) => [path, "omitted fixture"])),
    ".media/cover.png": "art",
    "nested/project.json": "{}",
  });
  const server = fakeServer();
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
  const result = await source.prepare(f.root, f.rendered);
  assert.equal(result.at, "ready");
  assert.deepEqual(
    server.calls.begin[0].manifest.document.files.map((file) => file.path),
    [".media/cover.png", "index.html", "nested/project.json"],
  );
  assert.deepEqual(server.calls.puts.map((bytes) => bytes.toString()).sort(), [
    "<html>video</html>",
    "art",
    "{}",
  ]);
  assert.deepEqual(Object.keys(result).sort(), ["at", "snapshot"]);
  assert.deepEqual(await source.filesForExport(f.root, f.rendered), result.snapshot);
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
  const html = '<img src=".art/cover.png">';
  const f = await fixture(t, { "index.html": html, ".art/cover.png": "cover" });
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
  const opts = {
    access: async () => signed,
    spaceId: "personal",
    expectedReferencedHiddenDigest: referencedHiddenDigest([".art/cover.png"]),
    ...server,
  };
  await assert.rejects(shareSources(opts).prepare(f.root, f.rendered), /network lost/);
  assert.equal((await shareSources(opts).prepare(f.root, f.rendered)).at, "ready");
  assert.equal(server.calls.begin[0].idempotencyKey, server.calls.begin[1].idempotencyKey);
  assert.deepEqual(server.calls.begin[0].manifest, server.calls.begin[1].manifest);
  assert.deepEqual(server.calls.puts.map(String).sort(), [html, "cover"].sort());
  assert.equal(server.calls.submit, 1);
});

test("a lost Begin for marked hidden assets reconciles publication before uploading the changed project", async (t) => {
  const f = await fixture(t, {
    "index.html": '<img src=".art/first.png">',
    ".art/first.png": "first image",
  });
  const server = fakeServer();
  const begin = server.api.begin;
  server.api.begin = async (...args) => {
    const receipt = await begin(...args);
    if (server.calls.begin.length === 1) throw new Error("lost Begin response");
    if (args[2].idempotencyKey === server.calls.begin[0].idempotencyKey)
      return {
        ...receipt,
        uploadId: "original-upload",
        snapshotId: "original-snapshot",
        status: "completed",
        result: { snapshotId: "original-snapshot", publicationOutcome: "published" },
      };
    return receipt;
  };
  const options = {
    access: async () => signed,
    spaceId: "personal",
    expectedReferencedHiddenDigest: referencedHiddenDigest([".art/first.png"]),
    ...server,
  };
  const first = shareSources(options);
  await assert.rejects(first.prepare(f.root, f.rendered), /lost Begin response/);
  const original = server.calls.begin[0];
  const saved = (await f.store.read(f.key)).inflight;
  assert.equal(saved.uploadId, null);
  assert.equal(
    saved.manifest.files.find(({ path }) => path === ".art/first.png").include_hidden,
    true,
  );
  const html = '<p>Updated title</p><img src=".art/first.png">';
  await writeFile(join(f.root, "index.html"), html);
  const rendered = await projectFingerprint(f.root);
  const second = shareSources(options);
  const published = await second.prepare(f.root, rendered);
  assert.equal(published.at, "ready");
  assert.deepEqual(await second.filesForExport(f.root, rendered), published.snapshot);
  assert.equal(server.calls.begin.length, 3);
  const [, replay, current] = server.calls.begin;
  assert.equal(replay.idempotencyKey, original.idempotencyKey);
  assert.deepEqual(replay.manifest, original.manifest);
  assert.equal(current.baseSnapshotId, "original-snapshot");
  assert.notEqual(current.idempotencyKey, original.idempotencyKey);
  assert.deepEqual(
    current.manifest.document.files.map(({ path }) => path),
    [".art/first.png", "index.html"],
  );
  assert.deepEqual(server.calls.puts.map(String).sort(), [html, "first image"].sort());
  assert.equal(server.calls.submit, 1);
  assert.equal((await f.store.read(f.key)).inflight, null);
});

for (const change of ["reference removed", "bytes changed"]) {
  test(`an unconfirmed Begin omits previously marked assets after ${change}`, async (t) => {
    const { listReferencedHiddenSourceAssets, referencedHiddenDigest } =
      await import("@hyperframes/share/projectSnapshot.mjs");
    const html = '<img src=".art/first.png">';
    const f = await fixture(t, { "index.html": html, ".art/first.png": "original" });
    const server = fakeServer();
    const options = { access: async () => signed, spaceId: "personal", ...server };
    const adapter = async () =>
      shareSources({
        ...options,
        expectedReferencedHiddenDigest: referencedHiddenDigest(
          await listReferencedHiddenSourceAssets(f.root),
        ),
      });
    const begin = server.api.begin;
    server.api.begin = async (...args) => {
      await begin(...args);
      throw new Error("lost Begin response");
    };
    const originalShare = await adapter();
    await assert.rejects(originalShare.prepare(f.root, f.rendered), /lost Begin response/);
    const original = server.calls.begin[0];
    if (change === "reference removed") await writeFile(join(f.root, "index.html"), "edited");
    else await writeFile(join(f.root, ".art/first.png"), "updated");
    server.api.begin = begin;
    const run = await adapter();
    const rendered = await projectFingerprint(f.root);
    if (change === "reference removed") {
      assert.equal(
        (await originalShare.prepare(f.root, rendered)).reason,
        "source_hidden_assets_changed",
      );
      assert.equal(server.calls.begin.length, 1);
    }
    assert.equal((await run.prepare(f.root, rendered)).at, "ready");
    assert.equal(server.calls.begin.length, 2);
    const current = server.calls.begin[1];
    assert.notEqual(current.idempotencyKey, original.idempotencyKey);
    assert.deepEqual(
      current.manifest.document.files.map(({ path }) => path),
      change === "reference removed" ? ["index.html"] : [".art/first.png", "index.html"],
    );
    assert.deepEqual(
      server.calls.puts.map(String).sort(),
      change === "reference removed" ? ["edited"] : [html, "updated"].sort(),
    );
  });
}

for (const file of [
  { path: ".docker/config.json" },
  { path: ".docker/private.png", include_hidden: true },
  { path: ".art/old.png" },
  { path: "regular.png", include_hidden: true },
]) {
  test(`an unconfirmed Begin cannot replay ${JSON.stringify(file)}`, async (t) => {
    const f = await fixture(t);
    const server = fakeServer();
    const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
    const begin = server.api.begin;
    server.api.begin = async () => {
      throw new Error("offline");
    };
    await assert.rejects(source.prepare(f.root, f.rendered), /offline/);
    const binding = await f.store.read(f.key);
    const saved = binding.inflight;
    const legacy = parseStoredManifest({
      ...saved.manifest,
      files: [...saved.manifest.files, { ...file, size: 7, sha256: "a".repeat(64) }],
    });
    binding.inflight = { ...saved, manifest: legacy.document, manifestSha256: legacy.sha256 };
    await f.store.write(binding);
    server.api.begin = begin;
    assert.equal((await source.prepare(f.root, f.rendered)).at, "ready");
    assert.equal(server.calls.begin.length, 1);
    assert.notEqual(server.calls.begin[0].idempotencyKey, saved.idempotencyKey);
    assert.ok(
      server.calls.begin[0].manifest.document.files.every(({ path }) => path !== file.path),
    );
  });
}

async function interruptedV4Share(t) {
  const oldName = "co\u200dver.svg";
  const f = await fixture(t, { "cover.svg": "cover", [oldName]: "alternate" });
  // Saved by v4 after Begin lost its response, before an upload ID was recorded.
  const binding = JSON.parse(
    await readFile(new URL("./fixtures/interrupted-v4-share.json", import.meta.url), "utf8"),
  );
  binding.projectPath = f.root;
  await f.store.write(binding);
  return { ...f, binding, oldName };
}

test("retrying an interrupted v4 share after correcting a filename publishes the new capture", async (t) => {
  const f = await interruptedV4Share(t);
  const server = fakeServer();
  const options = { access: async () => signed, spaceId: "personal", ...server };
  assert.equal(await shareSourceFingerprint(f.root), null);

  await rename(join(f.root, f.oldName), join(f.root, "alternate.svg"));
  const rendered = await projectFingerprint(f.root);
  const source = shareSources(options);
  const result = await source.prepare(f.root, rendered);
  assert.equal(result.at, "ready");
  assert.equal(result.snapshot.composition_id, f.binding.compositionId);
  assert.deepEqual(await source.filesForExport(f.root, rendered), result.snapshot);
  assert.equal(server.calls.begin.length, 1);
  const [request] = server.calls.begin;
  assert.notEqual(request.idempotencyKey, f.binding.inflight.idempotencyKey);
  assert.deepEqual(
    request.manifest.document.files.map(({ path }) => path),
    ["alternate.svg", "cover.svg", "index.html"],
  );
  assert.deepEqual(server.calls.puts.map((bytes) => bytes.toString()).sort(), [
    "<html>video</html>",
    "alternate",
    "cover",
  ]);
  const binding = await f.store.read(f.key);
  assert.equal(binding.inflight, null);
  assert.equal(binding.base.manifestSha256, request.manifest.sha256);
});

test("a corrected v4 project publishes a new snapshot on its original base", async (t) => {
  const f = await interruptedV4Share(t);
  const { manifest, manifestSha256 } = f.binding.inflight;
  const base = { snapshotId: "published-v4", manifest, manifestSha256 };
  await rename(join(f.root, f.oldName), join(f.root, "alternate.svg"));

  const rendered = await projectFingerprint(f.root);
  const server = fakeServer();
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
  await f.store.write({
    ...f.binding,
    base: { ...base, manifestSha256: "0".repeat(64) },
    inflight: null,
  });
  await assert.rejects(f.store.read(f.key), /Invalid source base snapshot/);
  await f.store.write({ ...f.binding, base, inflight: null });
  assert.deepEqual((await f.store.read(f.key)).base, base);
  const result = await source.prepare(f.root, rendered);
  assert.equal(result.at, "ready");
  assert.equal(result.snapshot.composition_id, f.binding.compositionId);
  assert.deepEqual(await source.filesForExport(f.root, rendered), result.snapshot);
  assert.equal(server.calls.begin.length, 1);
  const [request] = server.calls.begin;
  assert.equal(request.baseSnapshotId, base.snapshotId);
  assert.deepEqual(
    request.manifest.document.files.map(({ path }) => path),
    ["alternate.svg", "cover.svg", "index.html"],
  );
  assert.equal((await f.store.read(f.key)).base.manifestSha256, request.manifest.sha256);
});

async function confirmedV4Share(t) {
  const f = await interruptedV4Share(t);
  const saved = f.binding.inflight;
  Object.assign(saved, { uploadId: "v4-upload", snapshotId: "v4-snapshot" });
  await f.store.write(f.binding);
  await rename(join(f.root, f.oldName), join(f.root, "alternate.svg"));
  const rendered = await projectFingerprint(f.root);
  const receipt = {
    uploadId: saved.uploadId,
    snapshotId: saved.snapshotId,
    compositionId: f.binding.compositionId,
    manifestSha256: saved.manifestSha256,
    status: "pending",
    result: null,
  };
  const server = fakeServer();
  const source = shareSources({ access: async () => signed, spaceId: "personal", ...server });
  return { ...f, server, source, rendered, receipt };
}

test("a confirmed v4 upload that publishes during cancellation parents only the corrected share", async (t) => {
  const { root, rendered, receipt, server, source, key, store, binding } =
    await confirmedV4Share(t);
  const events = [];
  let status = "pending";
  server.api.status = async (...ids) => {
    assert.deepEqual(ids, [binding.ownerSpaceId, binding.compositionId, receipt.uploadId]);
    events.push(status);
    return {
      ...receipt,
      status,
      result:
        status === "completed"
          ? {
              snapshotId: receipt.snapshotId,
              publicationOutcome: "published",
            }
          : null,
    };
  };
  server.api.cancel = async (...ids) => {
    assert.deepEqual(ids, [binding.ownerSpaceId, binding.compositionId, receipt.uploadId]);
    events.push("cancel");
    status = "verifying";
    throw new SyncApiError("upload-not-pending");
  };

  assert.equal((await source.prepare(root, rendered)).reason, "source_verification_pending");
  assert.deepEqual((await store.read(key)).inflight, binding.inflight);
  assert.equal(await source.filesForExport(root, rendered), null);
  assert.equal(server.calls.begin.length, 0);
  assert.equal(server.calls.puts.length, 0);

  status = "completed";
  const result = await source.prepare(root, rendered);
  assert.deepEqual(events, ["pending", "cancel", "verifying", "completed"]);
  assert.equal(result.at, "ready");
  assert.notEqual(result.snapshot.snapshot_id, receipt.snapshotId);
  assert.deepEqual(await source.filesForExport(root, rendered), result.snapshot);
  assert.equal(server.calls.begin.length, 1);
  const [request] = server.calls.begin;
  assert.equal(request.baseSnapshotId, receipt.snapshotId);
  assert.notEqual(request.idempotencyKey, binding.inflight.idempotencyKey);
  assert.deepEqual(
    request.manifest.document.files.map(({ path }) => path),
    ["alternate.svg", "cover.svg", "index.html"],
  );
  assert.deepEqual(server.calls.puts.map((bytes) => bytes.toString()).sort(), [
    "<html>video</html>",
    "alternate",
    "cover",
  ]);
  assert.equal((await store.read(key)).base.snapshotId, result.snapshot.snapshot_id);
});

for (const status of ["pending", "failed", "expired"]) {
  test(`a ${status} confirmed v4 upload can be replaced after a filename correction`, async (t) => {
    const { root, rendered, receipt, server, source, binding } = await confirmedV4Share(t);
    server.api.status = async () => ({ ...receipt, status });
    let cancellations = 0;
    server.api.cancel = async () => {
      cancellations++;
      return { ...receipt, status: "failed", errorCode: "cancelled" };
    };
    assert.equal((await source.prepare(root, rendered)).at, "ready");
    assert.equal(cancellations, status === "pending" ? 1 : 0);
    assert.equal(server.calls.begin.length, 1);
    const [request] = server.calls.begin;
    assert.equal(request.baseSnapshotId, null);
    assert.notEqual(request.idempotencyKey, binding.inflight.idempotencyKey);
    assert.equal(request.manifest.sha256, await shareSourceFingerprint(root));
  });
}

test("mismatched receipts leave a confirmed v4 upload intact", async (t) => {
  const { root, rendered, receipt, server, source, key, store, binding } =
    await confirmedV4Share(t);
  for (const [field, error] of [
    ["uploadId", /upload receipt identity/],
    ["snapshotId", /snapshot identity/],
    ["compositionId", /composition/],
    ["manifestSha256", /captured project/],
  ]) {
    server.api.status = async () => ({ ...receipt, [field]: "other" });
    server.api.cancel = async () => assert.fail("cannot cancel a mismatched upload");
    await assert.rejects(source.prepare(root, rendered), error);
    assert.deepEqual(await store.read(key), binding);
  }
  server.api.status = async () => {
    throw new SyncApiError("not-found");
  };
  await assert.rejects(source.prepare(root, rendered), /not-found/);
  assert.deepEqual(await store.read(key), binding);
  server.api.status = async () => receipt;
  server.api.cancel = async () => ({ ...receipt, status: "failed", uploadId: "other" });
  await assert.rejects(source.prepare(root, rendered), /upload receipt identity/);
  assert.deepEqual(await store.read(key), binding);
  assert.equal(server.calls.begin.length, 0);
  assert.equal(server.calls.puts.length, 0);
});

test("an incompatible pending manifest requires a matching checksum and a complete ID pair", async (t) => {
  const f = await interruptedV4Share(t);
  const saved = f.binding.inflight;
  for (const [change, error] of [
    [{ manifestSha256: "0".repeat(64) }, /checksum/],
    [{ uploadId: "known-upload" }, /identity/],
    [{ snapshotId: "known-snapshot" }, /identity/],
    [
      { uploadId: "known-upload", snapshotId: "known-snapshot", manifestSha256: "0".repeat(64) },
      /checksum/,
    ],
    [
      {
        manifest: {
          ...saved.manifest,
          files: saved.manifest.files.map((file) => ({ ...file, include_hidden: 1 })),
        },
      },
      /invalid_schema/,
    ],
    [{ manifest: { ...saved.manifest, extra: true } }, /invalid_schema/],
  ]) {
    await f.store.write({ ...f.binding, inflight: { ...saved, ...change } });
    await assert.rejects(f.store.read(f.key), error);
  }
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

for (const rules of ["draft.txt", "draft.txt\n/art/.images/*\n!/art/.images/keep.png\n!/.ssh/"]) {
  test(`gitignore source capture, upload and export honor ${JSON.stringify(rules)}`, async (t) => {
    const { listReferencedHiddenSourceAssets, referencedHiddenDigest } =
      await import("@hyperframes/share/projectSnapshot.mjs");
    const html = '<img src="art/.images/keep.png"><img src=".ssh/private.png">';
    const f = await fixture(t, {
      ".hyperframesignore": rules,
      "index.html": html,
      "art/.images/keep.png": "shared image",
      "nested/draft.txt": "excluded ordinary file",
      ".ssh/private.png": "private image",
    });
    const selection = { ignoreSyntax: "gitignore" };
    const paths = await listReferencedHiddenSourceAssets(f.root, undefined, selection);
    assert.deepEqual(paths, ["art/.images/keep.png"]);
    const server = fakeServer();
    const source = shareSources({
      access: async () => signed,
      spaceId: "personal",
      ...server,
      ...selection,
      expectedReferencedHiddenDigest: referencedHiddenDigest(paths),
    });
    const prepared = await source.prepare(f.root, f.rendered);
    assert.equal(prepared.at, "ready");
    const manifest = server.calls.begin[0].manifest;
    assert.deepEqual(
      manifest.document.files.map((entry) => [entry.path, !!entry.include_hidden]),
      [
        [".hyperframesignore", false],
        ["art/.images/keep.png", true],
        ["index.html", false],
      ],
    );
    assert.deepEqual(server.calls.puts.map(String).sort(), [rules, "shared image", html].sort());
    assert.equal(await shareSourceFingerprint(f.root, selection), manifest.sha256);
    assert.deepEqual(await source.filesForExport(f.root, f.rendered), prepared.snapshot);
  });
}

test("gitignore source preparation rereads exclusions after disclosure, on retry and on export", async (t) => {
  const { listReferencedHiddenSourceAssets, referencedHiddenDigest } =
    await import("@hyperframes/share/projectSnapshot.mjs");
  const f = await fixture(t, {
    ".hyperframesignore": "/drafts/\n",
    "index.html": '<img src=".images/first.png"><img src="drafts/.images/other.png">',
    ".images/first.png": "shown",
    "drafts/.images/other.png": "undisclosed",
  });
  const ignore = join(f.root, ".hyperframesignore");
  const selection = { ignoreSyntax: "gitignore" };
  const paths = await listReferencedHiddenSourceAssets(f.root, undefined, selection);
  assert.deepEqual(paths, [".images/first.png"]);
  const server = fakeServer();
  const source = shareSources({
    access: async () => signed,
    spaceId: "personal",
    // Keep the render identity fixed to exercise each source check independently.
    fingerprint: async () => f.rendered,
    ...selection,
    expectedReferencedHiddenDigest: referencedHiddenDigest(paths),
    ...server,
  });
  await writeFile(ignore, "/other/\n");
  assert.equal((await source.prepare(f.root, f.rendered)).reason, "source_hidden_assets_changed");
  assert.equal(server.calls.begin.length, 0);
  await writeFile(ignore, "/drafts/\n");
  const begin = server.api.begin;
  server.api.begin = async () => {
    throw new Error("offline");
  };
  await assert.rejects(source.prepare(f.root, f.rendered), /offline/);
  server.api.begin = begin;
  await writeFile(ignore, "/other/\n");
  assert.equal((await source.prepare(f.root, f.rendered)).reason, "source_hidden_assets_changed");
  assert.equal(server.calls.puts.length, 0);
  await writeFile(ignore, "/drafts/\n");
  assert.equal((await source.prepare(f.root, f.rendered)).at, "ready");
  await writeFile(ignore, "/other/\n");
  assert.equal(await source.filesForExport(f.root, f.rendered), null);
});

test("editable sharing sends just the reachable hidden assets, with exact bytes", async (t) => {
  const { listReferencedHiddenSourceAssets, referencedHiddenDigest } =
    await import("@hyperframes/share/projectSnapshot.mjs");
  const html =
    '<link rel="stylesheet" href="styles/brand.css"><img src="brand/.fonts/link.png"><img src=".config/gh/secret.png"><img src="ignore/.assets/other.png">';
  const css = '@import "../brand/.fonts/face.css";';
  const face = '@font-face{font-family:Inter;src:url("Inter%20Regular.woff2?v=1")}';
  const font = "brand/.fonts/Inter Regular.woff2";
  const f = await fixture(t, {
    "index.html": html,
    "styles/brand.css": css,
    "brand/.fonts/face.css": face,
    [font]: "font bytes",
    "brand/.fonts/unused.woff2": "unreferenced",
    ".config/gh/secret.png": "private",
    ".hyperframesignore": "ignore/.assets/\n",
    "ignore/.assets/other.png": "ignored",
  });
  await symlink(join(f.root, font), join(f.root, "brand/.fonts/link.png"));
  const paths = await listReferencedHiddenSourceAssets(f.root);
  assert.deepEqual(paths, [font, "brand/.fonts/face.css"]);
  const server = fakeServer();
  const options = {
    access: async () => signed,
    spaceId: "personal",
    ...server,
  };
  assert.equal(
    (await shareSources(options).prepare(f.root, f.rendered)).reason,
    "source_hidden_assets_changed",
  );
  const stale = shareSources({
    ...options,
    expectedReferencedHiddenDigest: referencedHiddenDigest([]),
  });
  assert.equal((await stale.prepare(f.root, f.rendered)).reason, "source_hidden_assets_changed");
  assert.equal(server.calls.begin.length, 0);
  const run = shareSources({
    ...options,
    expectedReferencedHiddenDigest: referencedHiddenDigest(paths),
  });
  assert.equal((await run.prepare(f.root, f.rendered)).at, "ready");
  assert.deepEqual(
    server.calls.begin[0].manifest.document.files
      .filter((file) => file.include_hidden)
      .map((file) => file.path),
    paths,
  );
  assert.deepEqual(
    server.calls.puts.map((bytes) => bytes.toString()).sort(),
    [html, css, face, "font bytes", "ignore/.assets/\n"].sort(),
  );
  assert.ok(await run.filesForExport(f.root, f.rendered));
  await writeFile(join(f.root, font), "new font bytes");
  assert.equal(await run.filesForExport(f.root, f.rendered), null);
});

test("dependency discovery follows local HTML, script and CSS resources from the entrypoint", async (t) => {
  const { listReferencedHiddenSourceAssets } =
    await import("@hyperframes/share/projectSnapshot.mjs");
  const f = await fixture(t, {
    "index.html":
      '<div data-composition-src="scenes/scene.html"></div><a href=".images/unused.png">link</a><!-- <img src=".images/unused.png"> -->',
    "scenes/scene.html":
      '<script type="module" src="scripts/app.js"></script><img srcset="../.images/small.png 1x, ../.images/big.png 2x">',
    "scenes/scripts/app.js":
      'import "../../.images/imported.js"; new URL("../../.images/module.png", import.meta.url); fetch("../.images/fetched.png"); const example = "../.images/unused.png";',
    ".images/imported.js": 'import "./imported.js";',
    "unused.html": '<img src=".images/unused.png">',
    ...Object.fromEntries(
      ["small", "big", "module", "fetched", "unused"].map((name) => [
        ".images/" + name + ".png",
        name,
      ]),
    ),
  });
  assert.deepEqual(await listReferencedHiddenSourceAssets(f.root), [
    ".images/big.png",
    ".images/fetched.png",
    ".images/imported.js",
    ".images/module.png",
    ".images/small.png",
  ]);
});

test("editable composition variables include asset values and leave free text local", async (t) => {
  const { listReferencedHiddenSourceAssets } =
    await import("@hyperframes/share/projectSnapshot.mjs");
  const decl = JSON.stringify([
    { id: "image", label: "Cover", type: "image", default: { url: ".brand/cover.png" } },
    { id: "poster", label: "Poster", type: "string", default: ".brand/fallback.png" },
    { id: "caption", label: "Caption", type: "string", default: ".brand/example.png" },
  ]);
  const html = `<div data-composition-id="main" data-composition-variables='${decl}' data-variable-values='{"poster":".brand/override.png"}'><img data-var-src="poster"></div>`;
  const f = await fixture(t, {
    "index.html": html,
    ...Object.fromEntries(
      ["cover", "fallback", "example", "override"].map((name) => [".brand/" + name + ".png", name]),
    ),
  });
  assert.deepEqual(await listReferencedHiddenSourceAssets(f.root), [
    ".brand/cover.png",
    ".brand/override.png",
  ]);
});

test("editable source sends child media bound by each host's variable values", async (t) => {
  const shape = JSON.stringify([
    { id: "cover", type: "image", label: "Cover", default: "visible.png" },
    { id: "caption", type: "string", label: "Caption", default: "Visible title" },
  ]);
  const host = (
    cover,
    audio,
  ) => `<div data-composition-id="card" data-composition-src="/scenes/card.html"
    data-variable-values='${JSON.stringify({ cover: { url: cover }, audio, caption: ".media-src/free.png" })}'></div>`;
  const html =
    '<!doctype html><html><head><base href="/show/"></head><body>' +
    host(".media-src/first.png", ".media-src/voice.mp3") +
    host(".media-src/second.png", ".docker/never.mp3") +
    host(".media-src/ignored.png", "https://example.org/remote.mp3") +
    "</body></html>";
  const card = `<html><body><div data-composition-id="card" data-composition-variables='${shape}'>
    <img data-var-src="cover"><audio data-var-src="audio"></audio><span data-var-text="caption"></span></div></body></html>`;
  const f = await fixture(t, {
    "index.html": html,
    "scenes/card.html": card,
    "show/.media-src/first.png": "first",
    "show/.media-src/second.png": "second",
    "show/.media-src/voice.mp3": "voice",
    "show/.media-src/free.png": "free",
    "scenes/.media-src/first.png": "wrong base",
    "show/.docker/never.mp3": "private",
    "show/.media-src/ignored.png": "ignored",
    ".hyperframesignore": "show/.media-src/ignored.png\n",
  });
  const { listReferencedHiddenSourceAssets, referencedHiddenDigest } =
    await import("../src/projectSnapshot.mjs");
  const disclosed = await listReferencedHiddenSourceAssets(f.root);
  const server = fakeServer();
  const service = shareSources({
    access: async () => signed,
    spaceId: "personal",
    expectedReferencedHiddenDigest: referencedHiddenDigest(disclosed),
    store: f.store,
    api: server.api,
    fetchImpl: server.fetchImpl,
  });
  assert.equal((await service.prepare(f.root, f.rendered)).at, "ready");
  const paths = server.calls.begin[0].manifest.document.files
    .filter((f) => f.include_hidden)
    .map((f) => f.path);
  assert.deepEqual(paths, [
    "show/.media-src/first.png",
    "show/.media-src/second.png",
    "show/.media-src/voice.mp3",
  ]);
  assert.deepEqual(
    server.calls.puts.map((bytes) => bytes.toString()).sort(),
    [html, card, "first", "second", "voice", "show/.media-src/ignored.png\n"].sort(),
  );
});
