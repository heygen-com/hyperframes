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
import { ensureModel } from "./manager.js";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/hf-bg-model-${process.pid}`);
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
const modelsDir = join(home, ".cache", "hyperframes", "background-removal", "models");
const weights = join(modelsDir, "u2net_human_seg.onnx");

beforeEach(() => mkdirSync(modelsDir, { recursive: true }));
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.clearAllMocks();
});

it("downloads the weights again when the cached file has the wrong size", async () => {
  writeFileSync(weights, "cut");

  await expect(ensureModel()).resolves.toBe(weights);

  expect(readFileSync(weights, "utf8")).toBe("fresh");
  expect(vi.mocked(downloadFile).mock.calls[0]![1]).toBe(weights);
});

it("discards a download that does not match its pinned size and sha256", async () => {
  vi.mocked(verifies).mockResolvedValueOnce(false);

  await expect(ensureModel()).rejects.toThrow(/u2net_human_seg\.onnx did not match its pinned/);

  expect(readdirSync(modelsDir)).toEqual([]);
});

it("keeps cached weights of the pinned size without downloading them", async () => {
  writeFileSync(weights, "");
  truncateSync(weights, 175_997_641);

  await expect(ensureModel()).resolves.toBe(weights);

  expect(downloadFile).not.toHaveBeenCalled();
});
