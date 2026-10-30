/**
 * Shared `FakeS3` for the SDK unit tests.
 *
 * Multiple SDK tests need to assert what `deploySite` / `renderToLambda`
 * sent to S3. Each fake here records `HeadObjectCommand` + `PutObjectCommand`
 * activity and drains the body stream so the lazy `createReadStream`
 * inside `uploadFileToS3` doesn't try to open the workdir tarball after
 * `deploySite`'s `finally` block has rmSync'd it.
 */

import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import type { S3Client } from "@aws-sdk/client-s3";

export interface FakeS3Op {
  kind: "head" | "put";
  bucket: string;
  key: string;
}

export class FakeS3 {
  ops: FakeS3Op[] = [];
  existing = new Set<string>();
  bodies = new Map<string, Buffer>();
  metadata = new Map<string, Record<string, string> | undefined>();

  async send(command: unknown): Promise<unknown> {
    const cmdName = (command as { constructor: { name: string } }).constructor.name;
    const input = (
      command as {
        input: { Bucket: string; Key: string; Metadata?: Record<string, string>; Body?: unknown };
      }
    ).input;
    const id = `${input.Bucket}/${input.Key}`;
    const handlers: Record<string, () => Promise<unknown>> = {
      HeadObjectCommand: async () => {
        this.ops.push({ kind: "head", bucket: input.Bucket, key: input.Key });
        return this.head(id);
      },
      GetObjectCommand: async () => {
        if (!this.existing.has(id)) throw notFound("NoSuchKey");
        return { Body: Readable.from([this.bodies.get(id) ?? Buffer.alloc(0)]) };
      },
      PutObjectCommand: async () => {
        this.ops.push({ kind: "put", bucket: input.Bucket, key: input.Key });
        this.existing.add(id);
        this.metadata.set(id, input.Metadata);
        this.bodies.set(id, await drainBody(input.Body as NodeJS.ReadableStream | Buffer));
        return {};
      },
    };
    const handler = handlers[cmdName];
    if (!handler) throw new Error(`FakeS3: unexpected command ${cmdName}`);
    return handler();
  }

  private head(id: string): unknown {
    if (this.existing.has(id)) {
      return { ContentLength: this.bodies.get(id)?.length, Metadata: this.metadata.get(id) };
    }
    throw notFound("NotFound");
  }
}

function notFound(name: string): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
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
async function drainBody(body: NodeJS.ReadableStream | Buffer): Promise<Buffer> {
  return Buffer.isBuffer(body) ? body : buffer(body);
}
