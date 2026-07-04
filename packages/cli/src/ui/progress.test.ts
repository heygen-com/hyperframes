import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderProgress, resetProgressThrottleForTests } from "./progress.js";

// Regression: a piped/redirected stdout has no cursor and Node full-buffers
// non-TTY streams by default, so the old carriage-return progress bar
// (relying on \r + ANSI cursor codes, with no throttling) never became
// visible when render output was piped or logged — two independent reports
// named this ("progress output invisible when stdout piped", "doctor
// printed no output in non-TTY").
describe("renderProgress", () => {
  const originalIsTTY = process.stdout.isTTY;
  const spyOnStdoutWrite = () => vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  let writeSpy: ReturnType<typeof spyOnStdoutWrite>;

  beforeEach(() => {
    resetProgressThrottleForTests();
    writeSpy = spyOnStdoutWrite();
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.stdout.isTTY = originalIsTTY;
  });

  it("writes a carriage-return, cursor-based line on a TTY", () => {
    process.stdout.isTTY = true;
    renderProgress(50, "encoding");
    const written = writeSpy.mock.calls[0]?.[0] as string;
    expect(written.startsWith("\r")).toBe(true);
    expect(written).not.toMatch(/\n$/);
  });

  it("writes a plain newline-terminated line on non-TTY stdout", () => {
    process.stdout.isTTY = false;
    renderProgress(50, "encoding");
    const written = writeSpy.mock.calls[0]?.[0] as string;
    expect(written).toBe("50% encoding\n");
  });

  it("throttles non-TTY output to one line per integer percent", () => {
    process.stdout.isTTY = false;
    renderProgress(50.1, "encoding");
    renderProgress(50.2, "encoding");
    renderProgress(50.4, "encoding"); // Math.round(50.4) === 50, same bucket
    expect(writeSpy).toHaveBeenCalledTimes(1);

    renderProgress(51.0, "encoding");
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy.mock.calls[1]?.[0]).toBe("51% encoding\n");
  });

  it("does not throttle across resets (each render invocation starts fresh)", () => {
    process.stdout.isTTY = false;
    renderProgress(100, "done");
    expect(writeSpy).toHaveBeenCalledTimes(1);
    resetProgressThrottleForTests();
    renderProgress(100, "done again");
    expect(writeSpy).toHaveBeenCalledTimes(2);
  });
});
