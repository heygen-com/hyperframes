import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadFile } from "./download.js";
import { ensurePinnedFile } from "./pinnedFile.js";

const served = vi.hoisted(() => ({ bytes: "model" }));
vi.mock("./download.js", () => ({
  downloadFile: vi.fn(
    async (
      _url: string,
      dest: string,
      options: {
        keepExisting: (path: string) => Promise<boolean>;
        verify: (path: string) => Promise<void>;
      },
    ) => {
      if (await options.keepExisting(dest)) return;
      rmSync(dest, { force: true });
      writeFileSync(`${dest}.part`, served.bytes);
      await options.verify(`${dest}.part`).catch((error: unknown) => {
        rmSync(`${dest}.part`);
        throw error;
      });
      renameSync(`${dest}.part`, dest);
    },
  ),
}));

let dir = "";
let dest = "";
const pin = {
  name: "model.onnx",
  bytes: 5,
  sha256: createHash("sha256").update("model").digest("hex"),
};
const progress = { downloading: "Downloading model..." };

beforeEach(() => {
  served.bytes = "model";
  dir = mkdtempSync(join(tmpdir(), "hf-pinned-file-"));
  dest = join(dir, "models", "model.onnx");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

it("uses a cached file that matches its pin without downloading it", async () => {
  mkdirSync(join(dir, "models"));
  writeFileSync(dest, "model");

  await expect(ensurePinnedFile("https://x.test/m", dest, pin, progress)).resolves.toBe(dest);

  expect(downloadFile).not.toHaveBeenCalled();
});

it("downloads a file that matches its pin", async () => {
  await expect(ensurePinnedFile("https://x.test/m", dest, pin, progress)).resolves.toBe(dest);

  expect(readFileSync(dest, "utf8")).toBe("model");
});

it("replaces a cached file of the same size that does not match its pin", async () => {
  mkdirSync(join(dir, "models"));
  writeFileSync(dest, "other");
  const onProgress = vi.fn();

  await ensurePinnedFile("https://x.test/m", dest, pin, { ...progress, onProgress });

  expect(readFileSync(dest, "utf8")).toBe("model");
  expect(onProgress).toHaveBeenCalledWith(
    "The cached model.onnx does not match its pinned sha256; downloading it again...",
  );
});

it("discards a download that does not match its pin and refuses it", async () => {
  served.bytes = "swapped";
  mkdirSync(join(dir, "models"));
  writeFileSync(dest, "other");

  await expect(ensurePinnedFile("https://x.test/m", dest, pin, progress)).rejects.toThrow(
    "model.onnx was discarded because it does not match its expected size and sha256. " +
      "Retrying helps only if the download was interrupted or corrupted.",
  );

  expect(existsSync(dest)).toBe(false);
  expect(readdirSync(join(dir, "models"))).toEqual([]);
});
