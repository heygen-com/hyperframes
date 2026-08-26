// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadModelContextPolyfill, resetModelContextPolyfillForTest } from "./polyfill";
import type { ModelContext } from "./types";

// The real package defines `document.modelContext` as an import side effect.
// A mock cannot do that, so tests stand the object up themselves to represent
// the import having happened.
vi.mock("@mcp-b/global", () => ({}));

function installModelContext(): ModelContext {
  const modelContext: ModelContext = { registerTool: vi.fn().mockResolvedValue(undefined) };
  Object.defineProperty(document, "modelContext", {
    value: modelContext,
    configurable: true,
    writable: true,
  });
  return modelContext;
}

beforeEach(() => {
  resetModelContextPolyfillForTest();
});

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
  vi.restoreAllMocks();
});

describe("loadModelContextPolyfill", () => {
  it("returns the model context the package defines", async () => {
    const modelContext = installModelContext();

    await expect(loadModelContextPolyfill()).resolves.toBe(modelContext);
  });

  it("shares one load between callers that race", async () => {
    installModelContext();

    // Identity, not a call count: the guard being tested is the module-level
    // promise, and the ESM registry would dedupe the import either way.
    const first = loadModelContextPolyfill();
    const second = loadModelContextPolyfill();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(await second);
  });

  it("reuses the settled load rather than starting another", async () => {
    installModelContext();

    const first = loadModelContextPolyfill();
    await first;

    expect(loadModelContextPolyfill()).toBe(first);
  });

  it("returns null when the package loads but defines nothing", async () => {
    // Studio must still boot. A missing agent surface is not a broken editor.
    await expect(loadModelContextPolyfill()).resolves.toBeNull();
  });

  it("starts a fresh load after the test seam resets it", async () => {
    installModelContext();
    const first = loadModelContextPolyfill();
    await first;

    resetModelContextPolyfillForTest();

    expect(loadModelContextPolyfill()).not.toBe(first);
  });
});
