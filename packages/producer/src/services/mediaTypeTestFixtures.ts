import { spawnSync } from "node:child_process";

export function synthesizeMediaFixture(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg fixture synthesis failed: ${result.stderr.toString().slice(-400)}`);
  }
}
