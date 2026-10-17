// Builds the final mp4 inside S3: part 1 carries the stitched header, the other parts copy each
// chunk's mdat payload with UploadPartCopy, so almost no video byte passes through the function.

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  type S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { buildStitchedHeader, readMp4Layout } from "@hyperframes/producer/distributed";
import { parseS3Uri } from "./s3Transport.js";

const MIN_PART_BYTES = 5 * 1024 * 1024;

/** Bytes `[start, end)` of an S3 object. */
interface RangeSegment {
  uri: string;
  start: number;
  end: number;
}
type Segment = { bytes: Buffer } | RangeSegment;
export type Part = { copy: RangeSegment } | { upload: Segment[] };

const segmentSize = (s: Segment): number => ("bytes" in s ? s.bytes.length : s.end - s.start);

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

type UploadTarget = { Bucket: string; Key: string; UploadId: string };

async function sendPart(s3: S3Client, part: Part, partNumber: number, target: UploadTarget) {
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

/** Settles every part before failing, so an abort never races a part still in flight. */
async function sendParts(s3: S3Client, parts: readonly Part[], target: UploadTarget) {
  const settled = await Promise.allSettled(
    parts.map(async (part, index) => {
      const etag = await sendPart(s3, part, index + 1, target);
      if (!etag) throw new Error(`[s3Stitch] part ${index + 1} returned no ETag`);
      return etag;
    }),
  );
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<string>).value);
}

/** Writes `parts` in order to `destUri`; a failure aborts the upload so no parts linger. */
export async function uploadParts(
  s3: S3Client,
  parts: readonly Part[],
  destUri: string,
  contentType: string,
): Promise<void> {
  const { bucket, key } = parseS3Uri(destUri);
  const created = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
  );
  if (!created.UploadId) throw new Error(`[s3Stitch] no upload id for ${destUri}`);
  const target = { Bucket: bucket, Key: key, UploadId: created.UploadId };
  try {
    const etags = await sendParts(s3, parts, target);
    await s3.send(
      new CompleteMultipartUploadCommand({
        ...target,
        MultipartUpload: { Parts: etags.map((ETag, index) => ({ ETag, PartNumber: index + 1 })) },
      }),
    );
  } catch (error) {
    await s3.send(new AbortMultipartUploadCommand(target)).catch((abortError: unknown) => {
      console.error(
        `[s3Stitch] abort failed for ${destUri}; parts remain until a lifecycle rule removes them`,
        abortError,
      );
    });
    throw error;
  }
}

export interface StitchResult {
  fileSize: number;
  parts: number;
  downloadedBytes: number;
}

/** One faststart mp4 at `destUri` from the stitched mp4 chunks at `chunkUris`, in order. */
export async function stitchMp4InS3(
  s3: S3Client,
  chunkUris: readonly string[],
  destUri: string,
  minPartBytes = MIN_PART_BYTES,
): Promise<StitchResult> {
  const layouts = await Promise.all(
    chunkUris.map((uri) => readMp4Layout((start, end) => getRange(s3, uri, start, end))),
  );
  const segments: Segment[] = [
    { bytes: buildStitchedHeader(layouts) },
    ...layouts.map((layout, i) => ({
      uri: chunkUris[i]!,
      start: layout.payloadStart,
      end: layout.payloadEnd,
    })),
  ];
  const parts = planParts(segments, minPartBytes);
  await uploadParts(s3, parts, destUri, "video/mp4");
  const uploaded = parts.flatMap((part) => ("upload" in part ? part.upload : []));
  return {
    fileSize: segments.reduce((total, s) => total + segmentSize(s), 0),
    parts: parts.length,
    downloadedBytes: uploaded.reduce((total, s) => total + ("uri" in s ? segmentSize(s) : 0), 0),
  };
}
