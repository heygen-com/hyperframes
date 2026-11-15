import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setDownloadFetchForTests, downloadToTemp, UrlDownloadError } from "./urlDownloader.js";

const stubFetch = (replacement: unknown): void =>
  _setDownloadFetchForTests(replacement as Parameters<typeof _setDownloadFetchForTests>[0]);

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  _setDownloadFetchForTests();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-url-limits-"));
  dirs.push(dir);
  return dir;
}

const MEDIA = "media-payload-bytes";

function mediaResponse(headers: Record<string, string> = {}): Response {
  return new Response(MEDIA, { headers: { "content-length": `${MEDIA.length}`, ...headers } });
}

describe("downloadToTemp's Content-Encoding policy", () => {
  it.each(["gzip", "br", " GZIP ", "identity, gzip"])(
    "refuses a %j response without retrying or leaving a file",
    async (encoding) => {
      const fetchMock = vi.fn(async () => mediaResponse({ "content-encoding": encoding }));
      stubFetch(fetchMock);
      const dir = tempDir();

      await expect(
        downloadToTemp("https://cdn.example/encoded.mp4", dir, 1_000),
      ).rejects.toMatchObject({
        kind: "http_rejected",
        retryable: false,
        message: "Download response is compressed; only identity Content-Encoding is accepted",
      } satisfies Partial<UrlDownloadError>);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it.each([
    ["absent", {}],
    ["identity", { "content-encoding": "identity" }],
    ["padded Identity", { "content-encoding": " Identity " }],
  ])("downloads a response whose Content-Encoding is %s", async (_case, headers) => {
    stubFetch(vi.fn(async () => mediaResponse(headers)));

    const path = await downloadToTemp("https://cdn.example/plain.mp4", tempDir(), 1_000);

    expect(readFileSync(path, "utf8")).toBe(MEDIA);
  });
});

describe("downloadToTemp's byte limit", () => {
  it("refuses a declared Content-Length over the limit before reading the body", async () => {
    vi.stubEnv("HYPERFRAMES_MAX_DOWNLOAD_BYTES", "16");
    const cancel = vi.fn();
    // The body never sends, so a reader would hang until the 1 s timeout instead.
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.fn(
      async () => new Response(body, { headers: { "content-length": "17" } }),
    );
    stubFetch(fetchMock);
    const dir = tempDir();

    await expect(downloadToTemp("https://cdn.example/big.mp4", dir, 1_000)).rejects.toMatchObject({
      kind: "length_mismatch",
      retryable: false,
      message: "Download exceeded the 16-byte limit",
      telemetry: expect.objectContaining({ expectedBytes: 17 }),
    } satisfies Partial<UrlDownloadError>);
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stops an endless body with no Content-Length at the limit and removes the partial", async () => {
    const limit = 1024 * 1024;
    const chunkBytes = 64 * 1024;
    vi.stubEnv("HYPERFRAMES_MAX_DOWNLOAD_BYTES", `${limit}`);
    const cancel = vi.fn();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
            },
            cancel,
          }),
        ),
    );
    stubFetch(fetchMock);
    const dir = tempDir();

    const error = await downloadToTemp("https://cdn.example/endless.mp4", dir, 10_000).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      kind: "length_mismatch",
      retryable: false,
      message: `Download exceeded the ${limit}-byte limit`,
    });
    const receivedBytes = (error as UrlDownloadError).telemetry?.receivedBytes ?? 0;
    expect(receivedBytes).toBeGreaterThan(limit);
    expect(receivedBytes).toBeLessThanOrEqual(limit + chunkBytes);
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each(["", "abc", "0", "-5", "1.5"])(
    "keeps the default limit when HYPERFRAMES_MAX_DOWNLOAD_BYTES is %j",
    async (value) => {
      vi.stubEnv("HYPERFRAMES_MAX_DOWNLOAD_BYTES", value);
      stubFetch(vi.fn(async () => mediaResponse()));

      const path = await downloadToTemp("https://cdn.example/default-limit.mp4", tempDir(), 1_000);

      expect(readFileSync(path, "utf8")).toBe(MEDIA);
    },
  );
});
