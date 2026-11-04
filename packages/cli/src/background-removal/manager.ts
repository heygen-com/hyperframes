import { existsSync, mkdirSync } from "node:fs";
import { platform, arch } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../utils/download.js";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";

export const MODELS_DIR = hyperframesCacheDir("background-removal", "models");

export const DEFAULT_MODEL = "u2net_human_seg" as const;
export type ModelId = typeof DEFAULT_MODEL;

const MODEL_URLS: Record<ModelId, string> = {
  u2net_human_seg:
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
};

export const MODEL_MEMORY_MB: Record<ModelId, number> = {
  u2net_human_seg: 1500,
};

export const DEVICES = ["auto", "cpu", "coreml", "cuda"] as const;
export type Device = (typeof DEVICES)[number];

export function isDevice(value: unknown): value is Device {
  return typeof value === "string" && (DEVICES as readonly string[]).includes(value);
}

export interface ProviderChoice {
  providers: string[];
  label: "CoreML" | "CUDA" | "CPU";
}

export function selectProviders(device: Device = "auto"): ProviderChoice {
  if (device === "cpu") return { providers: ["cpu"], label: "CPU" };

  const available = listAvailableProviders();
  const hasCoreML = available.includes("coreml");
  const hasCUDA = available.includes("cuda");

  if (device === "coreml") {
    if (!hasCoreML) {
      throw new Error(
        "CoreML execution provider not available. Install onnxruntime-node on Apple Silicon, or use --device cpu.",
      );
    }
    return { providers: ["coreml", "cpu"], label: "CoreML" };
  }
  if (device === "cuda") {
    if (!hasCUDA) {
      throw new Error(
        "CUDA execution provider not available. Use --device cpu or install an onnxruntime-node build with CUDA support.",
      );
    }
    return { providers: ["cuda", "cpu"], label: "CUDA" };
  }

  if (hasCoreML && platform() === "darwin" && arch() === "arm64") {
    return { providers: ["coreml", "cpu"], label: "CoreML" };
  }
  if (hasCUDA) return { providers: ["cuda", "cpu"], label: "CUDA" };
  return { providers: ["cpu"], label: "CPU" };
}

let _cachedProviders: string[] | undefined;
export function listAvailableProviders(): string[] {
  if (_cachedProviders) return _cachedProviders;

  // The npm onnxruntime-node ships with CPU on every platform and bundles the
  // CoreML EP only on darwin-arm64. CUDA is opt-in via a separate gpu build —
  // gate behind an env var so we don't try to bind to a missing EP.
  const out: string[] = ["cpu"];
  if (platform() === "darwin" && arch() === "arm64") out.push("coreml");
  if (process.env["HYPERFRAMES_CUDA"] === "1") out.push("cuda");
  _cachedProviders = out;
  return out;
}

export function modelPath(model: ModelId = DEFAULT_MODEL): string {
  return join(MODELS_DIR, `${model}.onnx`);
}

export async function ensureModel(
  model: ModelId = DEFAULT_MODEL,
  options?: { onProgress?: (message: string) => void },
): Promise<string> {
  const dest = modelPath(model);
  if (existsSync(dest)) return dest;

  mkdirSync(MODELS_DIR, { recursive: true });
  options?.onProgress?.(`Downloading ${model} weights (~168 MB)...`);
  await downloadFile(MODEL_URLS[model], dest);

  if (!existsSync(dest)) {
    throw new Error(`Model download failed: ${model}`);
  }
  return dest;
}
