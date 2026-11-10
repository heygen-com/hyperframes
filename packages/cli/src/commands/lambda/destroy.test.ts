import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateFilePath, writeStackOutputs } from "./state.js";

const samDirs = vi.hoisted(() => [] as string[]);
vi.mock("./repoRoot.js", () => ({ repoRoot: () => undefined }));
vi.mock("./sam.js", () => ({
  samDelete: vi.fn((opts: { samDir: string }) => {
    samDirs.push(opts.samDir);
  }),
  deleteEcrRepository: vi.fn(),
}));

const { runDestroy } = await import("./destroy.js");
const { deleteEcrRepository, samDelete } = await import("./sam.js");

let cwd: string;
let previousCwd: string;
let quiet: { mockRestore(): void };

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "hf-lambda-destroy-"));
  previousCwd = process.cwd();
  process.chdir(cwd);
  samDirs.length = 0;
  vi.mocked(samDelete).mockClear();
  vi.mocked(deleteEcrRepository).mockClear();
  quiet = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  process.chdir(previousCwd);
  rmSync(cwd, { recursive: true, force: true });
});

const stack = {
  stackName: "Demo",
  region: "us-east-1",
  bucketName: "b",
  stateMachineArn: "s",
  functionName: "f",
  lambdaMemoryMb: 10240,
  deployedAt: "2026-01-01T00:00:00Z",
};

describe("runDestroy", () => {
  it("runs sam delete outside a checkout in a fresh folder it removes afterwards", async () => {
    writeStackOutputs(stack, cwd);

    await runDestroy({ stackName: "Demo" });

    expect(samDirs).toHaveLength(1);
    expect(samDirs[0]).not.toBe(tmpdir());
    expect(existsSync(samDirs[0]!)).toBe(false);
    expect(existsSync(stateFilePath("Demo", cwd))).toBe(false);
  });

  it("deletes the stack's own video repository, whatever name the state file records", async () => {
    writeStackOutputs({ ...stack, videoRepository: "someone-elses-repo" }, cwd);

    await runDestroy({ stackName: "Demo" });

    expect(deleteEcrRepository).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryName: "demo-video" }),
    );
  });
});
