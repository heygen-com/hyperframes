import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listWhisperModels } from "./manager.js";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/hf-whisper-list-${process.pid}`);
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));
const modelsDir = join(home, ".cache", "hyperframes", "whisper", "models");

afterEach(() => rmSync(home, { recursive: true, force: true }));

it("lists nothing before any whisper model was downloaded", () => {
  expect(listWhisperModels()).toEqual([]);
});

it("lists each downloaded ggml model by the name ensureModel takes, and nothing else", () => {
  mkdirSync(modelsDir, { recursive: true });
  for (const file of ["ggml-small.en.bin", "ggml-base.bin", "notes.txt", "ggml-tiny.bin.part"])
    writeFileSync(join(modelsDir, file), "");
  expect(listWhisperModels()).toEqual([
    { model: "base", path: join(modelsDir, "ggml-base.bin") },
    { model: "small.en", path: join(modelsDir, "ggml-small.en.bin") },
  ]);
});

it("skips a dangling link that ensureModel would download again", () => {
  mkdirSync(modelsDir, { recursive: true });
  symlinkSync(join(home, "gone.bin"), join(modelsDir, "ggml-tiny.bin"));
  expect(listWhisperModels()).toEqual([]);
});
