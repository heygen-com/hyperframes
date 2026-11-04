import { availableParallelism } from "node:os";

export const X265_MAX_THREADS = 16;

/** x264/x265 bitstreams depend on the thread count, so it comes from the CPU quota, never ffmpeg's host-core guess. */
export function appendSoftwareEncoderThreadsArg(
  args: string[],
  encoder: "libx264" | "libx265",
  parallelism: number = availableParallelism(),
): void {
  const cap = encoder === "libx265" ? X265_MAX_THREADS : Infinity;
  args.push("-threads", String(Math.min(cap, Math.max(1, Math.floor(parallelism)))));
}
