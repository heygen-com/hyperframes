import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateFilePath, writeStackOutputs } from "./state.js";

const samDirs = vi.hoisted(() => [] as string[]);
const root = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("./repoRoot.js", () => ({ repoRoot: () => root.value }));
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

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

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
  root.value = undefined;
  process.chdir(previousCwd);
  rmSync(cwd, { recursive: true, force: true });
});

const stack = {
  stackName: "Demo",
  region: "us-east-1",
  bucketName: "demo-bucket",
  stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:hf",
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

  it("in a source checkout, says which checkout it deletes from and runs sam there", async () => {
    writeStackOutputs(stack, cwd);
    root.value = cwd;

    await runDestroy({ stackName: "Demo" });

    expect(samDirs).toEqual([join(cwd, "examples", "aws-lambda")]);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      `Using the source checkout at ${cwd}`,
    );
  });

  it("deletes the stack's own video repository, whatever name the state file records", async () => {
    writeStackOutputs({ ...stack, videoRepository: "someone-elses-repo" }, cwd);

    await runDestroy({ stackName: "Demo" });

    expect(deleteEcrRepository).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryName: "demo-video" }),
    );
  });

  // fails without the fix: the stack name, in the progress lines, is printed as it is stored.
  it.skipIf(process.platform === "win32")(
    "shows control characters in the stack and repository names as text",
    async () => {
      const stackName = `De${ODD}mo`;
      writeStackOutputs({ ...stack, stackName, videoRepository: "repo" }, cwd);

      await runDestroy({ stackName });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain(`sam delete (stack=De${SHOWN}mo region=us-east-1)`);
      expect(printed).toContain(`Deleting ECR repository de${SHOWN.toLowerCase()}mo-video`);
      expect(printed).not.toContain(ESC);
      expect(samDelete).toHaveBeenCalledWith(expect.objectContaining({ stackName }));
    },
  );
});
