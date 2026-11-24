import { spawn } from "node:child_process";

const checks = new Map<string, Promise<boolean>>();

/** Whether this ffmpeg has the zscale and tonemap filters (libzimg) that the HDR to SDR copy needs. */
export function ffmpegHasHdrFilters(ffmpegPath: string): Promise<boolean> {
  const known = checks.get(ffmpegPath);
  if (known) return known;
  const check = new Promise<boolean>((resolveCheck) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-filters"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.on("error", () => resolveCheck(false));
    proc.on("close", (code) =>
      resolveCheck(code === 0 && /\bzscale\b/.test(stdout) && /\btonemap\b/.test(stdout)),
    );
  });
  checks.set(ffmpegPath, check);
  return check;
}
