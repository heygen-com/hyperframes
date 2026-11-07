import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, open, rm, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { uploadNeeded } from "../src/sources/uploadFiles.mjs";
import { partDigests, putRange } from "../src/sources/transfer.mjs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { bindShareHost } from "../src/host.mjs";

bindShareHost({ reviewUploadOrigins: ["https://store.test"] });

async function folder(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hf-source-upload-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const signal = () => new AbortController().signal;

test("multipart retries retain the pinned upload and skip completed parts after restart", async (t) => {
  const root = await folder(t);
  const file = join(root, "media.mp4");
  const size = 65 * 1024 * 1024;
  const handle = await open(file, "w");
  await handle.truncate(size);
  await handle.close();
  const digests = await partDigests(file, size, 64 * 1024 * 1024, signal());
  const inflight = { sent: [], multipart: {} };
  const requests = [];
  let fail = true;
  let persisted = 0;
  const job = {
    api: {
      uploadUrls: async (_space, _comp, _upload, files) => {
        requests.push(...files);
        return files.map((item) => ({
          sha256: item.sha256,
          multipartUploadId: "pinned",
          expiresAt: "2099-01-01T00:00:00Z",
          parts: item.parts.map((part) => ({
            ...part,
            url: `https://store.test/${part.partNumber}`,
            headers: { checksum: part.sha256 },
          })),
        }));
      },
    },
    space: "space",
    composition: "comp",
    uploadId: "upload",
    inflight,
    local: new Map([[digests.whole, { path: "media.mp4", full: file }]]),
    needed: [{ sha256: digests.whole, size }],
    fetchImpl: async (url, init) => {
      if (url.endsWith("/2") && fail) {
        await init.body.cancel();
        return new Response(null, { status: 400 });
      }
      const hash = createHash("sha256");
      for await (const chunk of init.body) hash.update(chunk);
      assert.equal(hash.digest("hex"), init.headers.checksum);
      return new Response(null, { status: 200 });
    },
    signal: signal(),
    wait: async () => {},
    now: Date.now,
    persist: () => persisted++,
    onBytes: () => {},
    onFile: () => {},
  };
  await assert.rejects(uploadNeeded(job), /refused/);
  assert.deepEqual(inflight.multipart[digests.whole].partsDone, [1]);
  fail = false;
  await uploadNeeded(job);
  assert.equal(requests[1].multipartUploadId, "pinned");
  assert.deepEqual(
    requests[1].parts.map((p) => p.partNumber),
    [2],
  );
  assert.deepEqual(inflight.sent, [digests.whole]);
  assert.ok(persisted >= 4);
});

test("signed URL expiry refreshes the grant without changing the uploaded content", async (t) => {
  const root = await folder(t);
  const file = join(root, "index.html");
  await writeFile(file, "source");
  const digest = createHash("sha256").update("source").digest("hex");
  let grants = 0;
  let puts = 0;
  await uploadNeeded({
    api: {
      uploadUrls: async () => {
        grants++;
        return [
          {
            sha256: digest,
            url: "https://store.test/file",
            headers: {},
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ];
      },
    },
    space: "s",
    composition: "c",
    uploadId: "u",
    inflight: { sent: [] },
    local: new Map([[digest, { path: "index.html", full: file }]]),
    needed: [{ sha256: digest, size: 6 }],
    fetchImpl: async (_url, init) => {
      puts++;
      await new Response(init.body).arrayBuffer();
      return new Response(null, { status: puts === 1 ? 403 : 200 });
    },
    signal: signal(),
    wait: async () => {},
    now: Date.now,
    persist: () => {},
    onBytes: () => {},
    onFile: () => {},
  });
  assert.equal(grants, 2);
  assert.equal(puts, 2);
});

test("storage PUT refuses a file swapped for a symlink before reading bytes", async (t) => {
  const root = await folder(t);
  const target = join(root, "private.txt");
  const file = join(root, "asset.txt");
  await writeFile(target, "secret");
  await symlink(target, file);
  let sent = false;
  await assert.rejects(
    putRange({
      file,
      path: "asset.txt",
      start: 0,
      length: 6,
      sha256: "wrong",
      signal: signal(),
      url: "https://store.test",
      headers: {},
      fetchImpl: async () => {
        sent = true;
        return new Response();
      },
    }),
  );
  assert.equal(sent, false);
});

test("source PUT refuses untrusted or redirected targets before it opens a file", async () => {
  for (const url of [
    "https://untrusted.test/source",
    "http://127.0.0.1:18080/source",
    "https://store.test.untrusted.test/source",
    "https://user:secret@store.test/source",
  ]) {
    await assert.rejects(
      putRange({
        file: "/missing-source",
        path: "index.html",
        start: 0,
        length: 6,
        sha256: "unused",
        signal: signal(),
        url,
        headers: {},
        fetchImpl: async () => assert.fail("Must not send bytes"),
      }),
      { kind: "refused" },
    );
  }
});

async function sourcePut(t, overrides = {}) {
  const root = await folder(t);
  const file = join(root, "index.html");
  await writeFile(file, "source");
  return {
    file,
    path: "index.html",
    start: 0,
    length: 6,
    sha256: createHash("sha256").update("source").digest("hex"),
    signal: signal(),
    url: "https://store.test/file",
    headers: {},
    ...overrides,
  };
}

for (const consume of [false, true]) {
  test(`source PUT times out when ${consume ? "the storage response" : "body consumption"} stalls`, async (t) => {
    let requestSignal;
    const put = await sourcePut(t, {
      stallMs: 20,
      signal: AbortSignal.timeout(2_000),
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        if (consume) await new Response(init.body).arrayBuffer();
        init.signal.throwIfAborted();
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      },
    });
    await assert.rejects(putRange(put), { kind: "transient" });
    assert.equal(requestSignal.aborted, true);
  });
}

test("source PUT preserves caller cancellation instead of retrying it", async (t) => {
  const controller = new AbortController();
  const cancelled = new DOMException("Sharing cancelled", "AbortError");
  await assert.rejects(
    putRange(
      await sourcePut(t, {
        signal: controller.signal,
        fetchImpl: async (_url, init) => {
          assert.equal(init.redirect, "error");
          await new Response(init.body).arrayBuffer();
          controller.abort(cancelled);
          throw init.signal.reason;
        },
      }),
    ),
    (error) => error === cancelled,
  );
});

test("successful source PUT clears its stall timer", async (t) => {
  let requestSignal;
  await putRange(
    await sourcePut(t, {
      stallMs: 200,
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        await new Response(init.body).arrayBuffer();
        return new Response(null, { status: 200 });
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(requestSignal.aborted, false);
});

test("source PUT closes its file when resolving its parent fails", async (t) => {
  const put = await sourcePut(t, { fetchImpl: async () => assert.fail("Must not send bytes") });
  const originalOpen = fsPromises.open;
  let opened;
  t.mock.method(fsPromises, "open", async (...args) => {
    opened = await originalOpen(...args);
    return opened;
  });
  t.mock.method(fsPromises, "realpath", async () => {
    throw Object.assign(new Error("Parent directory disappeared"), { code: "ENOENT" });
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(putRange(put), { code: "ENOENT" });
    assert.equal(opened.fd, -1, "source file handle was left open");
  } finally {
    await opened?.close();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
