import type { Writable } from "node:stream";
import type { Word } from "./normalize.js";
import type { TranscribeProgress } from "./transcribe.js";

const DESKTOP_MAX_LINE_BYTES = 16_000;

export function emitWords(
  onEvent: (event: TranscribeProgress) => void,
  model: string,
  words: Word[],
  through: number,
): void {
  const empty = Buffer.byteLength(JSON.stringify({ type: "words", model, words: [], through })) + 1;
  let chunk: Word[] = [];
  let bytes = empty;
  for (const word of words) {
    const size = Buffer.byteLength(JSON.stringify(word)) + 1;
    if (chunk.length > 0 && bytes + size > DESKTOP_MAX_LINE_BYTES) {
      onEvent({ type: "words", model, words: chunk, through: chunk.at(-1)!.end });
      chunk = [];
      bytes = empty;
    }
    chunk.push(word);
    bytes += size;
  }
  onEvent({ type: "words", model, words: chunk, through });
}

export function createProgressWriter(stream: Writable): (event: TranscribeProgress) => void {
  let blocked = false;
  const pending: TranscribeProgress[] = [];
  const write = (event: TranscribeProgress): void => {
    if (blocked) {
      const previous = pending.at(-1);
      if (
        event.type === "progress" &&
        event.phase === "download" &&
        previous?.type === "progress" &&
        previous.phase === "download" &&
        previous.model === event.model
      ) {
        pending[pending.length - 1] = event;
      } else {
        pending.push(event);
      }
      return;
    }
    blocked = !stream.write(`${JSON.stringify(event)}\n`);
    if (blocked) {
      stream.once("drain", () => {
        blocked = false;
        while (!blocked && pending.length > 0) write(pending.shift()!);
      });
    }
  };
  return write;
}
