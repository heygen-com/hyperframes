import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliRuntimeError } from "../utils/commandResult.js";

vi.mock("../measure/diff.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../measure/diff.js")>()),
  diffVideos: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diff command terminal output", () => {
  it("prints a page error with control characters as visible escapes", async () => {
    const { diffVideos } = await import("../measure/diff.js");
    vi.mocked(diffVideos).mockRejectedValueOnce(
      new Error("page threw \u001b[2J\u009b\nsecond line \u001b]0;t\u0007"),
    );
    const printed: string[] = [];
    const keep = (...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { default: diff } = await import("./diff.js");

    await runCommand(diff, { rawArgs: ["original.mp4", "yours.mp4"] }).catch((error: unknown) => {
      if (!(error instanceof CliRuntimeError)) throw error;
    });

    const text = printed.join("\n");
    expect(text).toContain("page threw \\x1b[2J\\x9b\nsecond line \\x1b]0;t\\x07");
    for (const control of ["\u001b[2J", "\u009b", "\u001b]", "\u0007"]) {
      expect(text).not.toContain(control);
    }
  });
});
