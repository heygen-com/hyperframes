import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import { runEmbeddedMode } from "./preview.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;

vi.mock("../utils/attendedTerminal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/attendedTerminal.js")>()),
  isUnattended: () => false,
}));
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  intro: () => {},
}));
vi.mock("../server/studioServer.js", () => ({
  resolveStudioBundle: () => ({ available: false, checkedPaths: [`/opt/${ODD}/studio`] }),
  loadPreviewServerBuildSignature: async () => "test",
  originForListeningAddress: () => undefined,
  createStudioServer: () => {
    throw new Error("the server is not started without a studio build");
  },
}));

describe("preview with no studio build", () => {
  afterEach(() => {
    consumeCommandResult();
    vi.restoreAllMocks();
  });

  // fails without the fix: the folder name is printed as it is on disk.
  it("shows control characters in the folders it looked in as text", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });

    await runEmbeddedMode("missing-build-project", 3057, { noOpen: true });

    const text = lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
    expect(text).toContain("/opt/od\\x1b[2Jd\\x07/studio");
    expect(text).not.toContain(ESC);
    expect(text).not.toContain("\x07");
    expect(consumeCommandResult().exitCode).toBe(1);
  });
});
