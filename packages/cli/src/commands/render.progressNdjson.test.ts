import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliUsageError } from "../utils/commandResult.js";
import { ProgressNdjsonWriter, type NdjsonRenderJobView } from "../ui/progressNdjson.js";
import { createRenderPlan } from "./render/plan.js";
import { resolveRenderProgressCallback } from "./render.js";

function job(overrides: Partial<NdjsonRenderJobView> = {}): NdjsonRenderJobView {
  return {
    status: "rendering",
    progress: 40,
    currentStage: "Capturing frames",
    framesRendered: 80,
    totalFrames: 200,
    ...overrides,
  };
}

describe("resolveRenderProgressCallback", () => {
  it("streams NDJSON events through the writer when one is active", () => {
    const lines: string[] = [];
    const writer = new ProgressNdjsonWriter({
      sink: (line) => {
        lines.push(line);
      },
      now: () => new Date(0),
    });

    const onProgress = resolveRenderProgressCallback({ quiet: false, progressNdjson: writer });
    expect(onProgress).toBeDefined();
    onProgress?.(job(), "Capturing frames");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      type: "render.progress",
      progress: 0.4,
      stage: "Capturing frames",
    });
  });

  it("keeps the NDJSON stream alive under --quiet (quiet silences human output only)", () => {
    const lines: string[] = [];
    const writer = new ProgressNdjsonWriter({
      sink: (line) => {
        lines.push(line);
      },
    });

    const onProgress = resolveRenderProgressCallback({ quiet: true, progressNdjson: writer });
    expect(onProgress).toBeDefined();
    onProgress?.(job(), "Capturing frames");

    expect(lines).toHaveLength(1);
  });

  it("disables progress entirely for --progress-format none", () => {
    expect(resolveRenderProgressCallback({ quiet: false, progressFormat: "none" })).toBeUndefined();
  });

  it("keeps the legacy behavior: --quiet disables the tty bar", () => {
    expect(resolveRenderProgressCallback({ quiet: true })).toBeUndefined();
  });

  it("falls back to the tty progress bar by default", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalIsTTY = process.stdout.isTTY;
    let output = "";
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const onProgress = resolveRenderProgressCallback({ quiet: false });
      expect(onProgress).toBeDefined();
      onProgress?.(job(), "Capturing frames");
    } finally {
      process.stdout.write = originalWrite;
      Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
    }
    expect(output).toContain("Capturing frames");
    expect(() => JSON.parse(output)).toThrow();
  });

  it("emits an ordered stream ending in exactly one terminal event", () => {
    const lines: string[] = [];
    const writer = new ProgressNdjsonWriter({
      sink: (line) => {
        lines.push(line);
      },
    });
    const onProgress = resolveRenderProgressCallback({ quiet: false, progressNdjson: writer });

    // Replay the tick sequence a producer render drives through its
    // ProgressCallback, including a stray tick after the terminal failure.
    onProgress?.(job({ status: "preprocessing", progress: 5 }), "Compiling composition");
    onProgress?.(job({ progress: 55 }), "Capturing frames");
    onProgress?.(
      job({
        status: "failed",
        progress: 55,
        error: "Chrome crashed",
        failedStage: "Capturing frames",
        errorDetails: { message: "Chrome crashed", elapsedMs: 5000, freeMemoryMB: 1024 },
      }),
      "Failed: Chrome crashed",
    );
    onProgress?.(job({ progress: 60 }), "stray teardown tick");

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.map((event) => event.type)).toEqual([
      "render.progress",
      "render.progress",
      "render.failed",
    ]);
    expect(events[2]).toMatchObject({
      failedStage: "Capturing frames",
      errorDetails: { message: "Chrome crashed", elapsedMs: 5000, freeMemoryMB: 1024 },
    });
  });
});

describe("createRenderPlan progress flags", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-ndjson-plan-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<main data-composition-id="main" data-width="1920" data-height="1080" data-fps="24"></main>',
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("defaults to tty with no fd", () => {
    const plan = createRenderPlan({ dir: projectDir });
    expect(plan.progressFormat).toBe("tty");
    expect(plan.progressFd).toBeUndefined();
    expect(plan.effectiveQuiet).toBe(false);
  });

  it("resolves ndjson with an explicit fd", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      "progress-format": "ndjson",
      "progress-fd": "3",
    });
    expect(plan.progressFormat).toBe("ndjson");
    expect(plan.progressFd).toBe(3);
  });

  it("suppresses human stdout output when the NDJSON stream owns stdout", () => {
    const plan = createRenderPlan({ dir: projectDir, "progress-format": "ndjson" });
    expect(plan.effectiveQuiet).toBe(true);
    // The user's own --quiet remains unset; only presentation is muted.
    expect(plan.quiet).toBe(false);
  });

  it("keeps human stdout output when the stream is redirected to an fd", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      "progress-format": "ndjson",
      "progress-fd": "3",
    });
    expect(plan.effectiveQuiet).toBe(false);
  });

  it("rejects unknown progress formats as usage errors", () => {
    expect(() => createRenderPlan({ dir: projectDir, "progress-format": "json" })).toThrow(
      CliUsageError,
    );
  });

  it("rejects --progress-fd without --progress-format ndjson", () => {
    expect(() => createRenderPlan({ dir: projectDir, "progress-fd": "3" })).toThrow(CliUsageError);
  });

  it("rejects a non-integer --progress-fd", () => {
    expect(() =>
      createRenderPlan({ dir: projectDir, "progress-format": "ndjson", "progress-fd": "three" }),
    ).toThrow(CliUsageError);
  });

  it("rejects ndjson with --docker", () => {
    expect(() =>
      createRenderPlan({ dir: projectDir, "progress-format": "ndjson", docker: true }),
    ).toThrow(CliUsageError);
  });

  it("rejects ndjson on stdout combined with --batch --json", () => {
    expect(() =>
      createRenderPlan({
        dir: projectDir,
        batch: "rows.json",
        json: true,
        "progress-format": "ndjson",
      }),
    ).toThrow(CliUsageError);
  });

  it("allows ndjson alongside --batch --json when redirected to an fd", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      batch: "rows.json",
      json: true,
      "progress-format": "ndjson",
      "progress-fd": "3",
    });
    expect(plan.progressFormat).toBe("ndjson");
    expect(plan.progressFd).toBe(3);
  });
});
