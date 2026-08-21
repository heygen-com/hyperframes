/**
 * Unit tests for the Cloudflare Sandbox adapter.
 *
 * Drive the shipped `resolveChunkPlan` / `plan` / adapter orchestration.
 * No live Cloudflare — I/O is injected.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, resolveChunkPlan } from "./plan.js";
import { PLAN_PROTOCOL_V1 } from "./planProtocol.js";
import {
  HEYGEN_PROMO_TOTAL_FRAMES,
  CLOUDFLARE_ACCOUNT_ID,
  SANDBOX_MAX_INSTANCES,
  formatCloudflareAccountPin,
  heygenPromoDistributedConfig,
  renderViaSandboxes,
  resolveSandboxFanout,
  sandboxIdForChunk,
  sandboxRenderToPerfSummary,
} from "./cloudflareSandbox.js";
import type { AssembleResult } from "./assemble.js";
import type { ChunkResult } from "./renderChunk.js";
import type { PlanResult } from "./plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const WRANGLER_PATH = join(here, "../../../cloudflare-sandbox/wrangler.jsonc");

const FIXTURE_16S = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>sandbox-plan fixture</title></head>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="16">
    <p>sandbox-plan fixture</p>
  </div>
</body>
</html>`;

let runRoot: string;
let projectDir: string;

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-cf-sandbox-test-"));
  projectDir = join(runRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), FIXTURE_16S, "utf-8");
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

function emptyChunk(outputPath: string, index: number): ChunkResult {
  return {
    outputPath,
    outputKind: "file",
    framesEncoded: 48,
    sha256: `chunk-${index}`,
    durationMs: 10,
    planHashMs: 1,
    sessionBootMs: 1,
    captureStageMs: 7,
    encodeStageMs: 1,
    workers: 1,
    perfPath: `${outputPath}.json`,
  };
}

describe("Cloudflare fleet pin", () => {
  it("pins the configured Cloudflare account and a ≤10 instance cap", () => {
    expect(CLOUDFLARE_ACCOUNT_ID).toBe("86bb57b655af7915f42b29dfc2d8807d");
    expect(SANDBOX_MAX_INSTANCES).toBe(10);
    const pin = formatCloudflareAccountPin();
    expect(pin).toContain("account_id=86bb57b655af7915f42b29dfc2d8807d");
    expect(pin).toContain("max_instances=10");
  });

  it("wrangler.jsonc matches the same account and cap", () => {
    const raw = readFileSync(WRANGLER_PATH, "utf-8");
    const json = JSON.parse(raw.replace(/\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as {
      account_id: string;
      containers: Array<{ max_instances: number; instance_type: string }>;
    };
    expect(json.account_id).toBe(CLOUDFLARE_ACCOUNT_ID);
    expect(json.containers[0]?.max_instances).toBeLessThanOrEqual(SANDBOX_MAX_INSTANCES);
    expect(json.containers[0]?.max_instances).toBeGreaterThanOrEqual(1);
    expect(json.containers[0]?.instance_type).toBe("standard-3");
  });
});

describe("resolveSandboxFanout", () => {
  it("uses shipped resolveChunkPlan for 480 frames / 10 sandboxes", () => {
    const shipped = resolveChunkPlan(HEYGEN_PROMO_TOTAL_FRAMES, undefined, 10);
    const fanout = resolveSandboxFanout(HEYGEN_PROMO_TOTAL_FRAMES, 10);
    expect(fanout.chunkCount).toBe(shipped.chunkCount);
    expect(fanout.effectiveChunkSize).toBe(shipped.effectiveChunkSize);
    expect(fanout.chunkCount).toBeGreaterThanOrEqual(1);
    expect(fanout.chunkCount).toBeLessThanOrEqual(10);
    expect(fanout.sandboxIds).toHaveLength(fanout.chunkCount);
    expect(fanout.sandboxIds[0]).toBe("hf-chunk-0");
    expect(fanout.sandboxIds.at(-1)).toBe(sandboxIdForChunk(fanout.chunkCount - 1));
  });

  it("never opens more than 10 sandboxes even if asked", () => {
    const fanout = resolveSandboxFanout(HEYGEN_PROMO_TOTAL_FRAMES, 99);
    expect(fanout.maxSandboxes).toBe(10);
    expect(fanout.chunkCount).toBeLessThanOrEqual(10);
  });
});

describe("plan() wiring", () => {
  it("plans a 16s/30fps composition into ≤10 chunks via the adapter config", async () => {
    const planDir = join(runRoot, "plan-real");
    mkdirSync(planDir, { recursive: true });
    const result = await plan(projectDir, heygenPromoDistributedConfig(10), planDir);
    expect(result.totalFrames).toBe(HEYGEN_PROMO_TOTAL_FRAMES);
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(result.chunkCount).toBeLessThanOrEqual(10);
    const expected = resolveChunkPlan(result.totalFrames, undefined, 10);
    expect(result.chunkCount).toBe(expected.chunkCount);
  });
});

describe("renderViaSandboxes", () => {
  it("calls plan → renderChunk × N → assemble and stays within 10 sandboxes", async () => {
    const calls: string[] = [];
    const chunkIndexes: number[] = [];
    const fakePlan: PlanResult = {
      planDir: join(runRoot, "fake-plan"),
      planProtocol: PLAN_PROTOCOL_V1,
      planHash: "test",
      chunkCount: 10,
      totalFrames: 480,
      fps: 30,
      width: 1920,
      height: 1080,
      format: "mp4",
      ffmpegVersion: "test",
      producerVersion: "test",
    };
    const fakeAssemble: AssembleResult = {
      outputPath: join(runRoot, "out.mp4"),
      durationMs: 5,
      framesEncoded: 480,
      fileSize: 100,
    };

    const result = await renderViaSandboxes({
      projectDir,
      outputPath: fakeAssemble.outputPath,
      workDir: join(runRoot, "orch"),
      maxSandboxes: 10,
      primitives: {
        plan: async () => {
          calls.push("plan");
          return fakePlan;
        },
        renderChunk: async (_planDir, chunkIndex, outputChunkPath) => {
          calls.push("renderChunk");
          chunkIndexes.push(chunkIndex);
          return emptyChunk(outputChunkPath, chunkIndex);
        },
        assemble: async () => {
          calls.push("assemble");
          return fakeAssemble;
        },
      },
    });

    expect(calls[0]).toBe("plan");
    expect(calls.at(-1)).toBe("assemble");
    expect(calls.filter((c) => c === "renderChunk")).toHaveLength(10);
    expect(chunkIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.sandboxIds).toHaveLength(10);
    expect(result.accountId).toBe(CLOUDFLARE_ACCOUNT_ID);
    expect(result.plan.chunkCount).toBeLessThanOrEqual(10);
    expect(result.plan.chunkCount).toBeGreaterThanOrEqual(1);

    const summary = sandboxRenderToPerfSummary(result, { renderId: "t", workers: 10 });
    expect(summary.totalFrames).toBe(480);
    expect(summary.workers).toBe(10);
  });
});
