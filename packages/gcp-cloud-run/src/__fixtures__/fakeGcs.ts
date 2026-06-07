/**
 * In-memory `@google-cloud/storage` stand-in for the adapter's unit tests.
 *
 * Mimics just the surface the transport + deploySite use:
 *   storage.bucket(name).file(key) → { createReadStream, exists, getMetadata }
 *   storage.bucket(name).upload(localPath, { destination, contentType })
 *
 * Objects live in a Map keyed `bucket/key`. `upload` reads the real local
 * file from disk (the handler writes real tarballs), so round-trips through
 * tar/untar exercise the actual code path. Every op is recorded for
 * sequence assertions.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import type { Storage } from "@google-cloud/storage";

export interface FakeGcsOp {
  kind: "download" | "upload" | "exists" | "getMetadata";
  uri: string;
  bytes?: number;
}

export class FakeGcs {
  ops: FakeGcsOp[] = [];
  objects = new Map<string, Buffer>();

  // Accessed only through the `Storage` cast in tests, so fallow's static
  // analysis can't see the reference.
  // fallow-ignore-next-line unused-class-member
  bucket(bucketName: string): FakeBucket {
    return new FakeBucket(this, bucketName);
  }

  /** Seed an object directly (e.g. a pre-built project tarball). */
  seed(uri: string, bytes: Buffer): void {
    this.objects.set(uri, bytes);
  }

  /** Seed from a local file on disk. */
  seedFromFile(uri: string, localPath: string): void {
    this.objects.set(uri, readFileSync(localPath));
  }
}

class FakeBucket {
  constructor(
    private readonly gcs: FakeGcs,
    private readonly bucketName: string,
  ) {}

  get name(): string {
    return this.bucketName;
  }

  file(key: string): FakeFile {
    return new FakeFile(this.gcs, this.bucketName, key);
  }

  async upload(
    localPath: string,
    opts: { destination: string; contentType?: string },
  ): Promise<unknown> {
    const uri = `gs://${this.bucketName}/${opts.destination}`;
    const bytes = readFileSync(localPath);
    this.gcs.objects.set(uri, bytes);
    this.gcs.ops.push({ kind: "upload", uri, bytes: bytes.length });
    return [{}];
  }
}

class FakeFile {
  private readonly uri: string;
  constructor(
    private readonly gcs: FakeGcs,
    bucketName: string,
    key: string,
  ) {
    this.uri = `gs://${bucketName}/${key}`;
  }

  createReadStream(): Readable {
    const bytes = this.gcs.objects.get(this.uri);
    if (!bytes) {
      const r = new Readable({ read() {} });
      r.destroy(new Error(`FakeGcs: object not found: ${this.uri}`));
      return r;
    }
    this.gcs.ops.push({ kind: "download", uri: this.uri, bytes: bytes.length });
    return Readable.from([bytes]);
  }

  async exists(): Promise<[boolean]> {
    const has = this.gcs.objects.has(this.uri);
    this.gcs.ops.push({ kind: "exists", uri: this.uri });
    return [has];
  }

  async getMetadata(): Promise<[{ size?: string | number; updated?: string }]> {
    const bytes = this.gcs.objects.get(this.uri);
    this.gcs.ops.push({ kind: "getMetadata", uri: this.uri });
    return [{ size: bytes?.length ?? 0, updated: "2026-06-06T00:00:00.000Z" }];
  }

  /** Helper for tests that want to materialize an object to disk. */
  writeToDisk(destPath: string): void {
    const bytes = this.gcs.objects.get(this.uri);
    if (!bytes) throw new Error(`FakeGcs: object not found: ${this.uri}`);
    writeFileSync(destPath, bytes);
  }
}

/** Cast so `deploySite({ storage: asStorage(fake) })` reads cleanly. */
export function asStorage(fake: FakeGcs): Storage {
  return fake as unknown as Storage;
}
