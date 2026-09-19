import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const here = dirname(fileURLToPath(import.meta.url));
const three = resolve(here, "../node_modules/three/src");
const dir = mkdtempSync(resolve(tmpdir(), "frost-shard-compile-"));
try {
  const outfile = resolve(dir, "probe.mjs");
  await build({
    entryPoints: [resolve(here, "shard-compile-probe.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    alias: {
      "three/webgpu": resolve(three, "Three.WebGPU.js"),
      "three/tsl": resolve(three, "Three.TSL.js"),
    },
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
