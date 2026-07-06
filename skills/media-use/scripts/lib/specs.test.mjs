import { strict as assert } from "node:assert";
import { test } from "node:test";
import { probeSpecs } from "./specs.mjs";

// Fake os module + exec so the probe is deterministic across CI machines.
const fakeOs = (over = {}) => ({
  platform: () => over.platform ?? "linux",
  arch: () => over.arch ?? "x64",
  cpus: () => Array.from({ length: over.cores ?? 8 }),
  totalmem: () => (over.ramMB ?? 16384) * 1024 * 1024,
});

test("probeSpecs reports structured caps", () => {
  const s = probeSpecs({ osMod: fakeOs({ cores: 12, ramMB: 32768 }), exec: () => null });
  assert.equal(s.cpuCores, 12);
  assert.equal(s.ramMB, 32768);
  assert.equal(s.platform, "linux");
  assert.equal(s.gpu.present, false);
  // probe unavailable (exec returns null) -> availableRamMB falls back to total
  assert.equal(s.availableRamMB, 32768);
});

test("availableRamMB is read from /proc/meminfo on Linux", () => {
  const exec = (cmd) =>
    cmd.includes("meminfo") ? "MemTotal: 33554432 kB\nMemAvailable: 8388608 kB\n" : null;
  const s = probeSpecs({ osMod: fakeOs({ platform: "linux", ramMB: 32768 }), exec });
  assert.equal(s.availableRamMB, 8192, "8388608 kB -> 8192 MB");
});

test("availableRamMB is summed from reclaimable vm_stat pages on macOS", () => {
  const vmStat =
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n" +
    "Pages free:                    100000.\n" +
    "Pages inactive:                200000.\n" +
    "Pages speculative:              50000.\n" +
    "Pages purgeable:                 10000.\n";
  const exec = (cmd) => (cmd.includes("vm_stat") ? vmStat : null);
  const s = probeSpecs({
    osMod: fakeOs({ platform: "darwin", arch: "arm64", ramMB: 24576 }),
    exec,
  });
  // (100000+200000+50000+10000) pages * 16384 B / 1MiB = 5625 MB
  assert.equal(s.availableRamMB, 5625);
});

test("Apple Silicon is detected as a unified-memory GPU", () => {
  const s = probeSpecs({
    osMod: fakeOs({ platform: "darwin", arch: "arm64", ramMB: 24576 }),
    exec: () => null,
  });
  assert.equal(s.appleSilicon, true);
  assert.equal(s.gpu.present, true);
  assert.equal(s.gpu.kind, "apple");
  // unified memory: VRAM tracks system RAM
  assert.equal(s.gpu.vramMB, 24576);
});

test("NVIDIA GPU is detected via nvidia-smi VRAM query", () => {
  const exec = (cmd) => (cmd.includes("nvidia-smi") ? "24564" : null);
  const s = probeSpecs({ osMod: fakeOs({ platform: "linux" }), exec });
  assert.equal(s.gpu.present, true);
  assert.equal(s.gpu.kind, "nvidia");
  assert.equal(s.gpu.vramMB, 24564);
});

test("no GPU when nvidia-smi is absent / fails", () => {
  const s = probeSpecs({
    osMod: fakeOs({ platform: "linux" }),
    exec: () => {
      throw new Error("command not found");
    },
  });
  assert.equal(s.gpu.present, false);
  assert.equal(s.gpu.vramMB, 0);
});
