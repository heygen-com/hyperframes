// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

import * as fs from "node:fs";
import { collectScratchLeftovers, removeScratch } from "./removeScratch.js";
import { renameWithRetry } from "./renameWithRetry.js";

describe("removeScratch", () => {
  it("removes a folder and what is in it", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-scratch-"));
    writeFileSync(join(dir, "a.wav"), "x");
    removeScratch(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("does not fail when the system refuses the removal", () => {
    vi.mocked(fs.rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("EPERM: operation not permitted, unlink"), { code: "EPERM" });
    });
    expect(() => removeScratch(join(tmpdir(), "hf-scratch-missing"))).not.toThrow();
  });

  it("hands one run's leftovers to that run only, and a copy that cannot clear its source leaves it", async () => {
    const refuse = () => {
      throw Object.assign(new Error("EPERM: operation not permitted, unlink"), { code: "EPERM" });
    };
    const dir = mkdtempSync(join(tmpdir(), "hf-scratch-"));
    const from = join(dir, "from.wav");
    const to = join(dir, "to.wav");
    writeFileSync(from, "audio");
    const reports: string[][] = [];
    await Promise.all([
      collectScratchLeftovers(
        async () => {
          vi.mocked(fs.rmSync).mockImplementationOnce(refuse);
          renameWithRetry(from, to, { platform: "win32", copyFallback: true, rename: refuse });
        },
        (left) => reports.push(left),
      ),
      collectScratchLeftovers(
        async () => {},
        (left) => reports.push(left),
      ),
    ]);
    removeScratch(join(dir, "outside-a-run"));
    expect(readFileSync(to, "utf-8")).toBe("audio");
    expect(existsSync(from)).toBe(true);
    expect(reports.sort()).toEqual([[], [from]]);
  });
});
