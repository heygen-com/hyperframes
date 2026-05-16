import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  deleteStackOutputs,
  listStackNames,
  readStackOutputs,
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
  stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
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
});
