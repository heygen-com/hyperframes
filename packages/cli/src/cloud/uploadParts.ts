/** Sends a file to the cloud in parts, so a cut connection costs one part and a restart sends only the rest. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hyperframesConfigDir } from "../utils/configDir.js";
import type { HyperframesCloudClient } from "./_gen/client.js";
import type { CompletedPart, MultipartUploadPlan } from "./_gen/types.js";
import {
  putStreamToPresignedUrl,
  putTimings,
  putWithRetry,
  type PutTry,
  type UploadFileSource,
} from "./uploadPut.js";
import type { UploadProgressEvent } from "./upload.js";

/** Files above this go in parts; the server fixes the part size. */
export const PARTS_ABOVE_BYTES = 16 * 1024 * 1024;
const PARTS_IN_FLIGHT = 3;

/** The upload a restart picks up again: it is found by the file's content, so a changed file starts over. */
interface SavedUpload {
  asset_id: string;
  plan: MultipartUploadPlan;
}

export function savedUploadFile(sha256: string, size: number): string {
  return hyperframesConfigDir("uploads", `${sha256.slice(0, 32)}-${size}.json`);
}

function readSaved(file: string): SavedUpload | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SavedUpload;
  } catch {
    return undefined;
  }
}

export function forgetSaved(file: string): void {
  rmSync(file, { force: true });
}

export function saveUpload(file: string, saved: SavedUpload): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  } catch {
    // expected: a read-only config folder only costs the resume after a restart
  }
}

/** The upload saved for this content that the cloud still holds, or nothing. */
export async function resumable(
  client: HyperframesCloudClient,
  file: string,
): Promise<SavedUpload | undefined> {
  const saved = readSaved(file);
  if (!saved) return undefined;
  try {
    await client.listAssetUploadParts({
      asset_id: saved.asset_id,
      multipart_upload_id: saved.plan.multipart_upload_id,
    });
    return saved;
  } catch {
    forgetSaved(file);
    return undefined;
  }
}

function partRange(plan: MultipartUploadPlan, total: number, number: number) {
  const start = (number - 1) * plan.part_size_bytes;
  return { start, length: Math.min(plan.part_size_bytes, total - start) };
}

export interface PartsUpload {
  client: HyperframesCloudClient;
  asset_id: string;
  plan: MultipartUploadPlan;
  body: Uint8Array | UploadFileSource;
  total: number;
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
}

/** Sends every part the cloud does not hold yet, a few at a time, each part retried alone from its own start. */
export async function uploadParts(job: PartsUpload): Promise<CompletedPart[]> {
  const { client, asset_id, plan, total } = job;
  const id = plan.multipart_upload_id;
  const held = await client.listAssetUploadParts({ asset_id, multipart_upload_id: id });
  const done = new Map<number, string>();
  for (const part of held.parts) {
    const range = partRange(plan, total, part.part_number);
    if (part.size_bytes === range.length) done.set(part.part_number, part.etag);
  }
  const progress = partsProgress(
    job,
    [...done.keys()].reduce((sum, n) => sum + partRange(plan, total, n).length, 0),
  );
  progress.report(1);

  const todo = Array.from({ length: plan.part_count }, (_, i) => i + 1).filter((n) => !done.has(n));
  const failure: { error?: unknown } = {};
  const worker = async () => {
    for (let number = todo.shift(); number !== undefined; number = todo.shift()) {
      if (failure.error) return;
      try {
        done.set(number, await sendPart(job, number, progress));
        progress.finish(number, partRange(plan, total, number).length);
      } catch (err) {
        failure.error ??= err;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARTS_IN_FLIGHT, todo.length) }, worker));
  if (failure.error) throw failure.error;
  return [...done.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([part_number, etag]) => ({ part_number, etag }));
}

/** Bytes sent so far: the parts done plus what each part in flight has written, reported at most every progressMs
 * or 5 points. */
function partsProgress(job: PartsUpload, finishedBytes: number) {
  const live = new Map<number, number>();
  let finished = finishedBytes;
  let lastAt = Date.now();
  let lastPercent = -5;
  const report = (attempt: number) => {
    const sent = Math.min(job.total, finished + [...live.values()].reduce((a, b) => a + b, 0));
    const percent = job.total > 0 ? Math.min(99, Math.floor((100 * sent) / job.total)) : 0;
    const now = Date.now();
    if (now - lastAt < putTimings.progressMs && percent < lastPercent + 5) return;
    [lastAt, lastPercent] = [now, percent];
    job.onProgress?.({ phase: "upload", percent, sentBytes: sent, totalBytes: job.total, attempt });
  };
  return {
    report,
    written: (number: number, bytes: number, attempt: number) => (
      live.set(number, bytes), report(attempt)
    ),
    finish: (number: number, bytes: number) => (
      (finished += bytes), live.delete(number), report(1)
    ),
  };
}

async function sendPart(
  job: PartsUpload,
  number: number,
  progress: ReturnType<typeof partsProgress>,
): Promise<string> {
  const { client, asset_id, plan, body, total, signal } = job;
  const range = partRange(plan, total, number);
  return putWithRetry(
    async (tried: PutTry) => {
      const minted = await client.getAssetUploadPartUrls({
        asset_id,
        body: { multipart_upload_id: plan.multipart_upload_id, part_numbers: [number] },
        signal,
      });
      const url = minted.parts.find((part) => part.part_number === number)?.upload_url;
      if (!url) throw new Error(`The cloud gave no address for part ${number}`);
      progress.written(number, 0, tried.attempt);
      const etag = await putStreamToPresignedUrl(
        url,
        {},
        body,
        signal,
        (written) => {
          tried.sent = written;
          progress.written(number, Math.min(written, range.length), tried.attempt);
        },
        range,
      );
      if (!etag) throw new Error(`The cloud gave no ETag for part ${number}`);
      return etag;
    },
    range.length,
    signal,
  );
}
