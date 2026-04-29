import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const producerState = vi.hoisted(() => ({
  createdJobs: [] as Array<Record<string, unknown>>,
  resolveConfigCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../utils/producer.js", () => ({
  loadProducer: vi.fn(async () => ({
    resolveConfig: vi.fn((overrides: Record<string, unknown>) => {
      producerState.resolveConfigCalls.push(overrides);
      return { ...overrides, resolved: true };
    }),
    createRenderJob: vi.fn((config: Record<string, unknown>) => {
      producerState.createdJobs.push(config);
      return { config, progress: 100 };
    }),
    executeRenderJob: vi.fn(async () => undefined),
  })),
}));

vi.mock("../telemetry/events.js", () => ({
  trackRenderComplete: vi.fn(),
  trackRenderError: vi.fn(),
}));

describe("renderLocal browser GPU config", () => {
  const savedEnv = new Map<string, string | undefined>();

  function setEnv(key: string, value: string) {
    savedEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  beforeEach(() => {
    producerState.createdJobs = [];
    producerState.resolveConfigCalls = [];
    savedEnv.clear();
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.clearAllMocks();
  });

  it("passes an explicit software override for --no-browser-gpu even when env requests hardware", async () => {
    setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");

    const { renderLocal } = await import("./render.js");
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: 30,
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpu: false,
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.resolveConfigCalls).toContainEqual({ browserGpuMode: "software" });
    expect(producerState.createdJobs[0]?.producerConfig).toMatchObject({
      browserGpuMode: "software",
      resolved: true,
    });
  });

  it("passes an explicit hardware override for default local browser GPU", async () => {
    const { renderLocal } = await import("./render.js");
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: 30,
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpu: true,
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.resolveConfigCalls).toContainEqual({ browserGpuMode: "hardware" });
    expect(producerState.createdJobs[0]?.producerConfig).toMatchObject({
      browserGpuMode: "hardware",
      resolved: true,
    });
  });

  it("resolves browser GPU from CLI flags, Docker mode, and env fallback", async () => {
    const { resolveBrowserGpuForCli } = await import("./render.js");

    expect(resolveBrowserGpuForCli(false, undefined, undefined)).toBe(true);
    expect(resolveBrowserGpuForCli(false, undefined, "hardware")).toBe(true);
    expect(resolveBrowserGpuForCli(false, undefined, "software")).toBe(false);
    expect(resolveBrowserGpuForCli(false, true, "software")).toBe(true);
    expect(resolveBrowserGpuForCli(false, false, "hardware")).toBe(false);
    expect(resolveBrowserGpuForCli(true, undefined, "hardware")).toBe(false);
  });
});
