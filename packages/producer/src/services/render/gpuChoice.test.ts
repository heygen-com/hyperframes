import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gpuChoiceStore, readGpuChoice, writeGpuChoice } from "./gpuChoice.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fileIn = () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-gpu-choice-"));
  dirs.push(dir);
  return join(dir, "state", "gpu-choice.json");
};
const cfg = (file: string, version = "1.2.3") => ({
  gpuChoiceFile: file,
  hyperframesVersion: version,
});
const GPU = "ANGLE (AMD, AMD Radeon(TM) 840M Graphics Direct3D11) | AMD 32.0.21025.10016";

describe("gpuChoiceStore", () => {
  it("keys the choice by version and GPU", () => {
    expect(gpuChoiceStore(cfg("/x/gpu-choice.json"), GPU)).toEqual({
      file: "/x/gpu-choice.json",
      key: `1.2.3 | ${GPU}`,
    });
  });

  it("has no store without a file, a version or a probed GPU", () => {
    expect(gpuChoiceStore({ hyperframesVersion: "1.2.3" }, GPU)).toBeUndefined();
    expect(gpuChoiceStore({ gpuChoiceFile: "/x/gpu-choice.json" }, GPU)).toBeUndefined();
    expect(gpuChoiceStore(cfg("/x/gpu-choice.json"), undefined)).toBeUndefined();
  });
});

describe("readGpuChoice / writeGpuChoice", () => {
  it("reads back what was written for the same key, creating the folder", () => {
    const store = gpuChoiceStore(cfg(fileIn()), GPU)!;
    writeGpuChoice(store, "software", { hardwareP95Ms: 1678, softwareP95Ms: 90 });
    expect(readGpuChoice(store)).toBe("software");
    expect(JSON.parse(readFileSync(store.file, "utf8"))).toMatchObject({
      key: store.key,
      mode: "software",
      hardwareP95Ms: 1678,
      softwareP95Ms: 90,
    });
  });

  it("measures again when the version, GPU or driver changed", () => {
    const file = fileIn();
    writeGpuChoice(gpuChoiceStore(cfg(file), GPU)!, "software", {});
    expect(readGpuChoice(gpuChoiceStore(cfg(file, "1.2.4"), GPU)!)).toBeUndefined();
    expect(readGpuChoice(gpuChoiceStore(cfg(file), `${GPU}.1`)!)).toBeUndefined();
  });

  it("measures again when there is no file or it is not a choice", () => {
    const store = gpuChoiceStore(cfg(fileIn()), GPU)!;
    expect(readGpuChoice(store)).toBeUndefined();
    writeGpuChoice(store, "hardware", {});
    writeFileSync(store.file, "{not json");
    expect(readGpuChoice(store)).toBeUndefined();
    writeFileSync(store.file, JSON.stringify({ key: store.key, mode: "fast" }));
    expect(readGpuChoice(store)).toBeUndefined();
  });
});
