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
import { afterEach, describe, expect, it } from "vitest";
import { sweepDeadCoreMlTemp, trackCoreMlTemp } from "./coremlTemp.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "hf-coreml-temp-"));
  roots.push(root);
  const tmp = join(root, "T");
  const manifests = join(root, "manifests");
  mkdirSync(tmp);
  return { tmp, manifests };
}

const compiled = (tmp: string, id: string) => {
  mkdirSync(join(tmp, `onnxruntime-${id}.model.mlmodelc`));
  writeFileSync(join(tmp, `onnxruntime-${id}.model.mlmodel`), "spec");
};

describe("CoreML temp folders", () => {
  it("a run killed before it released its session has its compiled models removed by the next run", () => {
    const { tmp, manifests } = scratch();
    mkdirSync(join(tmp, "unrelated"));
    const killed = trackCoreMlTemp({ tmp, manifests, alive: () => true });
    compiled(tmp, "a");
    compiled(tmp, "b");
    killed.record();
    const path = join(manifests, `${process.pid}.json`);
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf-8")), pid: gone }));

    sweepDeadCoreMlTemp({ tmp, manifests });

    expect(readdirSync(tmp)).toEqual(["unrelated"]);
    expect(readdirSync(manifests)).toEqual([]);
  });

  it("leaves a running run's compiled models alone", () => {
    const { tmp, manifests } = scratch();
    const running = trackCoreMlTemp({ tmp, manifests });
    compiled(tmp, "a");
    running.record();
    writeFileSync(join(manifests, "999999.json"), JSON.stringify({ pid: 999999, tmp, dirs: [] }));

    sweepDeadCoreMlTemp({ tmp, manifests, alive: (pid) => pid !== 999999 });

    expect(existsSync(join(tmp, "onnxruntime-a.model.mlmodelc"))).toBe(true);
    expect(readdirSync(manifests)).toEqual([`${process.pid}.json`]);
  });

  it("removes only compiled models by name, never a path a manifest points elsewhere", () => {
    const { tmp, manifests } = scratch();
    mkdirSync(manifests);
    mkdirSync(join(tmp, "keep"));
    writeFileSync(
      join(manifests, "1.json"),
      JSON.stringify({ pid: 1, tmp, dirs: ["../T/keep", "keep", "onnxruntime-x.model.mlmodelc"] }),
    );

    sweepDeadCoreMlTemp({ tmp, manifests, alive: () => false });

    expect(existsSync(join(tmp, "keep"))).toBe(true);
  });

  it("forgets a run that released its session", () => {
    const { tmp, manifests } = scratch();
    const run = trackCoreMlTemp({ tmp, manifests });
    run.record();
    run.forget();
    expect(readdirSync(manifests)).toEqual([]);
  });
});
