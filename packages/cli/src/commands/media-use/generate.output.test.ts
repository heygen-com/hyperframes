import { afterEach, expect, it, vi } from "vitest";

// Built rather than written: a literal control character in the source is a lint error.
const bell = String.fromCharCode(7);

vi.mock("../../heygen/generate.js", async (orig) => ({
  ...(await orig<typeof import("../../heygen/generate.js")>()),
  generate: async (request: { out: string }, onWait?: (status: string) => void) => {
    onWait?.(`processing${bell}`);
    return { out: request.out };
  },
}));

const { default: generate } = await import("./generate.js");

afterEach(() => vi.restoreAllMocks());

it("shows control characters in the job status the service reports as text", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const args = { type: "image", prompt: "a cup", out: "cup.png", "max-credits": "500" };

  await generate.run!({ args, rawArgs: [] } as never);

  expect(error.mock.calls).toEqual([["generate: processing\\x07…"]]);
});
