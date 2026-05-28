/**
 * Stream a presigned `video_url` (or any HTTPS URL) into a local file.
 *
 * The presigned URLs returned by `GET /v3/hyperframes/renders/{id}` are
 * S3 URLs scoped per-request — they don't take any HeyGen auth header.
 * That's why this lives separate from the cloud client: the client
 * threads auth headers, the download path explicitly does NOT.
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface DownloadOptions {
  signal?: AbortSignal;
  /** Inject fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /** Called with (bytes downloaded, total or undefined). */
  onProgress?: (bytes: number, total: number | undefined) => void;
}

export interface DownloadResult {
  path: string;
  bytes: number;
}

/**
 * Stream `url` into `destPath`. Creates the parent directory if needed,
 * never overwrites without truncating — i.e. the existing file is
 * replaced wholesale. Bubbles the response status code via a thrown
 * Error when the response is not 2xx.
 *
 * Implementation uses a `for await` loop over `res.body` rather than
 * `pipeline` + `Readable.fromWeb` because the cross-stream typing
 * between `node:stream/web` and the global `ReadableStream` types is
 * fragile (varies across Node minor versions). Throughput is the same;
 * chunk-level await is dwarfed by network latency.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { signal: options.signal });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`Failed to download ${url}: empty response body`);
  }

  mkdirSync(dirname(destPath), { recursive: true });

  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : undefined;
  const totalOpt = total !== undefined && Number.isFinite(total) ? total : undefined;

  const file = createWriteStream(destPath);
  let bytes = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      options.onProgress?.(bytes, totalOpt);
      // Apply backpressure: pause when the kernel buffer is full.
      if (!file.write(chunk)) {
        await new Promise<void>((resolve) => file.once("drain", () => resolve()));
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      file.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  }
  return { path: destPath, bytes };
}
