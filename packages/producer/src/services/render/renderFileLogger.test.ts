import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRenderFileLogger } from "../renderOrchestrator.js";

describe("createRenderFileLogger", () => {
  it("keeps concurrent debug logs scoped without replacing global console methods", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-render-log-"));
    const firstPath = join(dir, "first.log");
    const secondPath = join(dir, "second.log");
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const base = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const first = createRenderFileLogger(firstPath, base);
    const second = createRenderFileLogger(secondPath, base);

    await Promise.all([
      Promise.resolve().then(() => first.info("first-only", { renderId: "a" })),
      Promise.resolve().then(() => second.warn("second-only", { renderId: "b" })),
    ]);

    expect(console.log).toBe(originalConsole.log);
    expect(console.warn).toBe(originalConsole.warn);
    expect(console.error).toBe(originalConsole.error);
    expect(readFileSync(firstPath, "utf8")).toContain("first-only");
    expect(readFileSync(firstPath, "utf8")).not.toContain("second-only");
    expect(readFileSync(secondPath, "utf8")).toContain("second-only");
    expect(readFileSync(secondPath, "utf8")).not.toContain("first-only");
  });
});
