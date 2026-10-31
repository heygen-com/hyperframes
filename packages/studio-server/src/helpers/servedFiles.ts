import type { ReadStream } from "node:fs";
import { resolve } from "node:path";

const serving = new Map<string, Set<ReadStream>>();
const keyOf = (path: string) =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);

export function serveWhileOpen(path: string, stream: ReadStream): ReadStream {
  const key = keyOf(path);
  const reads = serving.get(key) ?? new Set();
  serving.set(key, reads.add(stream));
  stream.once("close", () => {
    reads.delete(stream);
    if (reads.size === 0 && serving.get(key) === reads) serving.delete(key);
  });
  return stream;
}

// Windows refuses to replace a file while a read of it is open, and a loaded <video> keeps its read open.
export async function stopServingAndClose(path: string): Promise<void> {
  const reads = [...(serving.get(keyOf(path)) ?? [])];
  await Promise.all(
    reads.map(
      (stream) =>
        new Promise<void>((done) => {
          if (stream.closed) return done();
          stream.once("close", () => done());
          stream.destroy();
        }),
    ),
  );
}
