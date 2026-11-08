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
