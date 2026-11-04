import { describe, it, expect, onTestFinished, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HyperframesApiError } from "./_gen/client.js";
import type { HyperframesCloudClient } from "./_gen/client.js";
import { uploadAssetViaDirectUpload, uploadZipViaDirectUpload } from "./upload.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeClient(overrides: Partial<HyperframesCloudClient> = {}): HyperframesCloudClient {
  return {
    createAssetUpload: vi.fn(async () => ({
      asset_id: "asset_xyz",
      upload_url: "https://s3.example/asset_xyz?sig=abc",
      upload_headers: { "x-amz-checksum-sha256-b64": "..." },
      expires_in_seconds: 3600,
      max_bytes: 200 * 1024 * 1024,
      status: "pending_upload" as const,
    })),
    completeAssetUpload: vi.fn(async () => ({
      asset_id: "asset_xyz",
      url: "https://files.heygen.com/document/asset_xyz/original.zip",
      mime_type: "application/zip",
      size_bytes: 42,
      status: "processing" as const,
    })),
    ...overrides,
  } as unknown as HyperframesCloudClient;
}

function makeFetchOk(): typeof fetch {
  return vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
}

describe("uploadZipViaDirectUpload", () => {
  it("sends the correct filename, content_type, size_bytes, and SHA256 to createAssetUpload", async () => {
    const bytes = new TextEncoder().encode("hello-hyperframes-zip");
    const expectedSha = sha256Hex(bytes);
    const client = makeClient();
    const fetchImpl = makeFetchOk();

    await uploadZipViaDirectUpload({
      client,
      bytes,
      filename: "my-comp.zip",
      fetchImpl,
    });

    expect(client.createAssetUpload).toHaveBeenCalledOnce();
    const arg = (client.createAssetUpload as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.body).toEqual({
      filename: "my-comp.zip",
      content_type: "application/zip",
      size_bytes: bytes.byteLength,
      checksum_sha256: expectedSha,
    });
  });

  it("PUTs to the returned upload_url with the returned upload_headers verbatim + content-type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const client = makeClient({
      createAssetUpload: vi.fn(async () => ({
        asset_id: "asset_xyz",
        upload_url: "https://s3.example/target?sig=xxx",
        upload_headers: { "x-signed-header": "signed-value", "x-other": "other-value" },
        expires_in_seconds: 3600,
        max_bytes: 200 * 1024 * 1024,
        status: "pending_upload" as const,
      })) as HyperframesCloudClient["createAssetUpload"],
    });
    const fetchImpl = makeFetchOk();

    await uploadZipViaDirectUpload({ client, bytes, filename: "x.zip", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://s3.example/target?sig=xxx");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(bytes);
    expect(init.headers).toEqual({
      "content-type": "application/zip",
      "x-signed-header": "signed-value",
      "x-other": "other-value",
    });
  });

  it("does NOT attach CLI auth headers to the S3 PUT — presigned URL carries auth", async () => {
    const client = makeClient();
    const fetchImpl = makeFetchOk();

    await uploadZipViaDirectUpload({
      client,
      bytes: new Uint8Array([0]),
      filename: "x.zip",
      fetchImpl,
    });

    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    // No Authorization / x-api-key / Bearer header should be present.
    const headerKeys = Object.keys(init.headers as Record<string, string>).map((k) =>
      k.toLowerCase(),
    );
    expect(headerKeys).not.toContain("authorization");
    expect(headerKeys).not.toContain("x-api-key");
  });

  it("calls completeAssetUpload with the initialize's asset_id + same checksum", async () => {
    const bytes = new TextEncoder().encode("determinism");
    const expectedSha = sha256Hex(bytes);
    const client = makeClient();
    const fetchImpl = makeFetchOk();

    const result = await uploadZipViaDirectUpload({
      client,
      bytes,
      filename: "x.zip",
      fetchImpl,
    });

    expect(client.completeAssetUpload).toHaveBeenCalledOnce();
    const completeArg = (client.completeAssetUpload as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(completeArg.asset_id).toBe("asset_xyz");
    expect(completeArg.body).toEqual({ checksum_sha256: expectedSha });
    expect(result.asset_id).toBe("asset_xyz");
    expect(result.size_bytes).toBe(bytes.byteLength);
  });

  it("retries completeAssetUpload on 409 and succeeds on a later attempt", async () => {
    let completeCalls = 0;
    const completeAssetUpload = vi.fn(async () => {
      completeCalls++;
      if (completeCalls < 3) {
        throw new HyperframesApiError({
          status: 409,
          message: "Uploaded object not found yet. Retry after upload PUT returns 200.",
          code: "conflict",
        });
      }
      return {
        asset_id: "asset_xyz",
        url: "u",
        mime_type: "application/zip",
        size_bytes: 1,
        status: "processing" as const,
      };
    });
    const client = makeClient({
      completeAssetUpload:
        completeAssetUpload as unknown as HyperframesCloudClient["completeAssetUpload"],
    });

    const result = await uploadZipViaDirectUpload({
      client,
      bytes: new Uint8Array([0]),
      filename: "x.zip",
      fetchImpl: makeFetchOk(),
    });

    expect(completeCalls).toBe(3);
    expect(result.asset_id).toBe("asset_xyz");
  });

  it("surfaces non-409 errors from complete without retrying", async () => {
    let completeCalls = 0;
    const completeAssetUpload = vi.fn(async () => {
      completeCalls++;
      throw new HyperframesApiError({
        status: 400,
        message: "invalid checksum",
        code: "invalid_parameter",
      });
    });
    const client = makeClient({
      completeAssetUpload:
        completeAssetUpload as unknown as HyperframesCloudClient["completeAssetUpload"],
    });

    await expect(
      uploadZipViaDirectUpload({
        client,
        bytes: new Uint8Array([0]),
        filename: "x.zip",
        fetchImpl: makeFetchOk(),
      }),
    ).rejects.toThrow(/invalid checksum/);
    expect(completeCalls).toBe(1);
  });

  it("surfaces PUT failures with response body detail", async () => {
    const client = makeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response("SignatureDoesNotMatch: request signature we calculated does not match", {
          status: 403,
        }),
    ) as unknown as typeof fetch;

    await expect(
      uploadZipViaDirectUpload({
        client,
        bytes: new Uint8Array([0]),
        filename: "x.zip",
        fetchImpl,
      }),
    ).rejects.toThrow(/Direct upload PUT failed: 403.*SignatureDoesNotMatch/);
  });

  it("passes idempotencyKey through to createAssetUpload", async () => {
    const client = makeClient();
    await uploadZipViaDirectUpload({
      client,
      bytes: new Uint8Array([0]),
      filename: "x.zip",
      idempotencyKey: "test-key-123",
      fetchImpl: makeFetchOk(),
    });
    const arg = (client.createAssetUpload as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.idempotencyKey).toBe("test-key-123");
  });

  it("emits progress events in order", async () => {
    const client = makeClient();
    const events: Array<{ phase: string }> = [];
    await uploadZipViaDirectUpload({
      client,
      bytes: new Uint8Array([0]),
      filename: "x.zip",
      fetchImpl: makeFetchOk(),
      onProgress: (e) => events.push({ phase: e.phase }),
    });
    expect(events.map((e) => e.phase)).toEqual(["initialize", "upload", "upload", "complete"]);
  });
});

