import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { ensureModel, modelPath } from "./manager.js";

const cache = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/hf-bgrm-pin-`);
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
      if (await options.keepExisting(dest)) return;
      rmSync(dest, { force: true });
      writeFileSync(`${dest}.part`, "swapped weights");
      await options.verify(`${dest}.part`).catch((error: unknown) => {
        rmSync(`${dest}.part`);
        throw error;
      });
      renameSync(`${dest}.part`, dest);
    },
  ),
}));

afterEach(() => rmSync(cache, { recursive: true, force: true }));
afterAll(() => {
  delete process.env["HYPERFRAMES_CACHE_DIR"];
});

it("refuses downloaded weights that do not match the pinned sha256", async () => {
  await expect(ensureModel()).rejects.toThrow(
    /u2net_human_seg\.onnx was discarded because it does not match/,
  );

  expect(existsSync(modelPath())).toBe(false);
});

it("does not load cached weights that do not match the pinned sha256", async () => {
  mkdirSync(join(modelPath(), ".."), { recursive: true });
  writeFileSync(modelPath(), "swapped weights");

  await expect(ensureModel()).rejects.toThrow(/was discarded because it does not match/);

  expect(existsSync(modelPath())).toBe(false);
});
