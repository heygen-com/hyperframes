import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { transcribe } from "./transcribe.js";

const native = vi.hoisted(() => ({ exec: vi.fn(), missingLanguage: false, runtime: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: native.exec }));
vi.mock("./manager.js", () => ({
  DEFAULT_MODEL: "small.en",
  ensureWhisper: native.runtime,
  ensureModel: async (
    model: string,
    options: { onDownloadProgress?: (received: number, total: number | null) => void },
  ) => {
    options.onDownloadProgress?.(5, null);
    return `ggml-${model}.bin`;
  },
  hasFFmpeg: () => true,
}));
vi.mock("../browser/ffmpeg.js", () => ({
  findFFprobe: () => "ffprobe",
  findFFmpeg: () => "ffmpeg",
  getFFmpegInstallHint: () => "ffmpeg",
}));
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-language-"));
  writeFileSync(join(dir, "audio.wav"), Buffer.alloc(44));
  native.missingLanguage = false;
  native.runtime.mockReset().mockResolvedValue({ executablePath: "whisper-cli", source: "env" });
  native.exec.mockReset().mockImplementation((command: string, args: string[]) => {
    if (command === "ffprobe")
      return JSON.stringify({
        streams: [
          { codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "16000", channels: 1 },
        ],
      });
    if (command !== "whisper-cli") throw new Error(`Unexpected executable: ${command}`);
    if (args.includes("--detect-language")) return "";
    const selected = args[args.indexOf("--language") + 1];
    let language = args.includes("--language") ? selected : "en";
    if (language === "auto") language = "es";
    const output = args[args.indexOf("--output-file") + 1];
    writeFileSync(
      `${output}.json`,
      JSON.stringify({
        result: native.missingLanguage ? {} : { language },
        transcription: [
          {
            tokens: [
              { text: language === "es" ? "Hola" : "Hello", offsets: { from: 0, to: 1000 } },
            ],
          },
        ],
      }),
    );
    return "";
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("decodes multilingual audio automatically and returns the native detection", async () => {
  const result = await transcribe(join(dir, "audio.wav"), dir, { model: "small" });
  expect(result).toMatchObject({ detectedLanguage: "es", model: "small", wordCount: 1 });
  expect(native.exec.mock.calls.filter(([command]) => command === "whisper-cli")).toHaveLength(1);
});
it.each([
  ["small.en", undefined, "small.en"],
  ["small.en", "de", "small"],
  ["small", "en", "small"],
])("does not label requested %s / %s as detection", async (model, language, resolved) => {
  const result = await transcribe(join(dir, "audio.wav"), dir, { model, language });
  expect(result).toMatchObject({ detectedLanguage: null, model: resolved });
});
it("keeps an absent native language unknown", async () => {
  native.missingLanguage = true;
  expect(await transcribe(join(dir, "audio.wav"), dir, { model: "small" })).toMatchObject({
    detectedLanguage: null,
  });
});
it("reports download bytes and truthful transcription boundaries", async () => {
  const events: unknown[] = [];
  await transcribe(join(dir, "audio.wav"), dir, {
    model: "small",
    onEvent: (event) => events.push(event),
  });
  expect(events).toEqual([
    { type: "progress", phase: "download", model: "small", receivedBytes: 5, totalBytes: null },
    { type: "progress", phase: "transcription", model: "small", status: "started" },
    { type: "progress", phase: "transcription", model: "small", status: "completed" },
  ]);
});

it("carries the runtime-install policy to discovery while leaving model downloads enabled", async () => {
  const events: unknown[] = [];
  await transcribe(join(dir, "audio.wav"), dir, {
    installRuntime: false,
    onEvent: (event) => events.push(event),
  });
  expect(native.runtime).toHaveBeenCalledWith(expect.objectContaining({ installRuntime: false }));
  expect(events).toContainEqual({
    type: "progress",
    phase: "download",
    model: "small.en",
    receivedBytes: 5,
    totalBytes: null,
  });
});
it("does not claim transcription completed when decoding fails", async () => {
  const events: unknown[] = [];
  const previous = native.exec.getMockImplementation()!;
  native.exec.mockImplementation((command: string, args: string[]) => {
    if (command === "whisper-cli") throw new Error("decoder failed");
    return previous(command, args);
  });
  await expect(
    transcribe(join(dir, "audio.wav"), dir, {
      model: "small",
      onEvent: (event) => events.push(event),
    }),
  ).rejects.toThrow("decoder failed");
  expect(events).toEqual([
    { type: "progress", phase: "download", model: "small", receivedBytes: 5, totalBytes: null },
    { type: "progress", phase: "transcription", model: "small", status: "started" },
  ]);
});
