// Machine-capability probe for the spec-gated local-model fallback.
//
// Local models are USER-INSTALLED and local-use-only — media-use recommends,
// spec-checks, and assists install, but never bundles or runs them as a service.
// This probe answers "what tier can this machine actually run?" so selection can
// offer a medium/large local model, or fall back to recommending the CLI path.
//
// `osMod` and `exec` are injectable for tests. `exec(cmd)` returns the command's
// stdout as a string, or throws / returns null on failure.

import os from "node:os";
import { execSync } from "node:child_process";

function defaultExec(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 });
}

// Available (not just total) RAM — the real budget for "will this model fit
// alongside the OS + open apps". On unified-memory Macs the model shares system
// RAM, so a big model on a busy machine OOMs/thrashes even if total RAM looks
// ample. macOS: vm_stat free + inactive + speculative + purgeable pages (all
// reclaimable). Linux: /proc/meminfo MemAvailable. Fallback: total (optimistic
// but stable when the probe is unavailable, e.g. in tests).
function availableRamMB(platform, exec, totalMB) {
  try {
    if (platform === "darwin") {
      const out = String(exec("vm_stat"));
      const pageSize = parseInt((out.match(/page size of (\d+)/) || [])[1] || "16384", 10);
      const pages = (name) => {
        const m = out.match(new RegExp(`${name}:\\s+(\\d+)`));
        return m ? parseInt(m[1], 10) : 0;
      };
      const reclaimable =
        pages("Pages free") +
        pages("Pages inactive") +
        pages("Pages speculative") +
        pages("Pages purgeable");
      const mb = Math.round((reclaimable * pageSize) / (1024 * 1024));
      if (mb > 0) return mb;
    } else if (platform === "linux") {
      const out = String(exec("cat /proc/meminfo"));
      const m = out.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (m) return Math.round(parseInt(m[1], 10) / 1024);
    }
  } catch {
    // probe unavailable — fall through to the total-RAM estimate
  }
  return totalMB;
}

function detectGpu(platform, arch, ramMB, exec) {
  // Apple Silicon: Metal GPU with unified memory — VRAM tracks system RAM.
  if (platform === "darwin" && arch === "arm64") {
    return { present: true, kind: "apple", vramMB: ramMB };
  }
  // NVIDIA: query total VRAM. Any failure (no driver, no GPU) -> no GPU.
  try {
    const out = exec("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits");
    const mb = parseInt(String(out).trim().split(/\r?\n/)[0], 10);
    if (Number.isFinite(mb) && mb > 0) return { present: true, kind: "nvidia", vramMB: mb };
  } catch {
    // fall through — no usable GPU
  }
  return { present: false, kind: null, vramMB: 0 };
}

export function probeSpecs({ osMod = os, exec = defaultExec } = {}) {
  const platform = osMod.platform();
  const arch = osMod.arch();
  const cpuCores = osMod.cpus().length;
  const ramMB = Math.round(osMod.totalmem() / (1024 * 1024));
  return {
    platform,
    arch,
    cpuCores,
    ramMB,
    availableRamMB: availableRamMB(platform, exec, ramMB),
    appleSilicon: platform === "darwin" && arch === "arm64",
    gpu: detectGpu(platform, arch, ramMB, exec),
  };
}
