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
 * server supplied one, and (3) discard the private staged output. An
 * existing destination is replaced only after the download succeeds.
 */

import {
  chmodSync,
  createWriteStream,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

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
 * replaces an existing file only after the complete response is written,
 * and removes staged bytes on failure while preserving the old output.
 * Atomic replacement requires a writable parent directory and creates a new
 * inode: mode is retained, owner/group are not, and hard links keep old bytes.
 * A read-only file can be replaced when its parent permits the rename.
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

  const destination = resolveDownloadDestination(destPath);
  const previous = statSync(destination, { throwIfNoEntry: false });
  const stage = mkdtempSync(join(dirname(destination), ".hf-download-"));
  const stagedFile = join(stage, "download");
  let bytes = 0;
  try {
    await pipeline(
      async function* () {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          bytes += chunk.byteLength;
          options.onProgress?.(bytes, totalOpt);
          yield chunk;
        }
        if (totalOpt !== undefined && bytes !== totalOpt) {
          throw new Error(
            `Truncated download: got ${bytes} bytes, expected ${totalOpt} (content-length). ` +
              `The presigned URL may have expired mid-transfer — refetch via \`hyperframes cloud get\`.`,
          );
        }
      },
      createWriteStream(stagedFile, { flags: "wx" }),
      { signal: options.signal },
    );
    options.signal?.throwIfAborted();
    if (previous?.isFile()) chmodSync(stagedFile, previous.mode & 0o777);
    renameSync(stagedFile, destination);
  } catch (error) {
    const reason = options.signal?.reason;
    if (options.signal?.aborted && reason instanceof Error) throw reason;
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return { path: destPath, bytes };
}

/** Preserve the existing behavior of writing through a caller-selected symlink. */
function resolveDownloadDestination(destPath: string): string {
  let destination = resolve(destPath);
  for (let hops = 0; hops < 40; hops++) {
    if (!lstatSync(destination, { throwIfNoEntry: false })?.isSymbolicLink()) return destination;
    destination = resolve(dirname(destination), readlinkSync(destination));
  }
  throw new Error(`Too many symbolic links in download destination: ${destPath}`);
}
