import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  refreshIfNeeded: async <T>(credential: T) => credential,
  resolveCloudBaseUrl: () => "https://api.test",
}));

const { default: generate } = await import("./generate.js");

beforeEach(() => {
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", mkdtempSync(join(tmpdir(), "hf-generate-test-")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("media-use generate", () => {
  it.each([
    ["nano-banana-2", "nano-banana-2.1"],
    ["gpt-image-2.5", "gpt-image-2.6"],
  ])("names %s's replacement even with --max-credits, and sends nothing", async (model, next) => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    const args = { type: "image", prompt: "a cup", out: "cup.png", model, "max-credits": "50" };
    await expect(generate.run!({ args, rawArgs: [] } as never)).rejects.toThrow("Command failed");
    const printed = JSON.parse(out.join("\n"));
    expect(printed.ok).toBe(false);
    expect(printed.error).toBe(`${model} is no longer offered here`);
    expect(printed.fix).toBe(`--model ${next}`);
    expect(fetched).not.toHaveBeenCalled();
  });
});
