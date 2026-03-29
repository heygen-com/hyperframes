// packages/engine/src/utils/gpuDetector.ts
/**
 * GPU Hardware Detection
 *
 * Detects whether the machine has a real GPU available for Chrome rendering
 * (not just FFmpeg encoding). Returns the optimal Chrome GL flags.
 */

import { execSync } from "child_process";
import { accessSync } from "fs";

export interface GpuHardwareInfo {
  hasGpu: boolean;
  gpuType: "nvidia" | "amd" | "intel" | "none";
  renderer: "gpu" | "swiftshader";
  chromeGlFlags: string[];
}

let cachedInfo: GpuHardwareInfo | undefined;

export function detectGpuHardware(): GpuHardwareInfo {
  if (cachedInfo) return cachedInfo;

  let hasGpu = false;
  let gpuType: GpuHardwareInfo["gpuType"] = "none";

  try {
    // Check for NVIDIA GPU
    const lspci = execSync("lspci 2>/dev/null || true", { encoding: "utf-8", timeout: 5000 });
    if (/nvidia/i.test(lspci)) {
      gpuType = "nvidia";
      // Verify driver is loaded
      try {
        execSync("nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null", { timeout: 5000 });
        hasGpu = true;
      } catch {
        // nvidia-smi failed — driver not loaded
      }
    } else if (/amd.*radeon|amd.*rx/i.test(lspci)) {
      gpuType = "amd";
      hasGpu = fileExistsSync("/dev/dri/renderD128");
    } else if (/intel.*graphics|intel.*uhd|intel.*iris/i.test(lspci)) {
      gpuType = "intel";
      hasGpu = fileExistsSync("/dev/dri/renderD128");
    }
  } catch {
    // lspci not available — assume no GPU
  }

  // Also check for /dev/dri/renderD128 (Linux DRI device)
  if (!hasGpu) {
    try {
      hasGpu = fileExistsSync("/dev/dri/renderD128");
      if (hasGpu && gpuType === "none") gpuType = "intel"; // likely integrated
    } catch {}
  }

  const renderer = hasGpu ? "gpu" : "swiftshader";
  const chromeGlFlags = hasGpu
    ? [
        "--use-gl=angle",
        "--use-angle=gl-egl",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--enable-gpu-compositing",
        "--ignore-gpu-blocklist",
      ]
    : [
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ];

  cachedInfo = { hasGpu, gpuType, renderer, chromeGlFlags };
  return cachedInfo;
}

function fileExistsSync(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
