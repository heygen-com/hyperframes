import { describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

import { chromeDescendants, reapChromeTree } from "./chromeTree.js";

const psFails = (error: Error & { killed?: boolean }) =>
  execFile.mockImplementation((...args: unknown[]) => {
    (args.at(-1) as (e: Error) => void)(error);
  });

describe("chromeTree ps call", () => {
  it("is bounded, and a ps killed at the timeout records no descendants", async () => {
    psFails(Object.assign(new Error("ps timed out"), { killed: true }));
    await expect(chromeDescendants(1)).resolves.toEqual([]);
    expect(execFile.mock.calls[0]?.[2]).toMatchObject({ timeout: expect.any(Number) });
  });

  it("does not hide other ps failures", async () => {
    psFails(new Error("spawn ps ENOENT"));
    await expect(chromeDescendants(1)).rejects.toThrow("ENOENT");
  });

  it("reaps nothing without running ps when no member was recorded", async () => {
    execFile.mockClear();
    await reapChromeTree([]);
    expect(execFile).not.toHaveBeenCalled();
  });
});
