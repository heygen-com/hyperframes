import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for auth login's silent heygen-CLI discoverability gap:
// media-use's free resolution path shells out to a separate `heygen` binary
// with no bundling/fallback, and hyperframes auth login's success output
// previously never mentioned it — a user with no heygen CLI installed had no
// signal from a successful sign-in that a second tool was required.

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: execFileSyncMock };
});

const { hasHeygenCli, printHeygenCliNoteIfMissing, HEYGEN_CLI_DOCS_URL } =
  await import("./heygenCli.js");

describe("hasHeygenCli / printHeygenCliNoteIfMissing", () => {
  let platformDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
  });

  function setPlatform(value: string): void {
    Object.defineProperty(process, "platform", { configurable: true, value });
  }

  it("hasHeygenCli returns true when which/where finds the binary", () => {
    execFileSyncMock.mockReturnValue("/usr/local/bin/heygen\n");
    expect(hasHeygenCli()).toBe(true);
  });

  it("hasHeygenCli returns false when which/where throws (not found)", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("command failed");
    });
    expect(hasHeygenCli()).toBe(false);
  });

  it("hasHeygenCli returns false on blank output", () => {
    execFileSyncMock.mockReturnValue("\n");
    expect(hasHeygenCli()).toBe(false);
  });

  it("uses where on win32 and which elsewhere", () => {
    setPlatform("win32");
    execFileSyncMock.mockReturnValue("C:\\heygen\\heygen.exe\n");
    hasHeygenCli();
    expect(execFileSyncMock).toHaveBeenCalledWith("where", ["heygen"], expect.anything());

    setPlatform("darwin");
    execFileSyncMock.mockReturnValue("/usr/local/bin/heygen\n");
    hasHeygenCli();
    expect(execFileSyncMock).toHaveBeenCalledWith("which", ["heygen"], expect.anything());
  });

  it("printHeygenCliNoteIfMissing logs nothing when heygen is present", () => {
    execFileSyncMock.mockReturnValue("/usr/local/bin/heygen\n");
    printHeygenCliNoteIfMissing();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("printHeygenCliNoteIfMissing logs a note naming the docs URL when heygen is missing", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    printHeygenCliNoteIfMissing();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(HEYGEN_CLI_DOCS_URL));
  });

  it("mentions WSL specifically on win32 when heygen is missing", () => {
    setPlatform("win32");
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    printHeygenCliNoteIfMissing();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("WSL"));
  });

  it("does not mention WSL on non-Windows platforms", () => {
    setPlatform("darwin");
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    printHeygenCliNoteIfMissing();
    expect(console.log).toHaveBeenCalledWith(expect.not.stringContaining("WSL"));
  });
});
