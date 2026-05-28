/**
 * Stream a presigned `video_url` (or any HTTPS URL) into a local file.
 *
 * The presigned URLs returned by `GET /v3/hyperframes/renders/{id}` are
 * S3 URLs scoped per-request — they don't take any HeyGen auth header.
 * That's why this lives separate from the cloud client: the client
 * threads auth headers, the download path explicitly does NOT.
 *
 * Failure behavior is "all or nothing": on any error we (1) listen for
 * stream errors / aborts so awaits resolve promptly instead of hanging,
 * (2) verify the final byte count matches `content-length` when the
 * server supplied one, and (3) `unlinkSync` the partial output so a
 * subsequent retry doesn't pick up a corrupted file.
 */

import { createWriteStream, mkdirSync, unlinkSync } from "node:fs";
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
 * truncates any existing file at the destination, and deletes the
 * partial output on any error so the caller never observes a corrupt
 * file at the returned path.
 */
// fallow-ignore-next-line complexity
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
  let errored = false;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("Download aborted");
      }
      bytes += chunk.byteLength;
      options.onProgress?.(bytes, totalOpt);
      if (!file.write(chunk)) {
        await waitForDrain(file, options.signal);
      }
    }
    if (totalOpt !== undefined && bytes !== totalOpt) {
      throw new Error(
        `Truncated download: got ${bytes} bytes, expected ${totalOpt} (content-length). ` +
          `The presigned URL may have expired mid-transfer — refetch via \`hyperframes cloud get\`.`,
      );
    }
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    await closeFile(file);
    if (errored) {
      // Don't let a partial file pose as the final artifact. Best-
      // effort unlink — if it fails (already gone, permission), we
      // re-throw the original error.
      try {
        unlinkSync(destPath);
      } catch {
        /* swallow */
      }
    }
  }
  return { path: destPath, bytes };
}

/**
 * Resolve when the write stream emits `drain`, or reject on `error` /
 * `close` / signal abort — avoids the hang from awaiting a one-shot
 * `drain` event that never fires because the stream tore down first.
 */
function waitForDrain(file: NodeJS.WritableStream, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      file.off("drain", onDrain);
      file.off("error", onError);
      file.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("write stream closed before drain"));
    };
    const onAbort = (): void => {
      cleanup();
      const reason = signal?.reason;
      reject(reason instanceof Error ? reason : new Error("Download aborted"));
    };
    file.once("drain", onDrain);
    file.once("error", onError);
    file.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function closeFile(file: NodeJS.WritableStream): Promise<void> {
  return new Promise<void>((resolve) => {
    // Best-effort cleanup: any underlying failure has already been
    // surfaced as the original throw from the for-await loop. We
    // listen for `error` so a failing close (bad fd, late ENOSPC on
    // flush) doesn't leak an unhandled 'error' onto the stream, and
    // resolve either way so the finally block proceeds to unlinkSync.
    const done = (): void => {
      file.off("error", done);
      resolve();
    };
    file.once("error", done);
    file.end(() => done());
  });
}
