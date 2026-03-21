import { spawn } from "child_process";

const durationCache = new Map<string, number>();

export async function probeMediaDuration(src: string): Promise<number> {
  const cached = durationCache.get(src);
  if (cached !== undefined) return cached;

  const duration = await runFFprobe(src);
  durationCache.set(src, duration);
  return duration;
}

function runFFprobe(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      src,
    ];

    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.warn(`[FFprobe] Failed for ${src}: exit ${code}`);
        resolve(0);
        return;
      }
      try {
        const output = JSON.parse(stdout);
        const duration = parseFloat(output?.format?.duration ?? "0");
        console.log(`[FFprobe] ${src.slice(-40)}: ${duration}s`);
        resolve(duration);
      } catch {
        console.warn(`[FFprobe] Parse error for ${src}`);
        resolve(0);
      }
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn("[FFprobe] ffprobe not found, skipping duration resolution");
      }
      resolve(0);
    });
  });
}
