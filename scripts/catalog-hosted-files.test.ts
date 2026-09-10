import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fetchHostedFiles } from "./catalog-hosted-files.js";

function fixture(url = "https://static.heygen.ai/asset", path = "asset.bin") {
  const root = mkdtempSync(join(tmpdir(), "hf-hosted-test-"));
  writeFileSync(join(root, "registry-item.json"), JSON.stringify({ files: [{ url, path }] }));
  return root;
}

test("downloads exact bytes through a relative CDN redirect", async (t) => {
  const root = fixture();
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      calls.push(String(url));
      assert.equal(options?.redirect, "manual");
      assert.ok(options?.signal);
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "/final" } })
        : new Response(new Uint8Array([0, 255, 42]));
    },
  );
  try {
    await fetchHostedFiles(root);
    assert.deepEqual(calls, ["https://static.heygen.ai/asset", "https://static.heygen.ai/final"]);
    assert.deepEqual(readFileSync(join(root, "asset.bin")), Buffer.from([0, 255, 42]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const location of [
  "http://169.254.169.254/meta",
  "https://localhost/x",
  "https://static.heygen.ai.evil.test/x",
  "http://static.heygen.ai/x",
]) {
  test(`rejects redirect to ${location} before a second request`, async (t) => {
    const root = fixture();
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    try {
      await assert.rejects(fetchHostedFiles(root), /HTTPS CDN/);
      assert.equal(mock.mock.callCount(), 1);
      assert.deepEqual(readdirSync(root), ["registry-item.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("rejects a non-CDN initial URL without a request", async (t) => {
  const root = fixture("https://127.0.0.1/x");
  const mock = t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected request"));
  try {
    await assert.rejects(fetchHostedFiles(root), /HTTPS CDN/);
    assert.equal(mock.mock.callCount(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enforces actual streaming bytes even when Content-Length understates them", async (t) => {
  const root = fixture();
  let cancelled = false;
  const chunk = new Uint8Array(129 * 1024 * 1024);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-length": "1" } },
      ),
  );
  try {
    await assert.rejects(fetchHostedFiles(root), /256 MiB/);
    assert.equal(cancelled, true);
    assert.deepEqual(readdirSync(root), ["registry-item.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const mode of ["declared oversize", "loop", "HTTP error", "stream error"]) {
  test(`${mode} preserves the existing asset`, async (t) => {
    const root = fixture();
    writeFileSync(join(root, "asset.bin"), "previous");
    let calls = 0;
    let cancelled = false;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      const body = new ReadableStream({
        start(controller) {
          if (mode === "stream error") controller.error(new Error("broken stream"));
        },
        cancel() {
          cancelled = true;
        },
      });
      if (mode === "loop")
        return new Response(body, { status: 302, headers: { location: "/asset" } });
      if (mode === "HTTP error") return new Response(body, { status: 500 });
      return new Response(body, {
        headers: {
          "content-length": mode === "declared oversize" ? String(257 * 1024 * 1024) : "1",
        },
      });
    });
    try {
      await assert.rejects(fetchHostedFiles(root), /256 MiB|redirect limit|HTTP 500|broken stream/);
      assert.equal(readFileSync(join(root, "asset.bin"), "utf8"), "previous");
      assert.equal(calls, mode === "loop" ? 6 : 1);
      if (mode !== "stream error") assert.equal(cancelled, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("skips manifest paths outside the copied project before fetching", async (t) => {
  const root = fixture("https://static.heygen.ai/asset", "../escape.bin");
  const mock = t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected request"));
  try {
    await fetchHostedFiles(root);
    assert.equal(mock.mock.callCount(), 0);
    assert.deepEqual(readdirSync(root), ["registry-item.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
