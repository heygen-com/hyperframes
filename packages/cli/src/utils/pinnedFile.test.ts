import { createHash } from "node:crypto";
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadFile } from "./download.js";
import { ensurePinnedFile } from "./pinnedFile.js";

const served = vi.hoisted(() => ({ bytes: "model" }));
const ownedByAnotherAccount = vi.hoisted(() => new Set<string>());
// The mode of the folder each download began writing into.
const folderModes = vi.hoisted(() => [] as number[]);
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const lstatSync = ((path: string, options?: object) => {
    const stat = fs.lstatSync(path, options as never);
    return stat && ownedByAnotherAccount.has(path)
      ? Object.assign(stat, { uid: process.getuid!() + 1 })
      : stat;
  }) as typeof fs.lstatSync;
  return { ...fs, lstatSync };
});
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
      folderModes.push(statSync(join(dest, "..")).mode & 0o777);
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
  ownedByAnotherAccount.clear();
  folderModes.length = 0;
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

it("uses a cached file that matches its pin without downloading it", async () => {
  mkdirSync(join(dir, "models"));
  writeFileSync(dest, "model");

  await expect(ensurePinnedFile("https://x.test/m", dest, dir, pin, progress)).resolves.toBe(dest);

  expect(downloadFile).not.toHaveBeenCalled();
});

it("downloads a file that matches its pin", async () => {
  await expect(ensurePinnedFile("https://x.test/m", dest, dir, pin, progress)).resolves.toBe(dest);

  expect(readFileSync(dest, "utf8")).toBe("model");
});

it("replaces a cached file of the same size that does not match its pin", async () => {
  mkdirSync(join(dir, "models"));
  writeFileSync(dest, "other");
  const onProgress = vi.fn();

  await ensurePinnedFile("https://x.test/m", dest, dir, pin, { ...progress, onProgress });

  expect(readFileSync(dest, "utf8")).toBe("model");
  expect(onProgress).toHaveBeenCalledWith(
    "The cached model.onnx does not match its pinned sha256; downloading it again...",
  );
});

it("discards a download that does not match its pin and refuses it", async () => {
  served.bytes = "swapped";
  mkdirSync(join(dir, "models"));
  writeFileSync(dest, "other");

  await expect(ensurePinnedFile("https://x.test/m", dest, dir, pin, progress)).rejects.toThrow(
    "model.onnx was discarded because it does not match its expected size and sha256. " +
      "Retrying helps only if the download was interrupted or corrupted.",
  );

  expect(existsSync(dest)).toBe(false);
  expect(readdirSync(join(dir, "models"))).toEqual([]);
});

// fails without the fix: nothing checked the folder, so the download was written into it.
it.skipIf(!process.getuid)(
  "downloads nothing into a models folder another account owns, refusing it first",
  async () => {
    mkdirSync(join(dir, "models"));
    ownedByAnotherAccount.add(join(dir, "models"));

    await expect(ensurePinnedFile("https://x.test/m", dest, dir, pin, progress)).rejects.toThrow(
      `${join(dir, "models")} can be changed by another user account`,
    );

    expect(downloadFile).not.toHaveBeenCalled();
    expect(readdirSync(join(dir, "models"))).toEqual([]);
  },
);

// fails without the fix: a matching copy in a folder another account can swap was handed back as trusted.
it.skipIf(!process.getuid)(
  "does not vouch for a cached copy in a folder another account owns",
  async () => {
    mkdirSync(join(dir, "models"));
    writeFileSync(dest, "model");
    ownedByAnotherAccount.add(join(dir, "models"));

    await expect(ensurePinnedFile("https://x.test/m", dest, dir, pin, progress)).rejects.toThrow(
      "can be changed by another user account",
    );
  },
);

// fails without the fix: the download followed the link and wrote the model into the folder it named.
it.skipIf(!process.getuid)(
  "writes nothing through a models folder that is a link out of the cache",
  async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "hf-pinned-file-elsewhere-"));
    try {
      symlinkSync(elsewhere, join(dir, "models"));

      await expect(ensurePinnedFile("https://x.test/m", dest, dir, pin, progress)).rejects.toThrow(
        "can be changed by another user account",
      );

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
    mkdirSync(join(dir, "models"));
    chmodSync(join(dir, "models"), 0o777);

    await ensurePinnedFile("https://x.test/m", dest, dir, pin, progress);

    expect(folderModes).toHaveLength(1);
    expect(folderModes[0]! & 0o022).toBe(0);
  },
);

it.skipIf(!process.getuid)("makes a new models folder owner-only", async () => {
  await ensurePinnedFile("https://x.test/m", dest, dir, pin, progress);

  expect(statSync(join(dir, "models")).mode & 0o777).toBe(0o700);
});
