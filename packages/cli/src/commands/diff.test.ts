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

  // fails without the fix: ids, notes, warnings and paths in the result are printed as they arrived.
  it("prints a result with control characters as visible escapes", async () => {
    const odd = "od\u001b[2Jd\u0007";
    const shown = "od\\x1b[2Jd\\x07";
    const { diffVideos } = await import("../measure/diff.js");
    vi.mocked(diffVideos).mockResolvedValueOnce({
      pass: true,
      ssim: { mean: 1, p05: 1, cell_p05: 1, frames: 2 },
      window: [0, 1],
      missing_content: { pass: true, share: 0, spans: [], texture: { share: 0, spans: [] } },
      worst: [],
      duration: { reference: 1, yours: 1, pass: null, note: `note ${odd}` },
      frames: `frames ${odd}`,
      segments: [{ id: `seg ${odd}`, pass: null, window: [0, 1], pixels: "kept", note: odd }],
      drawn: [{ id: `box ${odd}`, pass: null, box: [0, 0, 1, 1], window: [0, 1] }],
      layer: { selector: `#layer-${odd}`, benefit_median: 1, frames: [] },
      warnings: [`careful ${odd}\nsecond line`],
      sheet: `/out/${odd}/sheet.png`,
      sbs: `/out/${odd}/sbs.mp4`,
    } as never);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { default: diff } = await import("./diff.js");

    await runCommand(diff, { rawArgs: ["original.mp4", "yours.mp4"] });

    const text = printed.join("\n");
    for (const line of [
      `(note ${shown})`,
      `every frame: frames ${shown}`,
      `seg ${shown} 0–1 s kept: ${shown}`,
      `box ${shown} 0,0,1,1`,
      `layer #layer-${shown}:`,
      `careful ${shown}\nsecond line`,
      `sheet /out/${shown}/sheet.png`,
      `side by side /out/${shown}/sbs.mp4`,
    ]) {
      expect(text).toContain(line);
    }
    expect(text).not.toContain("\u001b[2J");
    expect(text).not.toContain("\u0007");
  });
});
