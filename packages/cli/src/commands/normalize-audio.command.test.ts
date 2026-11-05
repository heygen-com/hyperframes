import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("normalize-audio on a clip inside a mounted scene", () => {
  it("measures it and writes the gain into the scene file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-normalize-scene-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const root = `<div data-composition-id="main"><div data-composition-id="intro" data-composition-src="compositions/intro.html"></div></div>`;
      const scene = `<audio id="voice" src="voice.wav" data-volume="0" data-duration="2"></audio>`;
      mkdirSync(join(dir, "compositions"));
      writeFileSync(join(dir, "index.html"), root);
      writeFileSync(join(dir, "compositions", "intro.html"), scene);
      writeFileSync(join(dir, "voice.wav"), "audio bytes");
      measureAudio.mockResolvedValue({ integratedLufs: -16, truePeakDbfs: -12.3 });

      await runCommand(normalizeAudioCommand, {
        rawArgs: [dir, "--target", "voice", "--json", "--write"],
      });

      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        ok: true,
        targetId: "voice",
        wrote: true,
      });
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(root);
      expect(readFileSync(join(dir, "compositions", "intro.html"), "utf8")).toBe(
        scene.replace('data-volume="0"', 'data-volume="1"'),
      );
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the scene's audio source against the scene file, not the project root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-normalize-scene-src-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const root = `<div data-composition-id="main"><div data-composition-id="intro" data-composition-src="compositions/intro.html"></div></div>`;
      const scene = `<audio id="voice" src="../assets/voice.wav" data-volume="0" data-duration="2"></audio>`;
      mkdirSync(join(dir, "compositions"));
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "index.html"), root);
      writeFileSync(join(dir, "compositions", "intro.html"), scene);
      writeFileSync(join(dir, "assets", "voice.wav"), "audio bytes");
      measureAudio.mockClear();
      measureAudio.mockResolvedValue({ integratedLufs: -16, truePeakDbfs: -12.3 });

      await runCommand(normalizeAudioCommand, { rawArgs: [dir, "--target", "voice", "--json"] });

      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ ok: true });
      expect(measureAudio.mock.calls[0]?.[1]).toBe(join(dir, "assets", "voice.wav"));
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("absolute normalize-audio command held by a limit", () => {
  it("prints the level the clip plays at, its data-volume included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-normalize-absolute-held-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const path = join(dir, "index.html");
      const html = `<audio id="voice" src="voice.wav" data-volume="2" data-duration="2"></audio>`;
      writeFileSync(path, html);
      writeFileSync(join(dir, "voice.wav"), "audio bytes");
      measureAudio.mockResolvedValue({ integratedLufs: -20, truePeakDbfs: -7.8 });

      await runCommand(normalizeAudioCommand, {
        rawArgs: [dir, "--target", "voice", "--lufs", "-12", "--write"],
      });

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain(
        "-20.0 LUFS → -14.0 LUFS, target -12.0 (stopped short of -1.5 dBTP)",
      );
      expect(printed).toContain("Cannot get closer to the target; the gain is unchanged.");
      expect(readFileSync(path, "utf8")).toBe(html);
    } finally {
      log.mockRestore();
      measureAudio.mockReset();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reference normalize-audio command", () => {
  it("writes the most gain that stays under -1.5 dBTP and says how far under the reference that leaves it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-normalize-reference-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const path = join(dir, "index.html");
      const html =
        `<audio id="speaker-opening" src="open.wav" data-volume="1"></audio>` +
        `<audio id="speaker-closing" src="close.wav" data-volume="1"></audio>`;
      writeFileSync(path, html);
      writeFileSync(join(dir, "open.wav"), "audio bytes");
      writeFileSync(join(dir, "close.wav"), "audio bytes");
      measureAudio
        .mockResolvedValueOnce({ integratedLufs: -15, truePeakDbfs: -3 })
        .mockResolvedValueOnce({ integratedLufs: -18, truePeakDbfs: -3 });

      await runCommand(normalizeAudioCommand, {
        rawArgs: [dir, "--reference", "speaker-opening", "--target", "speaker-closing", "--write"],
      });

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain(
        "Reaches -16.5 LUFS, 1.5 dB under the reference (stopped short of -1.5 dBTP).",
      );
      expect(readFileSync(path, "utf8")).toContain(
        `<audio id="speaker-closing" src="close.wav" data-volume="1.188502"></audio>`,
      );
    } finally {
      log.mockRestore();
      measureAudio.mockReset();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says where the target stays when the ceiling leaves less gain than the tolerance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-normalize-reference-held-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const path = join(dir, "index.html");
      const html =
        `<audio id="speaker-opening" src="open.wav" data-volume="1"></audio>` +
        `<audio id="speaker-closing" src="close.wav" data-volume="1"></audio>`;
      writeFileSync(path, html);
      writeFileSync(join(dir, "open.wav"), "audio bytes");
      writeFileSync(join(dir, "close.wav"), "audio bytes");
      measureAudio
        .mockResolvedValueOnce({ integratedLufs: -15, truePeakDbfs: -3 })
        .mockResolvedValueOnce({ integratedLufs: -18, truePeakDbfs: -1.8 });

      await runCommand(normalizeAudioCommand, {
        rawArgs: [dir, "--reference", "speaker-opening", "--target", "speaker-closing", "--write"],
      });

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain(
        "Stays at -18.0 LUFS, 3.0 dB under the reference (stopped short of -1.5 dBTP).",
      );
      expect(printed).toContain("Cannot get closer to the target; the gain is unchanged.");
      expect(readFileSync(path, "utf8")).toBe(html);
    } finally {
      log.mockRestore();
      measureAudio.mockReset();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
