import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const fake = vi.hoisted(() => ({ lines: [] as string[], synthesize: vi.fn() }));

vi.mock("../tts/synthesize.js", () => ({ synthesize: fake.synthesize }));
vi.mock("../ui/prompts.js", () => {
  const say = (message: string) => void fake.lines.push(message);
  return { spinner: () => ({ start: say, stop: say, message: say }) };
});

const { default: ttsCommand } = await import("./tts.js");

const printed = (): string =>
  fake.lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

const run = (): Promise<unknown> =>
  Promise.resolve(
    ttsCommand.run?.({
      args: { input: "Hello", voice: `af_${ODD}`, lang: "es" },
      rawArgs: [],
      cmd: ttsCommand,
    } as never),
  );

beforeEach(() => {
  fake.lines.length = 0;
  fake.synthesize.mockReset();
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    fake.lines.push(args.join(" "));
  });
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
});

describe("tts output for people", () => {
  // fails without the fix: the voice, the progress text and the saved path are printed as they arrived.
  it("shows control characters in the lines of a finished run as text", async () => {
    fake.synthesize.mockImplementation(
      async (_text: string, _out: string, opts: { onProgress?: (msg: string) => void }) => {
        opts.onProgress?.(`loading ${ODD}`);
        return { durationSeconds: 1, langApplied: true, outputPath: `/out/${ODD}.wav` };
      },
    );
    await run();
    expect(printed()).toContain(`Note: voice "af_${SHOWN}" is`);
    expect(printed()).toContain(`Generating speech with af_${SHOWN} (es)...`);
    expect(printed()).toContain(`loading ${SHOWN}`);
    expect(printed()).toContain(`of speech → /out/${SHOWN}.wav`);
    expect(printed()).not.toContain(ESC);
    expect(printed()).not.toContain("\x07");
  });

  // fails without the fix: the failure reason is printed as it was thrown.
  it("shows control characters in a failure as text", async () => {
    fake.synthesize.mockRejectedValue(new Error(`no model ${ODD}\nsecond line`));
    await expect(run()).rejects.toThrow();
    expect(printed()).toContain(`Speech synthesis failed: no model ${SHOWN}\nsecond line`);
    expect(printed()).not.toContain(ESC);
  });
});
