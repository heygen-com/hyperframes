import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  deleteStackOutputs,
  listStackNames,
  readStackOutputs,
  requireStack,
  stateFilePath,
  type StackOutputs,
  writeStackOutputs,
} from "./state.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "hf-lambda-cli-state-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

const sample: StackOutputs = {
  stackName: "test",
  region: "us-east-1",
  bucketName: "bucket-x",
  stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:hf",
  functionName: "hf-render",
  lambdaMemoryMb: 10240,
  deployedAt: "2026-05-16T00:00:00Z",
};

describe("lambda state file", () => {
  it("round-trips outputs through disk", () => {
    const path = writeStackOutputs(sample, workdir);
    expect(path).toBe(stateFilePath("test", workdir));
    const read = readStackOutputs("test", workdir);
    expect(read).toEqual(sample);
  });

  it("returns null when the stack file is missing", () => {
    expect(readStackOutputs("absent", workdir)).toBeNull();
  });

  it("lists stack names by parsing the filename prefix", () => {
    writeStackOutputs({ ...sample, stackName: "alpha" }, workdir);
    writeStackOutputs({ ...sample, stackName: "beta" }, workdir);
    expect(listStackNames(workdir).sort()).toEqual(["alpha", "beta"]);
  });

  it("deleteStackOutputs removes the file (no error if absent)", () => {
    writeStackOutputs(sample, workdir);
    expect(readStackOutputs("test", workdir)).not.toBeNull();
    deleteStackOutputs("test", workdir);
    expect(readStackOutputs("test", workdir)).toBeNull();
    // Re-delete is a no-op.
    deleteStackOutputs("test", workdir);
  });

  it("handles malformed JSON by returning null instead of throwing", () => {
    const path = stateFilePath("bad", workdir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    expect(readStackOutputs("bad", workdir)).toBeNull();
  });

  it("requireStack refuses a file that names a different stack", () => {
    writeStackOutputs({ ...sample, stackName: "other" }, workdir);
    const path = stateFilePath("other", workdir);
    mkdirSync(dirname(stateFilePath("test", workdir)), { recursive: true });
    writeFileSync(stateFilePath("test", workdir), readFileSync(path));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => requireStack("test", workdir)).toThrow();
      expect(requireStack("other", workdir).stackName).toBe("other");
      writeFileSync(stateFilePath("OTHER", workdir), readFileSync(path));
      expect(requireStack("OTHER", workdir).stackName).toBe("other");
    } finally {
      quiet.mockRestore();
    }
  });

  function plant(stackName: string, contents: unknown): void {
    const path = stateFilePath(stackName, workdir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(contents));
  }

  function refusal(stackName: string): string {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => requireStack(stackName, workdir)).toThrow();
      return String(said.mock.calls[0]?.[0]);
    } finally {
      said.mockRestore();
    }
  }

  it.each([
    ["a bucket name S3 would not accept", { bucketName: "Not/A/Bucket" }, "bucketName"],
    [
      "a state machine ARN that is not one",
      { stateMachineArn: "arn:aws:s3:::bucket" },
      "stateMachineArn",
    ],
    [
      "a short account in the ARN",
      { stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf" },
      "stateMachineArn",
    ],
    [
      "a region other than the state machine's",
      { region: "eu-west-1" },
      "a state machine in us-east-1",
    ],
    ["a region that is not one", { region: "../x" }, "region"],
    ["a memory size that is not a number", { lambdaMemoryMb: "10240" }, "lambdaMemoryMb"],
  ])("refuses a stack file with %s", (_name, change, reason) => {
    plant("test", { ...sample, ...change });
    expect(readStackOutputs("test", workdir)).toBeNull();
    expect(refusal("test")).toContain(reason);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a stack file that is a link, and never follows it",
    () => {
      const elsewhere = join(workdir, "elsewhere.json");
      writeFileSync(elsewhere, JSON.stringify(sample));
      mkdirSync(join(workdir, ".hyperframes"));
      symlinkSync(elsewhere, stateFilePath("test", workdir));
      expect(readStackOutputs("test", workdir)).toBeNull();
      expect(refusal("test")).toContain("is a link or not a plain file");
      deleteStackOutputs("test", workdir);
      expect(readFileSync(elsewhere, "utf8")).toBe(JSON.stringify(sample));
    },
  );

  it.skipIf(process.platform === "win32")("refuses a .hyperframes folder that is a link", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "hf-lambda-cli-elsewhere-"));
    try {
      writeStackOutputs(sample, elsewhere);
      symlinkSync(join(elsewhere, ".hyperframes"), join(workdir, ".hyperframes"));
      expect(readStackOutputs("test", workdir)).toBeNull();
      expect(refusal("test")).toContain("is a link or not a plain file");
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
