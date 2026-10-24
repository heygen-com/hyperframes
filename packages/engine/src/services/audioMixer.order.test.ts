import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";

const { runFfmpegMock } = vi.hoisted(() => ({ runFfmpegMock: vi.fn() }));
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/runFfmpeg.js")>()),
  runFfmpeg: runFfmpegMock,
}));

// Enough cores that every preparation starts at once, so they can finish in reverse.
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  cpus: () =>
    Array.from({ length: 16 }, () => ({}) as ReturnType<typeof import("node:os").cpus>[number]),
}));

// The AAC encode is aacEncode.test.ts's subject; here the mix only has to hand it the float sum.
vi.mock("./aacEncode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./aacEncode.js")>()),
  encodeAac: vi.fn(async () => ({ success: true, durationMs: 1, stderr: "", exitCode: 0 })),
}));

vi.mock("../utils/ffprobe.js", () => ({
  extractAudioMetadata: vi.fn(async () => ({ durationSeconds: 1, channels: 2 })),
}));

import { processCompositionAudio, type AudioElement } from "./audioMixer.js";

const dirs: string[] = [];
afterEach(() => {
  runFfmpegMock.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it.each(["flat", "one bus", "two buses"])(
  "keeps authored mix input order when preparations finish in reverse (%s)",
  async (layout) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-audio-order-"));
    dirs.push(dir);
    const ids =
      layout === "two buses"
        ? ["first", "second", "third", "fourth"]
        : ["first", "second", "third"];
    const elements: AudioElement[] = ids.map((id, index) => {
      writeFileSync(join(dir, `${id}.wav`), "RIFF0000WAVE");
      return {
        id,
        src: `${id}.wav`,
        type: "audio",
        start: 0,
        end: 1,
        mediaStart: 0,
        layer: 0,
        volume: 1,
        ...(layout === "flat"
          ? {}
          : { groupId: layout === "one bus" ? "bus" : `bus-${index % 2}`, groupVolume: 1 }),
      };
    });
    const pending = new Map<string, () => void>();
    const completed: string[] = [];
    const mixes: string[][] = [];
    let allStarted = () => {};
    const started = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    runFfmpegMock.mockImplementation(async (args: string[]) => {
      const out = args.at(-1)!;
      if (out.endsWith("-trimmed.wav")) {
        await new Promise<void>((resolve) => {
          pending.set(basename(out), resolve);
          if (pending.size === elements.length) allStarted();
        });
        completed.push(basename(out));
      } else {
        mixes.push(args.flatMap((arg, i) => (arg === "-i" ? [basename(args[i + 1]!)] : [])));
      }
      writeFileSync(out, "RIFF0000WAVE");
      return { success: true, durationMs: 1, stderr: "", exitCode: 0 };
    });
    const result = processCompositionAudio(
      elements,
      dir,
      join(dir, "work"),
      join(dir, "out.m4a"),
      1,
    );
    await started;
    const reversed = [...ids].reverse();
    for (const id of reversed) {
      pending.get(`${id}-trimmed.wav`)!();
      await setImmediate();
    }
    expect((await result).success).toBe(true);
    expect(completed).toEqual(reversed.map((id) => `${id}-trimmed.wav`));
    if (layout === "two buses") {
      expect(mixes).toEqual([
        ["first-trimmed.wav", "third-trimmed.wav"],
        ["second-trimmed.wav", "fourth-trimmed.wav"],
        ["group-bus-0-0.wav", "group-bus-1-1.wav"],
      ]);
    } else {
      expect(mixes[0]).toEqual(["first-trimmed.wav", "second-trimmed.wav", "third-trimmed.wav"]);
    }
  },
);
