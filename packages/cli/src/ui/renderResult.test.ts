import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferenceBackground } from "@hyperframes/producer";
import { renderMachineResult } from "./renderResult.js";

const originalIsTTY = process.stdout.isTTY;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
});

function capture(run: () => void, terminal = false): string {
  Object.defineProperty(process.stdout, "isTTY", { value: terminal, configurable: true });
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  run();
  return output;
}

function parse(line: string): unknown {
  return JSON.parse(line.slice("@hf-result ".length));
}

describe("renderMachineResult", () => {
  it.each<ReferenceBackground>([
    { kind: "solid", rgb: [12, 34, 56] },
    { kind: "none" },
    { kind: "unsupported_non_solid" },
    { kind: "unknown" },
  ])("writes one versioned line carrying reference background %j", (reference) => {
    const line = capture(() => renderMachineResult({ reference_background: reference }, false));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().split("\n")).toHaveLength(1);
    expect(line.startsWith("@hf-result ")).toBe(true);
    expect(parse(line)).toEqual({
      version: 1,
      operation: "render",
      reference_background: reference,
    });
  });

  it("re-projects a malformed value to unknown at the final writer", () => {
    const line = capture(() =>
      renderMachineResult(
        { reference_background: { kind: "solid", rgb: [999, 0, 0], path: "/private/x" } } as never,
        false,
      ),
    );
    expect(parse(line)).toEqual({
      version: 1,
      operation: "render",
      reference_background: { kind: "unknown" },
    });
    expect(line).not.toContain("/private/x");
  });

  it("stays silent when the render measured nothing", () => {
    expect(capture(() => renderMachineResult({}, false))).toBe("");
  });

  it("stays silent for quiet mode, a terminal, or a container attached to a terminal", () => {
    const result = { reference_background: { kind: "none" } } as const;
    expect(capture(() => renderMachineResult(result, true))).toBe("");
    expect(capture(() => renderMachineResult(result, false), true)).toBe("");
    vi.stubEnv("HYPERFRAMES_STDOUT_IS_TTY", "1");
    expect(capture(() => renderMachineResult(result, false))).toBe("");
  });
});
