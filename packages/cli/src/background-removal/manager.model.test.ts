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
const modelsDir = join(home, ".cache", "hyperframes", "background-removal", "models");
const weights = join(modelsDir, "u2net_human_seg.onnx");

beforeEach(() => mkdirSync(modelsDir, { recursive: true }));
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.clearAllMocks();
});

it("downloads the weights again when the cached file has the wrong size", async () => {
  writeFileSync(weights, "cut");
  hashCachedFile();

  await expect(ensureModel()).resolves.toBe(weights);

  expect(readFileSync(weights, "utf8")).toBe("fresh");
  expect(vi.mocked(downloadFile).mock.calls[0]![1]).toBe(weights);
});

it("downloads the weights again when a cached file of the pinned size has other contents", async () => {
  writeFileSync(weights, "");
  truncateSync(weights, 175_997_641);
  hashCachedFile();

  await expect(ensureModel()).resolves.toBe(weights);

  expect(downloadFile).toHaveBeenCalledTimes(1);
  expect(readFileSync(weights, "utf8")).toBe("fresh");
});

it("discards a download that does not match its pinned size and sha256", async () => {
  hashCachedFile();
  vi.mocked(verifies).mockResolvedValueOnce(false);

  await expect(ensureModel()).rejects.toThrow(/u2net_human_seg\.onnx did not match its pinned/);

  expect(readdirSync(modelsDir)).toEqual([]);
});

it("keeps cached weights that match their pin without downloading them", async () => {
  writeFileSync(weights, "the real weights");

  await expect(ensureModel()).resolves.toBe(weights);

  expect(vi.mocked(verifies).mock.calls[0]![0]).toBe(weights);
  expect(downloadFile).not.toHaveBeenCalled();
});
