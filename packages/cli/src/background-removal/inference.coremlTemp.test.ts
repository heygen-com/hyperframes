import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scratch = vi.hoisted(() => ({ tmp: "", manifests: "", compiled: 0 }));
const cleanups = vi.hoisted(() => new Set<() => Promise<void>>());

vi.mock("../browser/launch.js", () => ({
  registerBrowserSessionCleanup: (cleanup: () => Promise<void>) => {
    cleanups.add(cleanup);
    return () => cleanups.delete(cleanup);
  },
}));
vi.mock("./manager.js", () => ({
  ensureModel: async () => "model.onnx",
  selectProviders: () => ({ providers: ["coreml", "cpu"], label: "CoreML" }),
}));
vi.mock("../utils/optionalPackages.js", () => ({
  loadSharp: async () => ({}),
  loadOptionalPackage: async () => ({
    InferenceSession: {
      create: async () => {
        for (let i = 0; i < 3; i++) {
          mkdirSync(join(scratch.tmp, `onnxruntime-${scratch.compiled++}.model.mlmodelc`));
        }
        return { inputNames: ["in"], outputNames: ["out"], release: vi.fn(async () => undefined) };
      },
    },
  }),
}));
vi.mock("./coremlTemp.js", async (importActual) => {
  const actual = await importActual<typeof import("./coremlTemp.js")>();
  return {
    ...actual,
    trackCoreMlTemp: () =>
      actual.trackCoreMlTemp({ tmp: scratch.tmp, manifests: scratch.manifests }),
  };
});

import { createSession } from "./inference.js";

const compiledDirs = () => readdirSync(scratch.tmp).filter((n) => n.startsWith("onnxruntime-"));

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "hf-coreml-session-"));
  scratch.tmp = join(root, "T");
  scratch.manifests = join(root, "manifests");
  scratch.compiled = 0;
  mkdirSync(scratch.tmp);
});
afterEach(() => {
  cleanups.clear();
  rmSync(join(scratch.tmp, ".."), { recursive: true, force: true });
});

describe("CoreML sessions and the system temp folder", () => {
  it("the next run removes the compiled models a killed run left behind", async () => {
    await createSession();
    expect(compiledDirs()).toHaveLength(3);
    const manifestPath = join(scratch.manifests, `${process.pid}.json`);
    const gone = spawnSync(process.execPath, ["-e", ""]).pid!;
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, "utf-8")), pid: gone }),
    );

    await createSession();

    expect(compiledDirs()).toEqual([
      "onnxruntime-3.model.mlmodelc",
      "onnxruntime-4.model.mlmodelc",
      "onnxruntime-5.model.mlmodelc",
    ]);
  });

  it("a signal releases the session through the CLI's shutdown, and a closed session forgets it", async () => {
    const session = await createSession();
    expect(cleanups.size).toBe(1);
    const [stop] = [...cleanups];
    await stop!();
    await session.close();
    expect(cleanups.size).toBe(0);
    expect(existsSync(join(scratch.manifests, `${process.pid}.json`))).toBe(false);
  });
});
