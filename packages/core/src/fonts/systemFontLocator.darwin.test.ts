import { describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn(() => ""));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  platform: () => "darwin",
}));

const { locateSystemFont, locateSystemFontVariants } = await import("./systemFontLocator");

describe("systemFontLocator on macOS", () => {
  // system_profiler SPFontsDataType takes about 10 s, so every lookup would block a compile for its timeout.
  it("finds fonts without spawning a process", () => {
    locateSystemFontVariants("Hf Darwin Probe");
    locateSystemFont("Hf Darwin Probe");
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
