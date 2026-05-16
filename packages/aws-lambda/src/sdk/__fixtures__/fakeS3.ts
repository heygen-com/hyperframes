/**
 * Shared `FakeS3` for the SDK unit tests.
 *
 * Multiple SDK tests need to assert what `deploySite` / `renderToLambda`
 * sent to S3. Each fake here records `HeadObjectCommand` + `PutObjectCommand`
 * activity and drains the body stream so the lazy `createReadStream`
 * inside `uploadFileToS3` doesn't try to open the workdir tarball after
 * `deploySite`'s `finally` block has rmSync'd it.
 */

import type { S3Client } from "@aws-sdk/client-s3";

export interface FakeS3Op {
  kind: "head" | "put";
  bucket: string;
  key: string;
}

export class FakeS3 {
  ops: FakeS3Op[] = [];
  existing = new Set<string>();

  async send(command: unknown): Promise<unknown> {
    const cmdName = (command as { constructor: { name: string } }).constructor.name;
    const input = (command as { input: { Bucket: string; Key: string } }).input;
    if (cmdName === "HeadObjectCommand") {
      this.ops.push({ kind: "head", bucket: input.Bucket, key: input.Key });
      if (this.existing.has(`${input.Bucket}/${input.Key}`)) {
        return { ContentLength: 1, LastModified: new Date("2026-05-16T00:00:00Z") };
      }
      const err = new Error("Not Found") as Error & {
        $metadata: { httpStatusCode: number };
        name: string;
      };
      err.name = "NotFound";
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    if (cmdName === "PutObjectCommand") {
      this.ops.push({ kind: "put", bucket: input.Bucket, key: input.Key });
      this.existing.add(`${input.Bucket}/${input.Key}`);
      await drainBody((command as { input: { Body: NodeJS.ReadableStream | Buffer } }).input.Body);
      return {};
    }
    throw new Error(`FakeS3: unexpected command ${cmdName}`);
  }
}

/** Convenience cast so `deploySite({ s3: makeFakeS3() })` reads cleanly. */
export function asS3Client(fake: FakeS3): S3Client {
  return fake as unknown as S3Client;
}

/**
 * Consume the body stream to completion. Without this, the lazy
 * `createReadStream` opened inside `uploadFileToS3` would attempt to
 * read the workdir tarball after deploySite's `finally` block removed
 * the workdir — surfacing as an "Unhandled error between tests"
 * teardown noise that bun's runner attributes to the next test.
 */
async function drainBody(body: NodeJS.ReadableStream | Buffer): Promise<void> {
  if (Buffer.isBuffer(body)) return;
  await new Promise<void>((resolve, reject) => {
    body.on("data", () => {});
    body.on("end", () => resolve());
    body.on("close", () => resolve());
    body.on("error", reject);
  });
}
