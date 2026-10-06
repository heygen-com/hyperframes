import { afterEach, describe, expect, it } from "vitest";

import { renderMachineProgress, renderProgress } from "./progress.js";

const originalWrite = process.stdout.write.bind(process.stdout);
const originalIsTTY = process.stdout.isTTY;

afterEach(() => {
  process.stdout.write = originalWrite;
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  });
});

describe("renderProgress", () => {
  it("emits line-delimited updates when stdout is not a TTY", () => {
    let output = "";
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    renderProgress(42, "Capturing frames");

    expect(output).toMatch(/Capturing frames\n$/);
    expect(output).not.toContain("\r");
  });
});

describe("renderMachineProgress", () => {
  const capture = (isTTY: boolean) => {
    let output = "";
    Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    renderMachineProgress(83.4, { code: "encode", done: 812, total: 1800 });
    return output;
  };

  it("writes one @hf-progress line for a parent reading piped stdout", () => {
    expect(capture(false)).toBe(
      '@hf-progress {"code":"encode","done":812,"total":1800,"pct":83}\n',
    );
  });

  it("stays silent in a terminal", () => {
    expect(capture(true)).toBe("");
  });
});
