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
// Downloads pass their pin check unless a test says otherwise; `real.verifies` hashes a file.
const real = vi.hoisted(() => ({ verifies: undefined as unknown as typeof verifies }));
vi.mock("../whisper/modelFile.js", async (original) => {
  const actual = await original<typeof import("../whisper/modelFile.js")>();
  real.verifies = actual.verifies;
  return { ...actual, verifies: vi.fn(async () => true) };
});
/** The next pin check, which is the cached file's, really hashes it. */
const hashCachedFile = () =>
  vi.mocked(verifies).mockImplementationOnce((path, pin) => real.verifies(path, pin));
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

const cases = [
  ["model", model, 325_532_387, () => ensureModel()],
  ["voices", voices, 28_214_398, () => ensureVoices()],
] as const;

it.each(cases)(
  "downloads the %s again when the cached file has the wrong size",
  async (_kind, path, _bytes, ensure) => {
    writeFileSync(path, "cut");
    hashCachedFile();

    await expect(ensure()).resolves.toBe(path);

    expect(readFileSync(path, "utf8")).toBe("fresh");
    expect(vi.mocked(downloadFile).mock.calls[0]![1]).toBe(path);
  },
);

it.each(cases)(
  "downloads the %s again when a cached file of the pinned size has other contents",
  async (_kind, path, bytes, ensure) => {
    writeFileSync(path, "");
    truncateSync(path, bytes);
    hashCachedFile();

    await expect(ensure()).resolves.toBe(path);

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("fresh");
  },
);

it.each([
  ["kokoro-v1.0.onnx", model, () => ensureModel()],
  ["voices-v1.0.bin", voices, () => ensureVoices()],
])("discards a %s download that does not match its pin", async (name, path, ensure) => {
  hashCachedFile();
  vi.mocked(verifies).mockResolvedValueOnce(false);

  await expect(ensure()).rejects.toThrow(`${name} did not match its pinned size and sha256`);

  expect(readdirSync(join(path, ".."))).toEqual([]);
});

it.each(cases)(
  "keeps a cached %s that matches its pin without downloading it",
  async (_kind, path, _bytes, ensure) => {
    writeFileSync(path, "the real file");

    await expect(ensure()).resolves.toBe(path);

    expect(vi.mocked(verifies).mock.calls[0]![0]).toBe(path);
    expect(downloadFile).not.toHaveBeenCalled();
  },
);
