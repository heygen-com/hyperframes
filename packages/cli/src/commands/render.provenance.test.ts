import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";
import { buildDockerRunArgs } from "../utils/dockerRunArgs.js";
import { createRenderPlan, parseProvenanceArgs } from "./render/plan.js";

describe("parseProvenanceArgs", () => {
  it("is off when neither flag is given", () => {
    expect(parseProvenanceArgs(undefined, undefined)).toBeUndefined();
    expect(parseProvenanceArgs(false, undefined)).toBeUndefined();
    expect(parseProvenanceArgs(undefined, "  ")).toBeUndefined();
  });

  it("turns on the default sidecar with --provenance", () => {
    expect(parseProvenanceArgs(true, undefined)).toBe(true);
  });

  it("resolves --provenance-path, which implies --provenance", () => {
    expect(parseProvenanceArgs(undefined, "receipts/out.json")).toBe(resolve("receipts/out.json"));
  });
});

/** Minimal renderable project fixture — one composition root, no clips. */
function makeProvenanceProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-render-provenance-"));
  const root =
    '<main data-composition-id="main" data-width="1920" data-height="1080" data-fps="30"></main>';
  writeFileSync(join(dir, "index.html"), root);
  return dir;
}

describe("createRenderPlan provenance", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProvenanceProjectDir();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("leaves provenance off by default", () => {
    const plan = createRenderPlan({ dir: projectDir, output: "out.mp4" });
    expect(plan.provenance).toBeUndefined();
  });

  it("threads --provenance through the plan", () => {
    const plan = createRenderPlan({ dir: projectDir, output: "out.mp4", provenance: true });
    expect(plan.provenance).toBe(true);
  });

  it("threads a custom sidecar path through the plan", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "out.mp4",
      "provenance-path": "receipts/out.json",
    });
    expect(plan.provenance).toBe(resolve("receipts/out.json"));
  });

  it("rejects a custom sidecar path with --batch (rows write their own sidecars)", () => {
    expect(() =>
      createRenderPlan({
        dir: projectDir,
        batch: "rows.json",
        "provenance-path": "receipts/out.json",
      }),
    ).toThrow(CliUsageError);
  });

  it("allows enabling provenance batch-wide", () => {
    const plan = createRenderPlan({ dir: projectDir, batch: "rows.json", provenance: true });
    expect(plan.provenance).toBe(true);
  });

  it("rejects a custom sidecar path with --docker (path is not container-visible)", () => {
    expect(() =>
      createRenderPlan({
        dir: projectDir,
        output: "out.mp4",
        docker: true,
        "provenance-path": "receipts/out.json",
      }),
    ).toThrow(CliUsageError);
  });

  it("allows --provenance with --docker", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "out.mp4",
      docker: true,
      provenance: true,
    });
    expect(plan.provenance).toBe(true);
  });
});

describe("buildDockerRunArgs provenance forwarding", () => {
  const base = {
    imageTag: "hyperframes-renderer:test",
    projectDir: "/host/project",
    outputDir: "/host/renders",
    outputFilename: "out.mp4",
    platform: "linux/amd64",
    options: {
      fps: { num: 30, den: 1 },
      quality: "standard" as const,
      format: "mp4" as const,
      gpu: false,
      browserGpu: false,
      hdrMode: "auto" as const,
      quiet: true,
    },
  };

  it("forwards --provenance into the container CLI", () => {
    const args = buildDockerRunArgs({
      ...base,
      options: { ...base.options, provenance: true },
    });
    expect(args).toContain("--provenance");
  });

  it("does not forward anything when provenance is off", () => {
    const args = buildDockerRunArgs(base);
    expect(args).not.toContain("--no-provenance");
    expect(args).not.toContain("--provenance");
  });
});
