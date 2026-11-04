// Builds the final mp4 inside S3: part 1 carries the stitched header, the other parts copy each
// chunk's mdat payload with UploadPartCopy, so almost no video byte passes through the function.

import {
  type CompletedPart,
  GetObjectCommand,
  type S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { buildStitchedHeader, readMp4Layout } from "@hyperframes/producer/distributed";
import { multipartUpload, type MultipartTarget, parseS3Uri } from "./s3Transport.js";

const MIN_PART_BYTES = 5 * 1024 * 1024;
const HELPER_BATCH_BYTES = 32 * 1024 * 1024;

/** Bytes `[start, end)` of an S3 object. */
interface RangeSegment {
  uri: string;
  start: number;
  end: number;
}
type Segment = { bytes: Buffer } | RangeSegment;
export type Part = { copy: RangeSegment } | { upload: Segment[] };

const segmentSize = (s: Segment): number => ("bytes" in s ? s.bytes.length : s.end - s.start);

export interface RangePart {
  partNumber: number;
  ranges: RangeSegment[];
}
export type SendRangeParts = (target: MultipartTarget, parts: RangePart[]) => Promise<string[]>;
export interface StitchHelper {
  send: SendRangeParts;
  maxInvocations: number;
}

// Every part but the last must be >= `min` and a copy reads one object: big ranges are copied,
// smaller pieces are downloaded into one upload part that borrows the next range's head if its rest
// stays copyable.
// fallow-ignore-next-line complexity
export function planParts(segments: readonly Segment[], min = MIN_PART_BYTES): Part[] {
  const parts: Part[] = [];
  let pending: Segment[] = [];
  let pendingSize = 0;
  const flush = () => {
    if (pending.length) parts.push({ upload: pending });
    pending = [];
    pendingSize = 0;
  };
  for (const segment of segments) {
    const borrow = pendingSize ? min - pendingSize : 0;
    if ("uri" in segment && segmentSize(segment) - borrow >= min) {
      if (borrow) pending.push({ ...segment, end: segment.start + borrow });
      flush();
      parts.push({ copy: { ...segment, start: segment.start + borrow } });
      continue;
    }
    pending.push(segment);
    pendingSize += segmentSize(segment);
    if (pendingSize >= min) flush();
  }
  flush();
  return parts;
}

async function getRange(s3: S3Client, uri: string, start: number, end: number): Promise<Buffer> {
  const { bucket, key } = parseS3Uri(uri);
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${end - 1}` }),
  );
  if (!response.Body) throw new Error(`[s3Stitch] empty body for ${uri}`);
  return Buffer.from(await response.Body.transformToByteArray());
}

async function sendPart(s3: S3Client, part: Part, partNumber: number, target: MultipartTarget) {
  if ("copy" in part) {
    const { uri, start, end } = part.copy;
    const source = parseS3Uri(uri);
    const result = await s3.send(
      new UploadPartCopyCommand({
        ...target,
        PartNumber: partNumber,
        CopySource: encodeURI(`${source.bucket}/${source.key}`),
        CopySourceRange: `bytes=${start}-${end - 1}`,
      }),
    );
    return result.CopyPartResult?.ETag;
  }
  const body = await Promise.all(
    part.upload.map((s) => ("bytes" in s ? s.bytes : getRange(s3, s.uri, s.start, s.end))),
  );
  const result = await s3.send(
    new UploadPartCommand({ ...target, PartNumber: partNumber, Body: Buffer.concat(body) }),
  );
  return result.ETag;
}

/** Settles every task before failing, so an abort never races a part still in flight. */
async function settleAll<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks);
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

const rangesOnly = (part: Part): RangeSegment[] | undefined =>
  "upload" in part && part.upload.every((s) => "uri" in s)
    ? (part.upload as RangeSegment[])
    : undefined;

const rangeBytes = (ranges: readonly RangeSegment[]) =>
  ranges.reduce((total, r) => total + segmentSize(r), 0);

// Every closed batch holds at least total / maxBatches bytes, so there are never more than maxBatches.
export function helperBatches(parts: readonly Part[], maxBatches = Infinity): RangePart[][] {
  const total = parts.reduce((sum, part) => sum + rangeBytes(rangesOnly(part) ?? []), 0);
  const batchBytes = Math.max(HELPER_BATCH_BYTES, Math.ceil(total / maxBatches));
  const batches: RangePart[][] = [];
  let batch: RangePart[] = [];
  let bytes = 0;
  parts.forEach((part, index) => {
    const ranges = rangesOnly(part);
    if (!ranges) return;
    batch.push({ partNumber: index + 1, ranges });
    bytes += rangeBytes(ranges);
    if (bytes < batchBytes) return;
    batches.push(batch);
    batch = [];
    bytes = 0;
  });
  if (batch.length) batches.push(batch);
  return batches;
}

export async function sendRangeParts(
  s3: S3Client,
  target: MultipartTarget,
  parts: readonly RangePart[],
): Promise<string[]> {
  return settleAll(
    parts.map(async ({ partNumber, ranges }) => {
      const etag = await sendPart(s3, { upload: ranges }, partNumber, target);
      if (!etag) throw new Error(`[s3Stitch] part ${partNumber} returned no ETag`);
      return etag;
    }),
  );
}

async function sendParts(
  s3: S3Client,
  parts: readonly Part[],
  target: MultipartTarget,
  helper?: StitchHelper,
): Promise<CompletedPart[]> {
  const batches = helper ? helperBatches(parts, helper.maxInvocations) : [];
  const remote = new Set(batches.flat().map((p) => p.partNumber));
  const local = parts.flatMap((part, index) =>
    remote.has(index + 1) ? [] : [{ partNumber: index + 1, part }],
  );
  const done = await settleAll<CompletedPart[]>([
    ...local.map(async ({ partNumber, part }) => [
      { PartNumber: partNumber, ETag: await sendPart(s3, part, partNumber, target) },
    ]),
    ...batches.map(async (batch) => {
      const etags = await helper!.send(target, batch);
      return batch.map((p, i) => ({ PartNumber: p.partNumber, ETag: etags[i] }));
    }),
  ]);
  const completed = done.flat().sort((a, b) => a.PartNumber! - b.PartNumber!);
  const missing = completed.find((p) => !p.ETag);
  if (missing || completed.length !== parts.length) {
    throw new Error(`[s3Stitch] part ${missing?.PartNumber ?? "?"} returned no ETag`);
  }
  return completed;
}

/** Writes `parts` in order to `destUri`; a failure aborts the upload so no parts linger. */
export async function uploadParts(
  s3: S3Client,
  parts: readonly Part[],
  destUri: string,
  contentType: string,
  helper?: StitchHelper,
): Promise<void> {
  const { bucket, key } = parseS3Uri(destUri);
  await multipartUpload(s3, { Bucket: bucket, Key: key, ContentType: contentType }, (target) =>
    sendParts(s3, parts, target, helper),
  );
}

export interface StitchResult {
  fileSize: number;
  parts: number;
  downloadedBytes: number;
  helpers: number;
  helperFallbacks: number;
}

/** One faststart mp4 at `destUri` from the stitched mp4 chunks at `chunkUris`, plus `audioUri`'s track when given. */
export async function stitchMp4InS3(
  s3: S3Client,
  chunkUris: readonly string[],
  destUri: string,
  {
    audioUri,
    minPartBytes = MIN_PART_BYTES,
    helper,
  }: { audioUri?: string; minPartBytes?: number; helper?: StitchHelper } = {},
): Promise<StitchResult> {
  const sourceUris = audioUri ? [audioUri, ...chunkUris] : chunkUris;
  const layouts = await Promise.all(
    sourceUris.map((uri) => readMp4Layout((start, end) => getRange(s3, uri, start, end))),
  );
  const header = audioUri
    ? buildStitchedHeader(layouts.slice(1), layouts[0])
    : buildStitchedHeader(layouts);
  const segments: Segment[] = [
    { bytes: header },
    ...layouts.map((layout, i) => ({
      uri: sourceUris[i]!,
      start: layout.payloadStart,
      end: layout.payloadEnd,
    })),
  ];
  const parts = planParts(segments, minPartBytes);
  let helperFallbacks = 0;
  const helperOrLocal = helper && {
    maxInvocations: helper.maxInvocations,
    // A throttled helper (another render may hold the reservation) costs time, not the render.
    send: (target: MultipartTarget, batch: RangePart[]) =>
      helper.send(target, batch).catch((error: unknown) => {
        helperFallbacks++;
        console.warn(`[s3Stitch] helper failed, building ${batch.length} parts here:`, error);
        return sendRangeParts(s3, target, batch);
      }),
  };
  await uploadParts(s3, parts, destUri, "video/mp4", helperOrLocal);
  const uploaded = parts.flatMap((part) => ("upload" in part ? part.upload : []));
  return {
    fileSize: segments.reduce((total, s) => total + segmentSize(s), 0),
    parts: parts.length,
    downloadedBytes: uploaded.reduce((total, s) => total + ("uri" in s ? segmentSize(s) : 0), 0),
    helpers: helper ? helperBatches(parts, helper.maxInvocations).length : 0,
    helperFallbacks,
  };
}
