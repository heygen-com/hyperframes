import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { watchForHang, writeReportFile } from "./hangReport.js";

const dir = join(tmpdir(), "hf-hang");
const output = () => ({ write: vi.fn((..._args: unknown[]) => true) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchForHang", () => {
  it("writes one report after 60 s with no output", () => {
    const writeReport = vi.fn();
    watchForHang([output()], { HYPERFRAMES_HANG_REPORT: dir }, writeReport);
    vi.advanceTimersByTime(59_000);
    expect(writeReport).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300_000);
    expect(writeReport).toHaveBeenCalledOnce();
    expect(writeReport).toHaveBeenCalledWith(join(dir, `hang-${process.pid}.json`));
  });

  it("counts every write as activity and still passes it through", () => {
    const writeReport = vi.fn();
    const out = output();
    const original = out.write;
    watchForHang([out], { HYPERFRAMES_HANG_REPORT: dir }, writeReport);
    vi.advanceTimersByTime(50_000);
    out.write("progress" as never);
    expect(original).toHaveBeenCalledWith("progress");
    vi.advanceTimersByTime(50_000);
    expect(writeReport).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(writeReport).toHaveBeenCalledOnce();
  });

  it("does nothing unless the variable names an absolute directory", () => {
    const writeReport = vi.fn();
    watchForHang([output()], {}, writeReport);
    watchForHang([output()], { HYPERFRAMES_HANG_REPORT: "relative" }, writeReport);
    vi.advanceTimersByTime(300_000);
    expect(writeReport).not.toHaveBeenCalled();
  });
});

describe("once", () => {
  it("writes a single report even when output resumes and goes quiet again", () => {
    const writeReport = vi.fn();
    const out = output();
    watchForHang([out], { HYPERFRAMES_HANG_REPORT: dir }, writeReport);
    vi.advanceTimersByTime(61_000);
    out.write("later" as never);
    vi.advanceTimersByTime(300_000);
    expect(writeReport).toHaveBeenCalledOnce();
  });
});

describe("writeReportFile", () => {
  it("writes nothing where the report cannot leave out environment values", () => {
    const getReport = vi.fn(() => ({ environmentVariables: { SECRET: "x" } }));
    expect(writeReportFile(join(dir, "never.json"), { getReport })).toBe(false);
    expect(getReport).not.toHaveBeenCalled();
  });

  it("leaves the environment out where it can", () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-report-"));
    try {
      const report = {
        excludeEnv: false,
        getReport: () => ({ header: {}, excluded: report.excludeEnv }),
      };
      expect(writeReportFile(join(folder, "r.json"), report)).toBe(true);
      expect(JSON.parse(readFileSync(join(folder, "r.json"), "utf8"))).toMatchObject({
        excluded: true,
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
