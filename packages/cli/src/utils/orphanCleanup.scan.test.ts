import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({ execFileSync: vi.fn(), execSync: vi.fn() }));
const tree = vi.hoisted(() => ({ terminateProcessTree: vi.fn(async (_pid: number) => undefined) }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  ...child,
}));
vi.mock("./processTree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./processTree.js")>()),
  terminateProcessTree: tree.terminateProcessTree,
}));

const { killOrphanedProcesses } = await import("./orphanCleanup.js");

describe.skipIf(process.platform === "win32")("killOrphanedProcesses scan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds orphaned browsers from one process-table read", () => {
    child.execFileSync.mockReturnValue(
      [
        "  101     1 /opt/chrome-headless-shell --headless",
        "  102   101 /opt/chrome-headless-shell --type=renderer",
        "  103     1 chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-x",
        "  104   900 chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-y",
        "  105     1 /usr/bin/node server.js",
      ].join("\n"),
    );

    expect(killOrphanedProcesses()).toBe(2);
    expect(child.execFileSync).toHaveBeenCalledTimes(1);
    expect(child.execSync).not.toHaveBeenCalled();
    expect(tree.terminateProcessTree.mock.calls.map(([pid]) => pid)).toEqual([101, 103]);
  });
});
