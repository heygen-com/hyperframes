import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  refreshIfNeeded: async <T>(credential: T) => credential,
  resolveCloudBaseUrl: () => "https://api.test",
}));

const { default: voices } = await import("./voices.js");

beforeEach(() => {
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", mkdtempSync(join(tmpdir(), "hf-voices-test-")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("media-use voices", () => {
  it("says the list is the workspace's, not the person's, so a teammate's clone is never taken as theirs", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            data: [{ voice_id: "v1", name: "Teammate clone", language: "English" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    await voices.run!({ args: { json: true } } as never);
    const printed = JSON.parse(out.join("\n"));
    expect(printed.voices).toEqual([
      { voice_id: "v1", name: "Teammate clone", language: "English", gender: undefined },
    ]);
    expect(printed.whose).toMatch(/a teammate's included/);
    expect(printed.whose).toMatch(/never pick one by count, language or name/);
    expect(printed.whose).toMatch(
      /says it is theirs or that its owner agreed, whether they name it or give its id/,
    );
    expect(printed.whose).toMatch(
      /an id missing here may still be a teammate's clone, never proof of a stock voice/,
    );
  });
});
