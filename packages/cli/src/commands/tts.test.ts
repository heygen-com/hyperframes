import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertKnownFlags } from "../utils/reject-unknown-flags.js";

const synthesizeMock = vi.fn().mockResolvedValue({
  durationSeconds: 1,
  langApplied: true,
  outputPath: "/tmp/speech.wav",
});
vi.mock("../tts/synthesize.js", () => ({ synthesize: synthesizeMock }));

import ttsCommand from "./tts.js";

describe("tts command", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-tts-command-test-"));
    synthesizeMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("accepts --text-file as a compatibility alias for file input", async () => {
    const input = join(dir, "script.txt");
    writeFileSync(input, "Legacy file input\n");

    expect(() =>
      assertKnownFlags(ttsCommand as never, ["--text-file", input, "--json"]),
    ).not.toThrow();
    await ttsCommand.run!({ args: { "text-file": input, json: true } } as never);

    expect(synthesizeMock).toHaveBeenCalledWith(
      "Legacy file input",
      expect.stringMatching(/speech\.wav$/),
      expect.objectContaining({ lang: "en-us" }),
    );
  });
});
