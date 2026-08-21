import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRunId = process.env["HYPERFRAMES_RUN_ID"];

async function loadGetRunId() {
  const { getRunId } = await import("./runId.js");
  return getRunId;
}

describe("getRunId", () => {
  beforeEach(() => {
    delete process.env["HYPERFRAMES_RUN_ID"];
    vi.resetModules();
  });

  afterEach(() => {
    if (originalRunId === undefined) delete process.env["HYPERFRAMES_RUN_ID"];
    else process.env["HYPERFRAMES_RUN_ID"] = originalRunId;
    vi.resetModules();
  });

  it("returns undefined when HYPERFRAMES_RUN_ID is unset", async () => {
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBeUndefined();
  });

  it("returns undefined when HYPERFRAMES_RUN_ID contains only whitespace", async () => {
    process.env["HYPERFRAMES_RUN_ID"] = "  \t\n  ";
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBeUndefined();
  });

  it("returns a normal HYPERFRAMES_RUN_ID value", async () => {
    process.env["HYPERFRAMES_RUN_ID"] = "run-123";
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBe("run-123");
  });

  it("truncates HYPERFRAMES_RUN_ID to exactly 128 characters", async () => {
    process.env["HYPERFRAMES_RUN_ID"] = "x".repeat(160);
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBe("x".repeat(128));
    expect(getRunId()).toHaveLength(128);
  });

  it("trims whitespace around a real HYPERFRAMES_RUN_ID value", async () => {
    process.env["HYPERFRAMES_RUN_ID"] = "  run-123 \n";
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBe("run-123");
  });

  it("memoizes the first environment read", async () => {
    process.env["HYPERFRAMES_RUN_ID"] = "first-run";
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBe("first-run");
    process.env["HYPERFRAMES_RUN_ID"] = "second-run";
    expect(getRunId()).toBe("first-run");
  });

  it("memoizes an initial undefined environment read", async () => {
    const getRunId = await loadGetRunId();

    expect(getRunId()).toBeUndefined();
    process.env["HYPERFRAMES_RUN_ID"] = "later-run";
    expect(getRunId()).toBeUndefined();
  });
});
