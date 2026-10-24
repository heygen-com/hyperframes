import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";
import { buildDockerRunArgs } from "../utils/dockerRunArgs.js";
import { createRenderPlan, parseProvenanceArg } from "./render/plan.js";

describe("parseProvenanceArg", () => {
  it("defaults to on (undefined) when the flag is absent or bare", () => {
    expect(parseProvenanceArg(undefined)).toBeUndefined();
    expect(parseProvenanceArg(true)).toBeUndefined();
    expect(parseProvenanceArg("  ")).toBeUndefined();
  });

  it("disables on --no-provenance and on disable-alias values", () => {
    expect(parseProvenanceArg(false)).toBe(false);
    expect(parseProvenanceArg("false")).toBe(false);
    expect(parseProvenanceArg("OFF")).toBe(false);
    expect(parseProvenanceArg("0")).toBe(false);
    expect(parseProvenanceArg("none")).toBe(false);
  });

  it("resolves a custom sidecar path", () => {
    expect(parseProvenanceArg("receipts/out.json")).toBe(resolve("receipts/out.json"));
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

  it("leaves provenance on by default", () => {
    const plan = createRenderPlan({ dir: projectDir, output: "out.mp4" });
    expect(plan.provenance).toBeUndefined();
  });

  it("threads --no-provenance through the plan", () => {
    const plan = createRenderPlan({ dir: projectDir, output: "out.mp4", provenance: false });
    expect(plan.provenance).toBe(false);
  });

  it("threads a custom sidecar path through the plan", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "out.mp4",
      provenance: "receipts/out.json",
    });
    expect(plan.provenance).toBe(resolve("receipts/out.json"));
  });

  it("rejects a custom sidecar path with --batch (rows write their own sidecars)", () => {
    expect(() =>
      createRenderPlan({
        dir: projectDir,
        batch: "rows.json",
        provenance: "receipts/out.json",
      }),
    ).toThrow(CliUsageError);
  });

  it("allows disabling provenance batch-wide", () => {
    const plan = createRenderPlan({ dir: projectDir, batch: "rows.json", provenance: false });
    expect(plan.provenance).toBe(false);
  });

  it("rejects a custom sidecar path with --docker (path is not container-visible)", () => {
    expect(() =>
      createRenderPlan({
        dir: projectDir,
        output: "out.mp4",
        docker: true,
        provenance: "receipts/out.json",
      }),
    ).toThrow(CliUsageError);
  });

  it("allows disabling provenance with --docker", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "out.mp4",
      docker: true,
      provenance: "false",
    });
    expect(plan.provenance).toBe(false);
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

  it("forwards --no-provenance into the container CLI", () => {
    const args = buildDockerRunArgs({
      ...base,
      options: { ...base.options, provenance: false as const },
    });
    expect(args).toContain("--no-provenance");
  });

  it("does not forward anything for the default-on setting", () => {
    const args = buildDockerRunArgs(base);
    expect(args).not.toContain("--no-provenance");
    expect(args).not.toContain("--provenance");
  });
});
