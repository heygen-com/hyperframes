/**
 * CLI entry used inside a Cloudflare sandbox.
 *
 * Bun swallows unknown `--flags`, so configuration is via env vars:
 *
 *   HF_ACTION=render HF_PLAN_DIR=... HF_CHUNK_INDEX=0 HF_OUTPUT=... bun chunk-worker.mjs
 *   HF_ACTION=plan HF_PROJECT_DIR=... HF_PLAN_DIR=... HF_MAX_SANDBOXES=10 bun chunk-worker.mjs
 */
import { heygenPromoDistributedConfig } from "./cloudflareSandbox.js";
import { plan } from "./plan.js";
import { renderChunk } from "./renderChunk.js";

function env(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (required && (!value || value.length === 0)) throw new Error(`missing env ${name}`);
  return value;
}

const action = env("HF_ACTION", false) ?? "render";

if (action === "plan") {
  const projectDir = env("HF_PROJECT_DIR")!;
  const planDir = env("HF_PLAN_DIR")!;
  const maxSandboxes = Number(env("HF_MAX_SANDBOXES", false) ?? "10");
  const result = await plan(projectDir, heygenPromoDistributedConfig(maxSandboxes), planDir);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (action === "render") {
  const planDir = env("HF_PLAN_DIR")!;
  const chunkIndex = Number(env("HF_CHUNK_INDEX"));
  const output = env("HF_OUTPUT")!;
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error(`invalid HF_CHUNK_INDEX ${String(chunkIndex)}`);
  }
  const result = await renderChunk(planDir, chunkIndex, output);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  throw new Error(`unknown HF_ACTION ${action}`);
}
