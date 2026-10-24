import { runCommand } from "citty";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import benchmark from "./benchmark.js";

const producer = vi.hoisted(() => ({ executeRenderJob: vi.fn<() => Promise<void>>() }));
vi.mock("../utils/producer.js", () => ({
  loadProducer: async () => ({
    createRenderJob: (config: unknown) => ({ config }),
    executeRenderJob: producer.executeRenderJob,
  }),
}));

let projectDir: string;
let clock: number;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hyperframes-benchmark-"));
  writeFileSync(join(projectDir, "index.html"), "<div></div>");
  vi.spyOn(process, "cwd").mockReturnValue(projectDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  clock = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  producer.executeRenderJob.mockReset();
  producer.executeRenderJob.mockResolvedValue(undefined);
  consumeCommandResult();
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

async function runBenchmark(json: boolean, runs = 1) {
  await runCommand(benchmark, {
    rawArgs: [projectDir, "--runs", String(runs), ...(json ? ["--json"] : [])],
  });
  return consumeCommandResult();
}

describe.each([true, false])("benchmark (json=%s)", (json) => {
  it.each([1, 2])("reports failure after all configs exhaust %i runs", async (runs) => {
    producer.executeRenderJob.mockRejectedValue(new Error("Audio decoding failed"));

    expect(await runBenchmark(json, runs)).toMatchObject({
      exitCode: 1,
      kind: "runtime_error",
      presented: true,
    });
    expect(producer.executeRenderJob).toHaveBeenCalledTimes(5 * runs);

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    if (json) {
      expect(output).toHaveLength(1);
      const payload: unknown = JSON.parse(output[0] ?? "");
      expect(payload).toMatchObject({
        results: Array.from({ length: 5 }, () => ({
          failures: runs,
          runs: [],
          avgTimeMs: null,
          avgSizeBytes: null,
        })),
        _meta: expect.any(Object),
      });
    } else {
      expect(output.join("\n")).toContain("All configurations failed");
    }
  });

  it("succeeds when every configuration renders", async () => {
    expect(await runBenchmark(json)).toMatchObject({ exitCode: 0, kind: "success" });
    expect(producer.executeRenderJob).toHaveBeenCalledTimes(5);
  });

  it("keeps the successful run when the other configurations fail", async () => {
    producer.executeRenderJob
      .mockRejectedValue(new Error("Configuration cannot render"))
      .mockResolvedValueOnce(undefined);

    expect(await runBenchmark(json)).toMatchObject({ exitCode: 0, kind: "success" });
    expect(producer.executeRenderJob).toHaveBeenCalledTimes(5);
  });

  it("accepts completed runs that take less than one millisecond", async () => {
    vi.mocked(Date.now).mockReturnValue(0);

    expect(await runBenchmark(json)).toMatchObject({ exitCode: 0, kind: "success" });
  });
});
