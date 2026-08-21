import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliRuntimeError } from "../../utils/commandResult.js";
import {
  buildLambdaBatchRenderConfig,
  parseBatchFile,
  runWithConcurrencyLimit,
  type RenderBatchArgs,
} from "./render-batch.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hf-render-batch-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeBatch(content: string): string {
  const p = join(tmpDir, "batch.jsonl");
  writeFileSync(p, content, "utf8");
  return p;
}

describe("runWithConcurrencyLimit", () => {
  it("preserves input order in the output array regardless of completion order", async () => {
    // First input takes longest to resolve; output array still positional.
    const delays = [40, 10, 20];
    const out = await runWithConcurrencyLimit(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `done-${i}`;
    });
    expect(out).toEqual(["done-0", "done-1", "done-2"]);
  });

  it("caps simultaneous in-flight work to the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const inputs = Array.from({ length: 12 }, (_, i) => i);
    const worker = async (i: number): Promise<number> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    };
    await runWithConcurrencyLimit(inputs, 3, worker);
    expect(peak).toBe(3);
  });

  it("does not exceed the input length even when limit > inputs.length", async () => {
    let inFlight = 0;
    let peak = 0;
    const inputs = [1, 2];
    await runWithConcurrencyLimit(inputs, 50, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return n;
    });
    // Only 2 inputs → only 2 concurrent workers, even with limit=50.
    expect(peak).toBe(2);
  });

  it("rejects a limit < 1", async () => {
    await expect(runWithConcurrencyLimit([1, 2], 0, async (n) => n)).rejects.toThrow(
      /limit must be/,
    );
  });

  it("returns immediately for an empty input array", async () => {
    const out = await runWithConcurrencyLimit([], 10, async (n: number) => n * 2);
    expect(out).toEqual([]);
  });

  it("propagates the first worker rejection", async () => {
    await expect(
      runWithConcurrencyLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe("parseBatchFile", () => {
  it("parses a JSONL file into ordered entries (line numbers preserve source order)", () => {
    const path = writeBatch(
      [
        '{"outputKey":"renders/alice.mp4","variables":{"name":"Alice"}}',
        '{"outputKey":"renders/bob.mp4","variables":{"name":"Bob"},"executionName":"hf-bob-001"}',
      ].join("\n") + "\n",
    );
    const out = parseBatchFile(path);
    expect(out).toHaveLength(2);
    expect(out[0]?.entry.outputKey).toBe("renders/alice.mp4");
    expect(out[0]?.entry.variables).toEqual({ name: "Alice" });
    expect(out[0]?.lineNumber).toBe(1);
    expect(out[1]?.entry.executionName).toBe("hf-bob-001");
    expect(out[1]?.lineNumber).toBe(2);
  });

  it("skips blank lines and preserves line numbers", () => {
    const path = writeBatch(
      ["", '{"outputKey":"renders/a.mp4"}', "", "", '{"outputKey":"renders/b.mp4"}'].join("\n") +
        "\n",
    );
    const out = parseBatchFile(path);
    expect(out).toHaveLength(2);
    expect(out[0]?.lineNumber).toBe(2);
    expect(out[1]?.lineNumber).toBe(5);
  });

  // Keep malformed input assertions focused on the typed command boundary.
  function expectExitOne(content: string): void {
    expect(() => parseBatchFile(writeBatch(content))).toThrow(CliRuntimeError);
  }

  it("exits with a clear message on malformed JSON, naming the offending line", () => {
    expectExitOne(['{"outputKey":"renders/a.mp4"}', "{not json"].join("\n"));
  });

  it("rejects entries missing outputKey", () => {
    expectExitOne('{"variables":{"name":"Alice"}}\n');
  });

  it("rejects variables that's not a plain object", () => {
    expectExitOne('{"outputKey":"renders/a.mp4","variables":[1,2,3]}\n');
  });
});

// See `../cloudrun.test.ts` / `./render.test.ts` for the sibling wire-config
// coverage. Repeating it at every entrypoint is deliberate: cross-scaffold
// drift is exactly what shipped PR #2529 R2 CHANGES_REQUESTED.
describe("buildLambdaBatchRenderConfig — aspect-agnostic wire threading", () => {
  const baseArgs: RenderBatchArgs = {
    projectDir: "/tmp/hf-batch",
    stackName: "hf-test",
    batch: "/tmp/batch.jsonl",
    fps: 30,
    width: 1080,
    height: 1920,
    format: "mp4",
    json: false,
  };

  it("threads outputResolutionAspectAgnostic=true through for portrait 1080p", () => {
    // The batch entrypoint fans out N Step Functions executions from a
    // single wire config, so a dropped alias flag multiplies into N broken
    // renders — pin it here.
    const config = buildLambdaBatchRenderConfig({
      ...baseArgs,
      outputResolution: "landscape",
      outputResolutionAspectAgnostic: true,
    });
    expect(config.outputResolution).toBe("landscape");
    expect(config.outputResolutionAspectAgnostic).toBe(true);
  });

  it("keeps the aspect-agnostic key absent when the flag is a canonical preset", () => {
    const config = buildLambdaBatchRenderConfig({ ...baseArgs, outputResolution: "portrait-4k" });
    expect(config.outputResolution).toBe("portrait-4k");
    expect(config.outputResolutionAspectAgnostic).toBeUndefined();
  });
});
