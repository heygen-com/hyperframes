import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

vi.mock("../browser/preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/preflight.js")>()),
  runEnvironmentChecks: async () => ({
    outcomes: [
      {
        name: `Tool ${ODD}`,
        ok: false,
        level: "error",
        detail: `not found at ${ODD}\nsecond line`,
        hint: `install ${ODD}`,
      },
    ],
  }),
}));

const { default: doctorCommand } = await import("./doctor.js");

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
});

describe("doctor output", () => {
  // fails without the fix: a check's name, detail and hint are printed as the check returned them.
  it("shows control characters in a check row as text", async () => {
    const said: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      said.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await Promise.resolve(
      doctorCommand.run?.({ args: { json: false }, rawArgs: [], cmd: doctorCommand } as never),
    ).catch(() => undefined);
    const text = said.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
    expect(text).toContain(`Tool ${SHOWN}`);
    expect(text).toContain(`not found at ${SHOWN}\nsecond line`);
    expect(text).toContain(`install ${SHOWN}`);
    expect(text).not.toContain(ESC);
    expect(text).not.toContain("\x07");
  });
});
