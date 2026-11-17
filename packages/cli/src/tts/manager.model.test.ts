import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadFile } from "../utils/download.js";
import { verifies } from "../whisper/modelFile.js";
import { ensureModel, ensureVoices } from "./manager.js";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/hf-tts-model-${process.pid}`);
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));
vi.mock("../utils/download.js", () => ({
  downloadFile: vi.fn(
    async (_url: string, dest: string, options: { verify: (path: string) => Promise<void> }) => {
      writeFileSync(`${dest}.part`, "fresh");
      await options.verify(`${dest}.part`).catch((error: unknown) => {
        rmSync(`${dest}.part`);
        throw error;
      });
      renameSync(`${dest}.part`, dest);
    },
  ),
}));
vi.mock("../whisper/modelFile.js", async (original) => ({
  ...(await original<typeof import("../whisper/modelFile.js")>()),
  verifies: vi.fn(async () => true),
}));
const ttsDir = join(home, ".cache", "hyperframes", "tts");
const model = join(ttsDir, "models", "kokoro-v1.0.onnx");
const voices = join(ttsDir, "voices", "voices-v1.0.bin");

beforeEach(() => {
  mkdirSync(join(ttsDir, "models"), { recursive: true });
  mkdirSync(join(ttsDir, "voices"), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.clearAllMocks();
});

it.each([
  ["model", model, () => ensureModel()],
  ["voices", voices, () => ensureVoices()],
])(
  "downloads the %s again when the cached file has the wrong size",
  async (_kind, path, ensure) => {
    writeFileSync(path, "cut");

    await expect(ensure()).resolves.toBe(path);

    expect(readFileSync(path, "utf8")).toBe("fresh");
    expect(vi.mocked(downloadFile).mock.calls[0]![1]).toBe(path);
  },
);

it.each([
  ["kokoro-v1.0.onnx", model, () => ensureModel()],
  ["voices-v1.0.bin", voices, () => ensureVoices()],
])("discards a %s download that does not match its pin", async (name, path, ensure) => {
  vi.mocked(verifies).mockResolvedValueOnce(false);

  await expect(ensure()).rejects.toThrow(`${name} did not match its pinned size and sha256`);

  expect(readdirSync(join(path, ".."))).toEqual([]);
});

it.each([
  ["model", model, 325_532_387, () => ensureModel()],
  ["voices", voices, 28_214_398, () => ensureVoices()],
])(
  "keeps a cached %s of the pinned size without downloading it",
  async (_kind, path, bytes, ensure) => {
    writeFileSync(path, "");
    truncateSync(path, bytes);

    await expect(ensure()).resolves.toBe(path);

    expect(downloadFile).not.toHaveBeenCalled();
  },
);
