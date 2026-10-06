import type { Writable } from "node:stream";
import type { TranscribeProgress } from "./transcribe.js";

export function createProgressWriter(stream: Writable): (event: TranscribeProgress) => void {
  let blocked = false;
  const pending: TranscribeProgress[] = [];
  const write = (event: TranscribeProgress): void => {
    if (blocked) {
      const previous = pending.at(-1);
      if (
        event.phase === "download" &&
        previous?.phase === "download" &&
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
