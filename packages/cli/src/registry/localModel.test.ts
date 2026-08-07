import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readConfig = vi.fn();
const writeConfig = vi.fn();
const existsSync = vi.fn();

vi.mock("../telemetry/config.js", () => ({
  readConfig: () => readConfig(),
  writeConfig: (c: unknown) => writeConfig(c),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: (p: string) => existsSync(p),
  mkdirSync: vi.fn(),
}));

const {
  LOCAL_MODEL_DIMENSIONS,
  LOCAL_MODEL_SIZE_MB,
  QUERY_INSTRUCTION,
  downloadOfferMessage,
  isLocalModelReady,
  localModelConsent,
  localModelStatus,
  localTokenizerPath,
  localModelPath,
  recordLocalModelConsent,
} = await import("./localModel.js");

beforeEach(() => {
  readConfig.mockReturnValue({});
  existsSync.mockReturnValue(false);
  writeConfig.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("consent state", () => {
  it("reports never-asked as undefined", () => {
    expect(localModelConsent()).toBeUndefined();
  });

  it("persists a yes", () => {
    readConfig.mockReturnValue({ telemetryEnabled: true });
    recordLocalModelConsent(true);
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localEmbeddingEnabled: true }),
    );
  });

  it("persists a no without discarding other settings", () => {
    readConfig.mockReturnValue({ telemetryEnabled: false, anonymousId: "abc" });
    recordLocalModelConsent(false);
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localEmbeddingEnabled: false, anonymousId: "abc" }),
    );
  });
});

describe("readiness", () => {
  it("needs both the model and its tokenizer", () => {
    // A model without its tokenizer cannot turn text into tensors, so half a
    // download is not a usable state.
    existsSync.mockImplementation((p: string) => p === localModelPath());
    expect(isLocalModelReady()).toBe(false);

    existsSync.mockImplementation((p: string) => p === localTokenizerPath());
    expect(isLocalModelReady()).toBe(false);

    existsSync.mockReturnValue(true);
    expect(isLocalModelReady()).toBe(true);
  });
});

describe("status", () => {
  it("is declined when the user said no, even if files somehow exist", () => {
    readConfig.mockReturnValue({ localEmbeddingEnabled: false });
    existsSync.mockReturnValue(true);
    expect(localModelStatus()).toEqual({ status: "declined" });
  });

  it("is ready when consented and downloaded", () => {
    readConfig.mockReturnValue({ localEmbeddingEnabled: true });
    existsSync.mockReturnValue(true);
    expect(localModelStatus()).toEqual({ status: "ready" });
  });

  it("is not-asked when never answered and nothing downloaded", () => {
    expect(localModelStatus()).toEqual({ status: "not-asked" });
  });

  it("is unavailable when consented but not yet downloaded", () => {
    readConfig.mockReturnValue({ localEmbeddingEnabled: true });
    expect(localModelStatus().status).toBe("unavailable");
  });

  it("never downloads or prompts by itself", () => {
    // The caller owns the prompt, because only it knows whether word matching
    // already answered well enough to make the offer pointless.
    expect(() => localModelStatus()).not.toThrow();
    expect(writeConfig).not.toHaveBeenCalled();
  });
});

describe("the offer text", () => {
  it("names the cost rather than implying a privacy tradeoff", () => {
    const message = downloadOfferMessage(0);
    expect(message).toContain(`${LOCAL_MODEL_SIZE_MB} MB`);
    expect(message).toMatch(/stays on your machine/);
    expect(message).toMatch(/nothing is sent/);
  });

  it("leads with what the user just saw", () => {
    expect(downloadOfferMessage(0)).toMatch(/^No matches/);
    expect(downloadOfferMessage(1)).toMatch(/^Only 1 match\b/);
    expect(downloadOfferMessage(3)).toMatch(/^Only 3 matches/);
  });
});

describe("model contract", () => {
  it("uses the dimension the bundled vectors are built at", () => {
    expect(LOCAL_MODEL_DIMENSIONS).toBe(384);
  });

  it("carries the query instruction bge retrieval expects", () => {
    // Omitting this measurably degrades short-query retrieval for bge models.
    expect(QUERY_INSTRUCTION).toMatch(/searching relevant passages/);
  });
});
