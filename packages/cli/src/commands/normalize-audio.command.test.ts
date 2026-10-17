import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { describe, expect, it, vi } from "vitest";

const { measureAudio } = vi.hoisted(() => ({ measureAudio: vi.fn() }));

vi.mock("@hyperframes/studio-server/loudness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/studio-server/loudness")>()),
  measureAudio,
  requiredFfmpeg: () => "ffmpeg",
}));

import normalizeAudioCommand from "./normalize-audio.js";

describe("absolute normalize-audio command", () => {
  it.each([
    { volume: 0, integratedLufs: -16, write: true, wrote: true, withinTolerance: false },
    { volume: 0, integratedLufs: -15.8, write: true, wrote: true, withinTolerance: false },
    { volume: 0, integratedLufs: -16, write: false, wrote: false, withinTolerance: false },
    { volume: 1, integratedLufs: -16, write: true, wrote: false, withinTolerance: true },
    { volume: 2, integratedLufs: -16, write: true, wrote: true, withinTolerance: false },
  ])("normalizes $volume gain at $integratedLufs LUFS with write=$write", async (test) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-normalize-command-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const path = join(dir, "index.html");
      const html = `<audio id="voice" src="voice.wav" data-volume="${test.volume}" data-duration="2"></audio>`;
      writeFileSync(path, html);
      writeFileSync(join(dir, "voice.wav"), "audio bytes");
      measureAudio.mockResolvedValue({
        integratedLufs: test.integratedLufs,
        truePeakDbfs: -12.3,
      });
      const args = [dir, "--target", "voice", "--json"];
      if (test.write) args.push("--write");

      await runCommand(normalizeAudioCommand, { rawArgs: args });

      const result = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(result).toMatchObject({
        ok: true,
        targetId: "voice",
        previousVolume: test.volume,
        wrote: test.wrote,
        withinTolerance: test.withinTolerance,
      });
      const expectedGain = Number((10 ** ((-16 - test.integratedLufs) / 20)).toFixed(6));
      const expectedHtml = test.wrote
        ? html.replace(`data-volume="${test.volume}"`, `data-volume="${expectedGain}"`)
        : html;
      expect(readFileSync(path, "utf8")).toBe(expectedHtml);
      expect(readFileSync(join(dir, "voice.wav"), "utf8")).toBe("audio bytes");

      if (test.wrote) {
        await runCommand(normalizeAudioCommand, { rawArgs: args });
        expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
          ok: true,
          wrote: false,
          withinTolerance: true,
        });
        expect(readFileSync(path, "utf8")).toBe(expectedHtml);
      }
    } finally {
      log.mockRestore();
      measureAudio.mockReset();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
