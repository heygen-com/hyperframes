import { constants } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ setPriority: vi.fn() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  setPriority: os.setPriority,
}));
vi.mock("./utils/lintProject.js", () => ({ lintProject: vi.fn(async () => ({ ok: true })) }));
vi.mock("./browser/installRun.js", () => ({
  runBrowserInstall: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  vi.resetModules();
  os.setPriority.mockReset();
  process.argv[2] = "lint";
  process.env.HYPERFRAMES_RENDER_SETUP_INPUT = JSON.stringify({
    projectDir: "/project",
    background: true,
  });
});
afterEach(() => vi.restoreAllMocks());

it("a background lint runs at the lowest CPU priority so it never competes with a Studio boot", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(os.setPriority).toHaveBeenCalledWith(constants.priority.PRIORITY_LOW);
  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
});

// fails without the fix: a render waits on its lint, and at idle priority a busy Windows PC starved it for minutes.
it("a render's lint keeps normal priority", async () => {
  process.env.HYPERFRAMES_RENDER_SETUP_INPUT = JSON.stringify({ projectDir: "/project" });
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(os.setPriority).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
});

// fails without the fix: at normal priority, each write of the download queues behind a busy PC's work.
it("the Chrome install runs one step above normal priority", async () => {
  process.argv[2] = "browser-install";
  process.env.HYPERFRAMES_RENDER_SETUP_INPUT = "{}";
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(os.setPriority).toHaveBeenCalledWith(constants.priority.PRIORITY_ABOVE_NORMAL);
  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
});

it("the Chrome install still runs when the system refuses the higher priority", async () => {
  process.argv[2] = "browser-install";
  process.env.HYPERFRAMES_RENDER_SETUP_INPUT = "{}";
  os.setPriority.mockImplementation(() => {
    throw nodeSystemErrorWithOsCodeInInfo("EACCES");
  });
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
  expect(warn).not.toHaveBeenCalled();
});

const nodeSystemErrorWithOsCodeInInfo = (code: string) =>
  Object.assign(new Error(`A system error occurred: uv_os_setpriority returned ${code}`), {
    code: "ERR_SYSTEM_ERROR",
    info: { code, syscall: "uv_os_setpriority" },
  });

it.each(["EPERM", "EACCES"])(
  "still lints, saying nothing, when a sandbox refuses lowering the priority (%s)",
  async (code) => {
    os.setPriority.mockImplementation(() => {
      throw nodeSystemErrorWithOsCodeInInfo(code);
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await import("./renderSetupWorker.js");

    expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
    expect(warn).not.toHaveBeenCalled();
  },
);

it("still names any other priority failure, and lints", async () => {
  os.setPriority.mockImplementation(() => {
    throw nodeSystemErrorWithOsCodeInInfo("ESRCH");
  });
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  await import("./renderSetupWorker.js");

  expect(write).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'));
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("ESRCH"));
});
