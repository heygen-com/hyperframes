import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HyperframesApiError } from "./_gen/client.js";
import type { HyperframesCloudClient } from "./_gen/client.js";
import { putTimings, uploadAssetViaDirectUpload, type UploadProgressEvent } from "./upload.js";

const MIB = 1024 * 1024;
const PART = 4 * MIB;
const RATE_BYTES_PER_MS = 8 * 1024;

let dir: string;
let server: Server;
let base: string;
let received: Map<number, number>;
let puts: number[];
let cutAfterMs: number | undefined;
let cutOnce: Set<number>;
const saved = { ...putTimings };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hf-parts-"));
  process.env["HYPERFRAMES_CONFIG_DIR"] = join(dir, "config");
  Object.assign(putTimings, { stallMs: 5000, backoffMs: 5, progressMs: 50, sampleMs: 50 });
  received = new Map();
  puts = [];
  cutAfterMs = undefined;
  cutOnce = new Set();
  server = createServer((req, res) => {
    const part = Number(req.url?.split("/").pop()) || 0;
    puts.push(part);
    const cutAt = cutOnce.delete(part) ? 100 : cutAfterMs;
    let size = 0;
    const startedAt = Date.now();
    req.on("error", () => undefined);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      req.pause();
      setTimeout(
        () => {
          if (cutAt !== undefined && Date.now() - startedAt >= cutAt) req.socket.destroy();
          else req.resume();
        },
        Math.ceil(chunk.length / RATE_BYTES_PER_MS),
      );
    });
    req.on("end", () => {
      received.set(part, size);
      res.writeHead(200, { etag: `"e${part}"` }).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  Object.assign(putTimings, saved);
  delete process.env["HYPERFRAMES_CONFIG_DIR"];
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function bigFile(bytes: number): { path: string; size: number } {
  const path = join(dir, "big.mp4");
  writeFileSync(path, Buffer.alloc(bytes, 7));
  return { path, size: bytes };
}

function cloud(
  over: { multipart?: boolean; held?: { part_number: number; size_bytes: number }[] } = {},
) {
  const complete = vi.fn(async (_args: unknown) => ({
    asset_id: "a1",
    url: "u",
    mime_type: "video/mp4",
    size_bytes: 1,
    status: "processing" as const,
  }));
  const client = {
    createAssetUpload: vi.fn(async (_args?: unknown) => ({
      asset_id: "a1",
      upload_url: `${base}/single`,
      upload_headers: {},
      expires_in_seconds: 60,
      max_bytes: 1,
      status: "pending_upload" as const,
      ...(over.multipart === false
        ? {}
        : { multipart: { multipart_upload_id: "mp1", part_size_bytes: PART, part_count: 5 } }),
    })),
    getAssetUploadPartUrls: vi.fn(async (args: { body: { part_numbers: number[] } }) => ({
      expires_in_seconds: 60,
      parts: args.body.part_numbers.map((n) => ({
        part_number: n,
        upload_url: `${base}/part/${n}`,
      })),
    })),
    listAssetUploadParts: vi.fn(async () => ({
      parts: (over.held ?? []).map((p) => ({ ...p, etag: `"e${p.part_number}"` })),
    })),
    completeAssetUpload: complete,
  };
  return { client: client as unknown as HyperframesCloudClient, mocks: client, complete };
}

const FILE_BYTES = 17 * MIB;

describe("a big file goes up in parts", () => {
  it("delivers a file a link cannot finish before the cut, because each part finishes alone", async () => {
    cutAfterMs = 1200;
    const { client, complete } = cloud();

    await uploadAssetViaDirectUpload({
      client,
      ...bigFile(FILE_BYTES),
      filename: "big.mp4",
      contentType: "video/mp4",
    });

    expect([...received.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    const body = (
      complete.mock.calls[0]![0] as { body: { multipart_upload_id: string; parts: unknown[] } }
    ).body;
    expect(body.multipart_upload_id).toBe("mp1");
    expect(body.parts).toEqual([1, 2, 3, 4, 5].map((n) => ({ part_number: n, etag: `"e${n}"` })));
  }, 30_000);

  it("the same link cannot deliver the file in one PUT", async () => {
    cutAfterMs = 1200;
    const { client } = cloud({ multipart: false });

    await expect(
      uploadAssetViaDirectUpload({
        client,
        ...bigFile(FILE_BYTES),
        filename: "big.mp4",
        contentType: "video/mp4",
      }),
    ).rejects.toThrow(/cut at .* on two tries in a row/);
  }, 30_000);

  it("sends again only the part that was cut, from its own start", async () => {
    cutOnce.add(3);
    const { client } = cloud();

    await uploadAssetViaDirectUpload({
      client,
      ...bigFile(FILE_BYTES),
      filename: "big.mp4",
      contentType: "video/mp4",
    });

    expect(puts.filter((n) => n === 3)).toHaveLength(2);
    expect(puts.filter((n) => n !== 3)).toHaveLength(4);
    expect(received.get(3)).toBe(PART);
  }, 30_000);

  it("resumes after a restart: parts the cloud holds are not sent again", async () => {
    const held = [
      { part_number: 1, size_bytes: PART },
      { part_number: 2, size_bytes: PART },
    ];
    const first = cloud({ held });
    first.complete.mockRejectedValue(new Error("the CLI was closed before complete"));
    const file = bigFile(FILE_BYTES);
    await expect(
      uploadAssetViaDirectUpload({
        client: first.client,
        ...file,
        filename: "big.mp4",
        contentType: "video/mp4",
      }),
    ).rejects.toThrow();
    puts.length = 0;
    received.clear();
    const second = cloud({ held });

    await uploadAssetViaDirectUpload({
      client: second.client,
      ...file,
      filename: "big.mp4",
      contentType: "video/mp4",
    });

    expect([...puts].sort()).toEqual([3, 4, 5]);
    expect(second.mocks.createAssetUpload).not.toHaveBeenCalled();
  }, 30_000);

  it("forgets the saved plan when the cloud refuses the file, and keeps it when complete only failed", async () => {
    const file = bigFile(FILE_BYTES);
    const upload = (client: HyperframesCloudClient) =>
      uploadAssetViaDirectUpload({
        client,
        ...file,
        filename: "big.mp4",
        contentType: "video/mp4",
      });

    const refused = cloud();
    refused.complete.mockRejectedValue(
      new HyperframesApiError({ status: 400, code: "invalid_parameter", message: "bad type" }),
    );
    await expect(upload(refused.client)).rejects.toThrow(/bad type/);
    const afterRefusal = cloud();
    await upload(afterRefusal.client);
    expect(afterRefusal.mocks.createAssetUpload).toHaveBeenCalledTimes(1);

    const failed = cloud();
    failed.complete.mockRejectedValue(
      new HyperframesApiError({ status: 503, message: "try again later" }),
    );
    await expect(upload(failed.client)).rejects.toThrow(/try again later/);
    const afterFailure = cloud();
    await upload(afterFailure.client);
    expect(afterFailure.mocks.createAssetUpload).not.toHaveBeenCalled();
  }, 60_000);

  it("reports bytes from the parts done plus the live ones", async () => {
    const events: UploadProgressEvent[] = [];
    const { client } = cloud();

    await uploadAssetViaDirectUpload({
      client,
      ...bigFile(FILE_BYTES),
      filename: "big.mp4",
      contentType: "video/mp4",
      onProgress: (e) => events.push(e),
    });

    const sent = events.flatMap((e) =>
      e.phase === "upload" && e.sentBytes !== undefined ? [e.sentBytes] : [],
    );
    expect(sent.length).toBeGreaterThan(2);
    expect(Math.max(...sent)).toBeGreaterThan(PART);
  }, 30_000);
});

describe("files and servers that keep the single PUT", () => {
  it("a small file never asks for parts", async () => {
    const { client, mocks } = cloud({ multipart: false });
    await uploadAssetViaDirectUpload({
      client,
      ...bigFile(2 * MIB),
      filename: "s.mp4",
      contentType: "video/mp4",
    });
    expect((mocks.createAssetUpload.mock.calls[0]![0] as { body: object }).body).not.toHaveProperty(
      "multipart",
    );
    expect(puts).toEqual([0]);
  });

  it("a server that answers without a plan gets the single PUT", async () => {
    const { client, mocks } = cloud({ multipart: false });
    await uploadAssetViaDirectUpload({
      client,
      ...bigFile(FILE_BYTES),
      filename: "b.mp4",
      contentType: "video/mp4",
    });
    expect(mocks.getAssetUploadPartUrls).not.toHaveBeenCalled();
    expect(received.get(0)).toBe(FILE_BYTES);
  }, 30_000);

  it("a server that refuses the unknown field is asked again without it", async () => {
    const { client, mocks } = cloud({ multipart: false });
    mocks.createAssetUpload.mockRejectedValueOnce(
      new HyperframesApiError({ status: 422, code: "invalid_parameter", message: "extra field" }),
    );
    await uploadAssetViaDirectUpload({
      client,
      ...bigFile(FILE_BYTES),
      filename: "b.mp4",
      contentType: "video/mp4",
    });
    expect(mocks.createAssetUpload).toHaveBeenCalledTimes(2);
  }, 30_000);
});
