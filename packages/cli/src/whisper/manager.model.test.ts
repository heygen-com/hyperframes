import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadFile } from "../utils/download.js";
import { verifies } from "./modelFile.js";
import { ensureModel } from "./manager.js";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/hf-whisper-model-${process.pid}`);
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));
// The mode of the folder each download began writing into.
const folderModes = vi.hoisted(() => [] as number[]);
vi.mock("../utils/download.js", () => ({
  downloadFile: vi.fn(
    async (_url: string, dest: string, options: { verify: (path: string) => Promise<void> }) => {
      folderModes.push(statSync(join(dest, "..")).mode & 0o777);
      writeFileSync(`${dest}.part`, "fresh");
      await options.verify(`${dest}.part`).catch((error: unknown) => {
        rmSync(`${dest}.part`);
        throw error;
      });
      renameSync(`${dest}.part`, dest);
    },
  ),
}));
vi.mock("./modelFile.js", async (original) => ({
  ...(await original<typeof import("./modelFile.js")>()),
  verifies: vi.fn(async () => true),
}));
const modelsDir = join(home, ".cache", "hyperframes", "whisper", "models");
const tiny = join(modelsDir, "ggml-tiny.bin");

beforeEach(() => mkdirSync(modelsDir, { recursive: true }));
afterEach(() => {
  folderModes.length = 0;
  rmSync(home, { recursive: true, force: true });
  vi.clearAllMocks();
});

it("downloads a pinned model again when the cached file has the wrong size", async () => {
  writeFileSync(tiny, "cut");

  await expect(ensureModel("tiny")).resolves.toBe(tiny);

  expect(readFileSync(tiny, "utf8")).toBe("fresh");
  expect(vi.mocked(downloadFile).mock.calls[0]![1]).toBe(tiny);
  expect(vi.mocked(downloadFile).mock.calls[0]![0]).toMatch(
    /huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\/ggml-tiny\.bin$/,
  );
});

it("discards a download that does not match its pinned size and sha256", async () => {
  vi.mocked(verifies).mockResolvedValueOnce(false);

  await expect(ensureModel("tiny")).rejects.toThrow(/ggml-tiny\.bin did not match its pinned/);

  expect(readdirSync(modelsDir)).toEqual([]);
});

it("keeps a pinned model of the right size without downloading it", async () => {
  writeFileSync(tiny, "");
  truncateSync(tiny, 77_691_713);

  await expect(ensureModel("tiny")).resolves.toBe(tiny);

  expect(downloadFile).not.toHaveBeenCalled();
});

it("uses a model that is not pinned as it was downloaded", async () => {
  const custom = join(modelsDir, "ggml-large-v3-turbo-q5_0.bin");
  writeFileSync(custom, "any size");

  await expect(ensureModel("large-v3-turbo-q5_0")).resolves.toBe(custom);

  expect(downloadFile).not.toHaveBeenCalled();
  expect(existsSync(custom)).toBe(true);
});

// fails without the fix: the models folder was made with `mkdir -p` and written as found, link or not.
it.skipIf(!process.getuid)(
  "downloads nothing through a models folder that is a link out of the cache",
  async () => {
    const elsewhere = mkdtempSync(join(home, "..", "hf-whisper-elsewhere-"));
    try {
      rmSync(modelsDir, { recursive: true });
      symlinkSync(elsewhere, modelsDir);

      await expect(ensureModel("tiny")).rejects.toThrow("can be changed by another user account");

      expect(downloadFile).not.toHaveBeenCalled();
      expect(readdirSync(elsewhere)).toEqual([]);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  },
);

// fails without the fix: the person's own group- and world-writable folder received the download as it was.
it.skipIf(!process.getuid)(
  "takes group and other write off the models folder before the download writes",
  async () => {
    chmodSync(modelsDir, 0o777);

    await expect(ensureModel("tiny")).resolves.toBe(tiny);

    expect(folderModes).toHaveLength(1);
    expect(folderModes[0]! & 0o022).toBe(0);
  },
);
