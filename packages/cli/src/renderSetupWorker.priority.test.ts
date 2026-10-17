import { constants } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ setPriority: vi.fn() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  setPriority: os.setPriority,
}));
vi.mock("./utils/lintProject.js", () => ({ lintProject: vi.fn(async () => ({ ok: true })) }));

beforeEach(() => {
  vi.resetModules();
  os.setPriority.mockReset();
  process.argv[2] = "lint";
  process.env.HYPERFRAMES_RENDER_SETUP_INPUT = JSON.stringify({ projectDir: "/project" });
});
afterEach(() => vi.restoreAllMocks());

it("lints at the lowest CPU priority so it never competes with a Studio boot", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(os.setPriority).toHaveBeenCalledWith(constants.priority.PRIORITY_LOW);
  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
});

it("still lints when a sandbox forbids lowering the priority", async () => {
  os.setPriority.mockImplementation(() => {
    throw new Error("uv_os_setpriority returned EPERM (operation not permitted)");
  });
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("EPERM"));
});
