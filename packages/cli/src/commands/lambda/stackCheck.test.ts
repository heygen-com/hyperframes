import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  assertStackReadsSites: vi.fn(),
  deploySite: vi.fn(),
  renderToLambda: vi.fn(),
  siteHandleFromId: vi.fn(),
}));
vi.mock("@hyperframes/aws-lambda/sdk", () => sdk);
vi.mock("./state.js", () => ({
  DEFAULT_STACK_NAME: "hyperframes",
  requireStack: () => ({
    bucketName: "test-bucket",
    stateMachineArn: "arn:aws:states:us-east-2:1234:stateMachine:hf",
    region: "us-east-2",
    reservedConcurrency: 8,
  }),
}));

import { runRenderBatch } from "./render-batch.js";
import { runSitesCreate } from "./sites.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hf-stack-check-"));
  writeFileSync(join(projectDir, "index.html"), "<html></html>");
  writeFileSync(join(projectDir, "batch.jsonl"), '{"outputKey":"renders/a.mp4"}\n');
  sdk.assertStackReadsSites.mockRejectedValue(
    Object.assign(new Error("STACK_TOO_OLD"), { name: "STACK_TOO_OLD" }),
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("a stack too old to read sites is refused before anything uploads", () => {
  it("in render-batch", async () => {
    await expect(
      runRenderBatch({
        projectDir,
        stackName: "hyperframes",
        batch: join(projectDir, "batch.jsonl"),
        fps: 30,
        width: 1920,
        height: 1080,
        format: "mp4",
        json: true,
      }),
    ).rejects.toMatchObject({ name: "STACK_TOO_OLD" });
    expect(sdk.deploySite).not.toHaveBeenCalled();
  });

  it("in sites create", async () => {
    await expect(
      runSitesCreate({ projectDir, stackName: "hyperframes", json: true }),
    ).rejects.toMatchObject({ name: "STACK_TOO_OLD" });
    expect(sdk.deploySite).not.toHaveBeenCalled();
  });
});
