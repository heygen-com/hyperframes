import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUALITY } from "../background-removal/pipeline.js";
import { consumeCommandResult } from "../utils/commandResult.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const fake = vi.hoisted(() => ({ lines: [] as string[], removeBackground: vi.fn() }));

vi.mock("../api/removeBackground.js", () => ({
  RemoveBackgroundError: class extends Error {},
  removeBackground: fake.removeBackground,
}));
vi.mock("../ui/prompts.js", () => {
  const say = (message: string) => void fake.lines.push(message);
  return { spinner: () => ({ start: say, stop: say, message: say }) };
});

const { default: removeBackgroundCommand } = await import("./remove-background.js");

const printed = (): string =>
  fake.lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

const run = (args: Record<string, unknown> = {}): Promise<unknown> =>
  Promise.resolve(
    removeBackgroundCommand.run?.({
      args: {
        input: "in.mp4",
        output: "out.webm",
        device: "cpu",
        quality: DEFAULT_QUALITY,
        ...args,
      },
      rawArgs: [],
      cmd: removeBackgroundCommand,
    } as never),
  );

beforeEach(() => {
  fake.lines.length = 0;
  fake.removeBackground.mockReset();
  for (const method of ["log", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      fake.lines.push(args.join(" "));
    });
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
});

describe("remove-background output for people", () => {
  // fails without the fix: the refused value is repeated as it was typed.
  it.each([
    [{ device: ODD }, `Invalid --device '${SHOWN}'.`],
    [{ quality: ODD }, `Invalid --quality '${SHOWN}'.`],
  ])("shows control characters in a refused %o as text", async (args, line) => {
    await expect(run(args)).rejects.toThrow();
    expect(printed()).toContain(line);
    expect(printed()).not.toContain(ESC);
  });

  // fails without the fix: the progress text and the saved paths are printed as they arrived.
  it("shows control characters in the lines of a finished run as text", async () => {
    fake.removeBackground.mockImplementation(
      async (opts: { onProgress: (event: { kind: "info"; message: string }) => void }) => {
        opts.onProgress({ kind: "info", message: `loading ${ODD}` });
        return {
          outputPath: `/out/${ODD}.webm`,
          backgroundOutputPath: `/out/bg-${ODD}.webm`,
          framesProcessed: 2,
          durationSeconds: 1,
          avgMsPerFrame: 5,
          provider: "CPU",
          format: "webm",
        };
      },
    );
    await run();
    expect(printed()).toContain(`loading ${SHOWN}`);
    expect(printed()).toContain(`→ /out/${SHOWN}.webm + /out/bg-${SHOWN}.webm`);
    expect(printed()).not.toContain(ESC);
    expect(printed()).not.toContain("\x07");
  });

  // fails without the fix: the failure reason is printed as it was thrown.
  it("shows control characters in a failure as text", async () => {
    fake.removeBackground.mockRejectedValue(new Error(`no frames ${ODD}\nsecond line`));
    await expect(run()).rejects.toThrow();
    expect(printed()).toContain(`Background removal failed: no frames ${SHOWN}\nsecond line`);
    expect(printed()).not.toContain(ESC);
  });
});
