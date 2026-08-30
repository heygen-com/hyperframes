import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeDownload, freeSpaceMB, probeSpecs, weightsCacheDir } from "./specs.mjs";

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

// --- download disclosure: what the user is agreeing to before the pull ---

const fakeHome = { homedir: () => "/home/tester" };
// statfs reports blocks, not bytes: bavail * bsize. 1 MB blocks keep the sums
// readable, and mirror the real struct's shape.
const fakeStatfs = (freeMB, existsOnly) => (path) => {
  if (existsOnly && path !== existsOnly) throw new Error(`ENOENT: ${path}`);
  return { bavail: freeMB, bsize: 1e6 };
};

test("weightsCacheDir follows huggingface_hub's precedence", () => {
  assert.equal(
    weightsCacheDir({ env: {}, osMod: fakeHome }),
    "/home/tester/.cache/huggingface/hub",
  );
  assert.equal(weightsCacheDir({ env: { HF_HOME: "/data/hf" }, osMod: fakeHome }), "/data/hf/hub");
  assert.equal(
    weightsCacheDir({ env: { HF_HOME: "/data/hf", HUGGINGFACE_HUB_CACHE: "/c" }, osMod: fakeHome }),
    "/c",
    "HUGGINGFACE_HUB_CACHE outranks HF_HOME",
  );
  assert.equal(
    weightsCacheDir({ env: { HF_HUB_CACHE: "/a", HUGGINGFACE_HUB_CACHE: "/c" }, osMod: fakeHome }),
    "/a",
    "HF_HUB_CACHE wins outright",
  );
});

test("freeSpaceMB walks up to the deepest existing ancestor", () => {
  // the cache dir does not exist until the first download, and statfs throws
  // on a missing path - so the answer has to come from an ancestor
  const statfs = fakeStatfs(4096, "/home");
  assert.equal(freeSpaceMB("/home/tester/.cache/huggingface/hub", statfs), 4096);
});

test("freeSpaceMB reports null rather than zero when nothing can be read", () => {
  assert.equal(
    freeSpaceMB("/home/tester/.cache", () => {
      throw new Error("EACCES");
    }),
    null,
    "unknown must not be reported as no-space",
  );
});

test("describeDownload names the size and where it lands", () => {
  const msg = describeDownload(87500, {
    statfsFn: fakeStatfs(200000),
    env: {},
    osMod: fakeHome,
  });
  assert.match(msg, /~87\.5GB/);
  assert.match(msg, /\/home\/tester\/\.cache\/huggingface\/hub/);
  assert.match(msg, /200\.0GB free/);
  assert.equal(/NOT fit/.test(msg), false, "it fits, so no warning");
});

test("describeDownload says plainly when the weights will not fit", () => {
  const msg = describeDownload(87500, {
    statfsFn: fakeStatfs(14000),
    env: {},
    osMod: fakeHome,
  });
  assert.match(msg, /only 14\.0GB is free there/);
  assert.match(msg, /will NOT fit as-is/);
  // the tier is still described, not withheld: a machine that could free up
  // space should know the tier exists
  assert.match(msg, /~87\.5GB/);
});

test("describeDownload admits when free space is unknown", () => {
  const msg = describeDownload(87500, {
    statfsFn: () => {
      throw new Error("EACCES");
    },
    env: {},
    osMod: fakeHome,
  });
  assert.match(msg, /free space unknown/);
  assert.equal(/NOT fit/.test(msg), false, "unknown is not a refusal");
});
