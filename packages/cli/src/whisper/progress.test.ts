import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { createProgressWriter, emitWords } from "./progress.js";
import type { TranscribeProgress } from "./transcribe.js";

it("splits a long run of words into lines under 16 KB and keeps every word in order", () => {
  const events: TranscribeProgress[] = [];
  const words = Array.from({ length: 2000 }, (_, i) => ({
    text: `word${i}`,
    start: i,
    end: i + 0.5,
  }));
  emitWords((e) => events.push(e), "tiny", words, 2100);

  expect(events.length).toBeGreaterThan(1);
  for (const event of events)
    expect(Buffer.byteLength(`${JSON.stringify(event)}\n`)).toBeLessThan(16_384);
  expect(events.flatMap((e) => (e.type === "words" ? e.words : []))).toEqual(words);
  expect(events.at(-1)).toMatchObject({ through: 2100 });
});

it("reports progress through a window with no words", () => {
  const events: TranscribeProgress[] = [];
  emitWords((e) => events.push(e), "tiny", [], 30);
  expect(events).toEqual([{ type: "words", model: "tiny", words: [], through: 30 }]);
});

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
