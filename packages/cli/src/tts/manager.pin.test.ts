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
    async (_url: string, dest: string, options: { verify: (path: string) => Promise<void> }) => {
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
  ["model", () => ensureModel(), model, /kokoro-v1\.0\.onnx did not match its pinned/],
  ["voices", () => ensureVoices(), voices, /voices-v1\.0\.bin did not match its pinned/],
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

    await expect(run()).rejects.toThrow(/did not match its pinned/);

    expect(existsSync(path)).toBe(false);
  },
);
