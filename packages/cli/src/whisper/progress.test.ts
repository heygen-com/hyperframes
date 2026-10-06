import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { createProgressWriter } from "./progress.js";

it("coalesces byte updates behind a slow reader while preserving phase records", async () => {
  const lines: string[] = [];
  let release: (() => void) | undefined;
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      release = callback;
    },
  });
  const emit = createProgressWriter(stream);
  for (let receivedBytes = 0; receivedBytes < 10_000; receivedBytes++) {
    emit({ type: "progress", phase: "download", model: "tiny", receivedBytes, totalBytes: null });
  }
  emit({ type: "progress", phase: "transcription", model: "tiny", status: "started" });
  emit({ type: "progress", phase: "transcription", model: "tiny", status: "completed" });
  expect(lines).toHaveLength(1);
  while (release) {
    const next = release;
    release = undefined;
    next();
    await setImmediate();
  }
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    { type: "progress", phase: "download", model: "tiny", receivedBytes: 0, totalBytes: null },
    { type: "progress", phase: "download", model: "tiny", receivedBytes: 9999, totalBytes: null },
    { type: "progress", phase: "transcription", model: "tiny", status: "started" },
    { type: "progress", phase: "transcription", model: "tiny", status: "completed" },
  ]);
  expect(stream.listenerCount("drain")).toBe(0);
  stream.destroy();
});
