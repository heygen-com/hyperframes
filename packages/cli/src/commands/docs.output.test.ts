import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import docsCommand from "./docs.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
});

describe("docs output for people", () => {
  // fails without the fix: the topic is repeated as it was typed.
  it("shows control characters in an unknown topic as text", async () => {
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      said.push(args.join(" "));
    });
    await expect(
      Promise.resolve(
        docsCommand.run?.({ args: { topic: ODD }, rawArgs: [], cmd: docsCommand } as never),
      ),
    ).rejects.toThrow();
    expect(said.join("\n")).toContain(`Unknown topic: ${SHOWN}`);
    expect(said.join("\n")).not.toContain("\x07");
  });
});
