import { runCommand } from "citty";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readAudio } = vi.hoisted(() => ({ readAudio: vi.fn() }));

vi.mock("../audio/read/read.js", () => ({ readAudio }));

import audioCommand from "./audio.js";

describe("audio --read --layer", () => {
  beforeEach(() => {
    readAudio.mockReset();
    readAudio.mockResolvedValue({ analysis: {}, textPath: "x.txt", jsonPath: "x.json" });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it.each(["music", "sfx", "voice"])("passes --layer %s to the read", async (layer) => {
    await runCommand(audioCommand, { rawArgs: ["a.wav", "--read", "--layer", layer, "--json"] });
    expect(readAudio.mock.calls[0]![2]).toMatchObject({ layer });
  });

  it("passes no layer when the flag is absent", async () => {
    await runCommand(audioCommand, { rawArgs: ["a.wav", "--read", "--json"] });
    expect(readAudio.mock.calls[0]![2].layer).toBeUndefined();
  });

  it("rejects an unknown layer and names the valid ones", async () => {
    await expect(
      runCommand(audioCommand, { rawArgs: ["a.wav", "--read", "--layer", "drums"] }),
    ).rejects.toThrow("--layer is music, sfx, voice; got drums");
    expect(readAudio).not.toHaveBeenCalled();
  });

  it("rejects --layer without --read", async () => {
    await expect(
      runCommand(audioCommand, { rawArgs: ["a.wav", "--layer", "music"] }),
    ).rejects.toThrow("--layer only works with --read");
  });
});

describe("audio --read on a terminal", () => {
  it("shows control characters in the read as visible escapes", async () => {
    readAudio.mockReset();
    readAudio.mockResolvedValue({
      analysis: {
        version: 1,
        file: "take\x1b[2J.wav",
        sha256: "test",
        duration: 3,
        separation: "none",
        stems: [],
        stemsDir: null,
        voiceFreeMix: null,
        bpm: null,
        description: null,
        transcript: null,
        voice: null,
        effects: null,
        music: null,
        ambience: null,
        warnings: ["clipped\x1b]52;c;cHduZWQ=\x07"],
      },
      textPath: "read\x1b[1A.txt",
      jsonPath: "x.json",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(audioCommand, { rawArgs: ["a.wav", "--read"] });

    const shown = log.mock.calls.map((call) => String(call[0])).join("\n");
    const controls = [...shown].filter((ch) => {
      const code = ch.charCodeAt(0);
      return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    });
    expect(controls).toEqual([]);
    expect(shown).toContain("take\\x1b[2J.wav");
    expect(shown).toContain("clipped\\x1b]52;c;cHduZWQ=\\x07");
    expect(shown).toContain("read\\x1b[1A.txt");
  });
});
