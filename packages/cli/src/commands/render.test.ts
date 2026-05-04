import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("forwards parsed --variables payload to createRenderJob", async () => {
    const { renderLocal } = await import("./render.js");
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: 30,
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpu: false,
      hdrMode: "auto",
      quiet: true,
      variables: { title: "Hello", count: 3 },
    });

    expect(producerState.createdJobs[0]?.variables).toEqual({ title: "Hello", count: 3 });
  });

  it("omits variables from createRenderJob when not provided", async () => {
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

    expect(producerState.createdJobs[0]?.variables).toBeUndefined();
  });

  it("can force the CLI process to exit after a successful local render", async () => {
    vi.useFakeTimers();
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null): never => {
        throw new Error(`process.exit:${code ?? ""}`);
      });
    const { renderLocal } = await import("./render.js");

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: 30,
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpu: true,
      hdrMode: "auto",
      quiet: true,
      exitAfterComplete: true,
    });

    expect(exit).not.toHaveBeenCalled();
    expect(() => vi.advanceTimersByTime(100)).toThrow("process.exit:0");
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("parseVariablesArg", () => {
  let parseVariablesArg: typeof import("./render.js").parseVariablesArg;

  beforeAll(async () => {
    ({ parseVariablesArg } = await import("./render.js"));
  });

  function expectErr<T extends { kind: string }>(
    result: import("./render.js").VariablesParseResult,
  ): T {
    if (result.ok) throw new Error(`expected error, got ${JSON.stringify(result.value)}`);
    return result.error as T;
  }

  it("returns undefined when neither flag is set", () => {
    expect(parseVariablesArg(undefined, undefined)).toEqual({ ok: true, value: undefined });
  });

  it("parses inline JSON object", () => {
    expect(parseVariablesArg('{"title":"Hello","n":3}', undefined)).toEqual({
      ok: true,
      value: { title: "Hello", n: 3 },
    });
  });

  it("parses file JSON via injected reader", () => {
    const fakeReader = (path: string) => {
      if (path === "vars.json") return '{"theme":"dark"}';
      throw new Error("unexpected path");
    };
    expect(parseVariablesArg(undefined, "vars.json", fakeReader)).toEqual({
      ok: true,
      value: { theme: "dark" },
    });
  });

  it("rejects when both flags are set", () => {
    const err = expectErr(parseVariablesArg('{"a":1}', "vars.json"));
    expect(err).toEqual({ kind: "conflict" });
  });

  it("rejects unparseable JSON with a source-aware kind", () => {
    expect(expectErr(parseVariablesArg("{not json", undefined))).toMatchObject({
      kind: "parse-error",
      source: "inline",
    });
    expect(expectErr(parseVariablesArg(undefined, "x", () => "{not json"))).toMatchObject({
      kind: "parse-error",
      source: "file",
    });
  });

  it("rejects non-object payloads (array, string, null, number)", () => {
    for (const payload of ["[1,2]", '"hello"', "null", "42"]) {
      expect(expectErr(parseVariablesArg(payload, undefined))).toEqual({ kind: "shape-error" });
    }
  });

  it("surfaces filesystem errors from --variables-file", () => {
    const err = expectErr<{
      kind: "read-error";
      path: string;
      cause: string;
    }>(
      parseVariablesArg(undefined, "missing.json", () => {
        throw new Error("ENOENT: no such file");
      }),
    );
    expect(err.kind).toBe("read-error");
    expect(err.path).toBe("missing.json");
    expect(err.cause).toMatch(/ENOENT/);
  });
});
