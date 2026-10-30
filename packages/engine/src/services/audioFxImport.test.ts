import { describe, expect, it, vi } from "vitest";

const execSync = vi.hoisted(() => vi.fn(() => ""));
vi.mock("child_process", async (importActual) => ({
  ...(await importActual<typeof import("child_process")>()),
  execSync,
}));

describe("importing the engine", () => {
  it("runs no subprocess", async () => {
    await import("./audioFxRender.js");
    await import("../index.js");
    expect(execSync).not.toHaveBeenCalled();
  }, 60_000);
});
