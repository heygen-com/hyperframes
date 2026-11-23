import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
const findTrustedExecutable = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("@hyperframes/parsers/ff-binaries", () => ({ findTrustedExecutable }));
vi.mock("node:os", async (orig) => ({
  ...(await orig<typeof import("node:os")>()),
  platform: () => "darwin",
}));

describe("copyToClipboard", () => {
  beforeEach(() => {
    spawnSync.mockReset();
    findTrustedExecutable.mockReset();
    findTrustedExecutable.mockImplementation((name: string) => `/usr/bin/${name}`);
    vi.resetModules();
  });

  it("does not let the tool's background owner hold our output pipes or block forever", async () => {
    spawnSync.mockReturnValue({ status: 0 });
    const { copyToClipboard } = await import("./clipboard.js");
    expect(copyToClipboard("snippet")).toBe(true);
    const opts = spawnSync.mock.calls[0]![2];
    expect(opts.input).toBe("snippet");
    expect(opts.stdio).toEqual(["pipe", "ignore", "ignore"]);
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it("reports not copied when the tool times out", async () => {
    spawnSync.mockReturnValue({ status: null, error: new Error("ETIMEDOUT") });
    const { copyToClipboard } = await import("./clipboard.js");
    expect(copyToClipboard("snippet")).toBe(false);
  });

  it("runs the tool by the path the trusted lookup approved, never by name", async () => {
    spawnSync.mockReturnValue({ status: 0 });
    const { copyToClipboard } = await import("./clipboard.js");

    expect(copyToClipboard("snippet")).toBe(true);
    expect(findTrustedExecutable).toHaveBeenCalledWith("pbcopy");
    expect(spawnSync.mock.calls.map(([command]) => command)).toEqual(["/usr/bin/pbcopy"]);
  });

  it("copies nothing when no trusted tool is installed", async () => {
    findTrustedExecutable.mockReturnValue(undefined);
    const { copyToClipboard } = await import("./clipboard.js");

    expect(copyToClipboard("snippet")).toBe(false);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
