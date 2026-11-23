import { HYPERFRAMES_BROWSER_MARKER_ARG } from "@hyperframes/core/browser-marker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HYPERFRAMES_NO_ORPHAN_CLEANUP", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("skips process enumeration and termination when cleanup is disabled", () => {
    vi.stubEnv("HYPERFRAMES_NO_ORPHAN_CLEANUP", "1");

    expect(killOrphanedProcesses()).toBe(0);
    expect(child.execFileSync).not.toHaveBeenCalled();
    expect(tree.terminateProcessTree).not.toHaveBeenCalled();
  });

  it("kills only orphaned browsers HyperFrames marked, from one process-table read", () => {
    child.execFileSync.mockReturnValue(
      [
        `  101     1 /opt/chrome-headless-shell --headless ${HYPERFRAMES_BROWSER_MARKER_ARG}`,
        "  102   101 /opt/chrome-headless-shell --type=renderer",
        `  103     1 chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-x ${HYPERFRAMES_BROWSER_MARKER_ARG} about:blank`,
        `  104   900 chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-y ${HYPERFRAMES_BROWSER_MARKER_ARG}`,
        "  105     1 /usr/bin/node server.js",
        "  106     1 /opt/chrome-headless-shell --remote-debugging-port=0 about:blank",
        "  107     1 chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-z --headless",
        `  108     1 chrome ${HYPERFRAMES_BROWSER_MARKER_ARG}-lookalike`,
      ].join("\n"),
    );

    expect(killOrphanedProcesses()).toBe(2);
    expect(child.execFileSync).toHaveBeenCalledTimes(1);
    expect(child.execSync).not.toHaveBeenCalled();
    expect(tree.terminateProcessTree.mock.calls.map(([pid]) => pid)).toEqual([101, 103]);
  });

  it("leaves another tool's detached headless shell running", () => {
    child.execFileSync.mockReturnValue(
      "  201     1 /opt/chrome-headless-shell --remote-debugging-port=0 about:blank",
    );

    expect(killOrphanedProcesses()).toBe(0);
    expect(tree.terminateProcessTree).not.toHaveBeenCalled();
  });
});
