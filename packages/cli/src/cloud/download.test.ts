import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadToFile } from "./download.js";

function makeBytesFetch(bytes: Uint8Array, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(new Blob([bytes as unknown as BlobPart]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        ...headers,
      },
    })) as unknown as typeof fetch;
}

function makeErrorFetch(status: number, statusText = "Not Found"): typeof fetch {
  return (async () => new Response("nope", { status, statusText })) as unknown as typeof fetch;
}

describe("cloud/download", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-cloud-download-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams the response body to disk and returns the byte count", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const dest = join(dir, "out.bin");
    const result = await downloadToFile("https://example/x", dest, {
      fetchImpl: makeBytesFetch(payload, { "content-length": String(payload.length) }),
    });
    expect(result.path).toBe(dest);
    expect(result.bytes).toBe(payload.length);
    const written = readFileSync(dest);
    expect(written.equals(Buffer.from(payload))).toBe(true);
    expect(statSync(dest).size).toBe(payload.length);
  });

  it("creates the destination's parent directory if missing", async () => {
    const payload = new Uint8Array([42]);
    const dest = join(dir, "nested", "subdir", "file.mp4");
    const result = await downloadToFile("https://example/x", dest, {
      fetchImpl: makeBytesFetch(payload),
    });
    expect(result.bytes).toBe(1);
    expect(readFileSync(dest).at(0)).toBe(42);
  });

  it("reports progress with bytes downloaded and total when content-length is set", async () => {
    const payload = new Uint8Array(64);
    const dest = join(dir, "progress.bin");
    const calls: { bytes: number; total: number | undefined }[] = [];
    await downloadToFile("https://example/x", dest, {
      fetchImpl: makeBytesFetch(payload, { "content-length": "64" }),
      onProgress: (bytes, total) => calls.push({ bytes, total }),
    });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls.at(-1)!;
    expect(last.bytes).toBe(64);
    expect(last.total).toBe(64);
  });

  it("throws on non-2xx responses", async () => {
    const dest = join(dir, "missing.bin");
    await expect(
      downloadToFile("https://example/x", dest, {
        fetchImpl: makeErrorFetch(404),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
