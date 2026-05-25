import { platform, release } from "node:os";
import { readFileSync } from "node:fs";

// Shared host-platform detectors used by both system.ts (overall metadata)
// and agent_runtime.ts (sandbox fingerprinting). Lives in its own module
// to avoid an import cycle between those two files.

export function detectWSL(): boolean {
  if (platform() !== "linux") return false;
  try {
    const osRelease = release().toLowerCase();
    if (osRelease.includes("microsoft") || osRelease.includes("wsl")) return true;
    const procVersion = readFileSync("/proc/version", "utf-8").toLowerCase();
    return procVersion.includes("microsoft") || procVersion.includes("wsl");
  } catch {
    return false;
  }
}
