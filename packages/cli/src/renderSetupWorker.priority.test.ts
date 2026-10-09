import { constants } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ setPriority: vi.fn() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  setPriority: os.setPriority,
}));
vi.mock("./utils/lintProject.js", () => ({ lintProject: vi.fn(async () => ({ ok: true })) }));

afterEach(() => vi.restoreAllMocks());

it("lints at the lowest CPU priority so it never competes with a Studio boot", async () => {
  process.argv[2] = "lint";
  process.env.HYPERFRAMES_RENDER_SETUP_INPUT = JSON.stringify({ projectDir: "/project" });
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(os.setPriority).toHaveBeenCalledWith(constants.priority.PRIORITY_LOW);
  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
});