describe("uploadAssetViaDirectUpload from a file on disk", () => {
  async function withServer(
    status: number,
    run: (url: string, got: { headers?: IncomingHttpHeaders; body?: Buffer }) => Promise<void>,
  ): Promise<void> {
    const got: { headers?: IncomingHttpHeaders; body?: Buffer } = {};
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      Object.assign(got, { headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status).end(status === 200 ? "" : "SignatureDoesNotMatch");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/put`, got);
    } finally {
      server.close();
    }
  }

  function fileOnDisk(bytes: Buffer): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-upload-test-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "clip.mp4"), bytes);
    return join(dir, "clip.mp4");
  }

  const clientFor = (url: string) =>
    makeClient({
      createAssetUpload: vi.fn(async () => ({
        asset_id: "asset_xyz",
        upload_url: url,
        upload_headers: {},
        expires_in_seconds: 3600,
        max_bytes: 200 * 1024 * 1024,
        status: "pending_upload" as const,
      })),
    } as Partial<HyperframesCloudClient>);

  it("hashes the file and PUTs it as a stream with its exact length", async () => {
    const bytes = Buffer.from("a file far too big to read whole, in miniature");
    const path = fileOnDisk(bytes);
    await withServer(200, async (url, got) => {
      const client = clientFor(url);
      await uploadAssetViaDirectUpload({
        client,
        path,
        size: bytes.byteLength,
        filename: "clip.mp4",
        contentType: "video/mp4",
      });
      expect(client.createAssetUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ checksum_sha256: sha256Hex(bytes) }),
        }),
      );
      expect(got.body?.equals(bytes)).toBe(true);
      expect(got.headers?.["content-length"]).toBe(String(bytes.byteLength));
      expect(got.headers?.["content-type"]).toBe("video/mp4");
    });
  });

  it("reports the status of a refused PUT", async () => {
    const path = fileOnDisk(Buffer.from("bytes"));
    await withServer(403, async (url) => {
      await expect(
        uploadAssetViaDirectUpload({
          client: clientFor(url),
          path,
          size: 5,
          filename: "clip.mp4",
          contentType: "video/mp4",
        }),
      ).rejects.toThrow(/Direct upload PUT failed: 403.*SignatureDoesNotMatch/);
    });
  });
});
