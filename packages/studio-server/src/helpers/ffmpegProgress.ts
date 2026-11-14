import type { Readable } from "node:stream";

const OUT_TIME = /^out_time_(?:us|ms)=(\d+)$/;

/** Hears the furthest output time, in seconds, that ffmpeg's `-progress pipe:1` lines on `stream` report. */
export function followFfmpegProgress(stream: Readable, onSeconds: (seconds: number) => void): void {
  let furthest = 0;
  let lineTail = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (lineTail + chunk.toString()).split("\n");
    lineTail = lines.pop() ?? "";
    for (const line of lines) {
      const reached = OUT_TIME.exec(line.trim());
      if (!reached) continue;
      const seconds = Number(reached[1]) / 1e6;
      if (seconds <= furthest) continue;
      furthest = seconds;
      onSeconds(seconds);
    }
  });
}
