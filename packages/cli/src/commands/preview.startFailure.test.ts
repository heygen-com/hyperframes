import { describe, expect, it, vi } from "vitest";
import { runEmbeddedMode } from "./preview.js";

const ui = vi.hoisted(() => ({
  spinner: { start: vi.fn(), stop: vi.fn(), message: vi.fn() },
  error: vi.fn(),
}));
vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...actual,
    spinner: () => ui.spinner,
    intro: () => {},
    log: { ...actual.log, error: ui.error },
  };
});
vi.mock("../server/studioServer.js", () => ({
  resolveStudioBundle: () => ({ available: true, checkedPaths: [] }),
  loadPreviewServerBuildSignature: async () => "test",
  createStudioServer: () => ({
    app: { fetch: () => new Response() },
    watcher: { close: vi.fn() },
    shutdown: vi.fn(),
  }),
}));
vi.mock("../server/portUtils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/portUtils.js")>()),
  findPortAndServe: async () => {
    throw new Error("listen EPERM: operation not permitted 127.0.0.1:3056");
  },
}));

describe("preview start failure", () => {
  it("stops the startup spinner so a server that cannot listen lets the process exit", async () => {
    await runEmbeddedMode("start-failure-project", 3056, { noOpen: true });

    expect(ui.spinner.start).toHaveBeenCalledOnce();
    expect(ui.spinner.stop).toHaveBeenCalledOnce();
    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("listen EPERM"));
  });
});
