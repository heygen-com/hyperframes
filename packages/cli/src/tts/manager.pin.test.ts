import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { ensureModel, ensureVoices } from "./manager.js";

const cache = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/hf-tts-pin-${process.pid}`;
  process.env["HYPERFRAMES_CACHE_DIR"] = dir;
  return dir;
});
vi.mock("../utils/download.js", () => ({
  downloadFile: vi.fn(
    async (
      _url: string,
      dest: string,
      options: {
        keepExisting: (path: string) => Promise<boolean>;
        verify: (path: string) => Promise<void>;
      },
    ) => {
      if (existsSync(dest) && (await options.keepExisting(dest))) return;
      rmSync(dest, { force: true });
      writeFileSync(`${dest}.part`, "swapped");
      await options.verify(`${dest}.part`).catch((error: unknown) => {
        rmSync(`${dest}.part`);
        throw error;
      });
      writeFileSync(dest, readFileSync(`${dest}.part`));
    },
  ),
}));

const model = join(cache, "tts", "models", "kokoro-v1.0.onnx");
const voices = join(cache, "tts", "voices", "voices-v1.0.bin");

afterEach(() => rmSync(cache, { recursive: true, force: true }));
afterAll(() => {
  delete process.env["HYPERFRAMES_CACHE_DIR"];
});

it.each([
  [
    "model",
    () => ensureModel(),
    model,
    /kokoro-v1\.0\.onnx was discarded because it does not match/,
  ],
  [
    "voices",
    () => ensureVoices(),
    voices,
    /voices-v1\.0\.bin was discarded because it does not match/,
  ],
])(
  "refuses a downloaded %s file that does not match the pinned sha256",
  async (_k, run, path, error) => {
    await expect(run()).rejects.toThrow(error);

    expect(existsSync(path)).toBe(false);
  },
);

it.each([
  ["model", () => ensureModel(), model],
  ["voices", () => ensureVoices(), voices],
])(
  "does not load a cached %s file that does not match the pinned sha256",
  async (_k, run, path) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "swapped");

    await expect(run()).rejects.toThrow(/was discarded because it does not match/);

    expect(existsSync(path)).toBe(false);
  },
);
