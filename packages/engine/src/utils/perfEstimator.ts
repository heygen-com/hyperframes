/**
 * Performance Estimator
 *
 * Estimates rendering speed based on detected hardware.
 */

import { detectGpuHardware, type GpuHardwareInfo } from "./gpuDetector.js";
import { getCachedGpuEncoder, type GpuEncoder } from "./gpuEncoder.js";

export interface PerfEstimate {
  hardware: {
    gpu: GpuHardwareInfo;
    gpuEncoder: GpuEncoder;
  };
  estimates: {
    captureMsPerFrame: { min: number; typical: number; max: number };
    encodeSpeedup: string;
    overallSpeedup: string;
  };
  recommendations: string[];
}

export async function estimatePerformance(): Promise<PerfEstimate> {
  const gpu = detectGpuHardware();
  const gpuEncoder = await getCachedGpuEncoder();
  const recommendations: string[] = [];

  if (!gpu.hasGpu) {
    recommendations.push(
      "No GPU detected — using SwiftShader (CPU) for rendering. Deploy on a GPU instance (e.g., AWS g5 with NVIDIA A10G) for 10-30x speedup.",
    );
  }
  if (!gpuEncoder) {
    recommendations.push(
      "No hardware video encoder detected. NVIDIA GPU with NVENC support enables 5-10x faster encoding.",
    );
  }
  if (gpu.hasGpu && gpu.gpuType === "nvidia" && gpuEncoder === "nvenc") {
    recommendations.push(
      "NVIDIA GPU with NVENC detected — optimal configuration. Expected 10-30x speedup over CPU-only rendering.",
    );
  }

  const captureEstimate = gpu.hasGpu
    ? { min: 1, typical: 3, max: 8 }
    : { min: 5, typical: 10, max: 50 };

  const encodeSpeedup = gpuEncoder ? "5-10x (hardware encoder)" : "1x (software libx264)";
  const overallSpeedup = gpu.hasGpu && gpuEncoder
    ? "10-30x vs CPU baseline"
    : gpu.hasGpu ? "5-10x (GPU raster, software encode)"
    : gpuEncoder ? "2-3x (CPU raster, hardware encode)"
    : "1-2x (CPU only, software optimizations)";

  return {
    hardware: { gpu, gpuEncoder },
    estimates: { captureMsPerFrame: captureEstimate, encodeSpeedup, overallSpeedup },
    recommendations,
  };
}
