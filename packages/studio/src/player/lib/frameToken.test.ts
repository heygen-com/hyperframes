import { afterEach, expect, it, vi } from "vitest";
import { previewUnderFrameToken, warmFrameToken } from "./frameToken";

const TOKEN = "T".repeat(43);

afterEach(() => vi.restoreAllMocks());

// fails without the fix: a sealed preview always asked for its token on mount, after the editor's first render.
it("hands a warmed token to the project's next sealed preview without asking again, once", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, json: async () => ({ token: TOKEN }) } as Response);
  warmFrameToken("my film");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0]?.[0])).toBe("/api/projects/my%20film/frame-token");
  await expect(previewUnderFrameToken("/api/projects/my%20film/preview?x=1")).resolves.toBe(
    `/api/projects/my%20film/preview/~${TOKEN}?x=1`,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  await previewUnderFrameToken("/api/projects/my%20film/preview");
  expect(fetch).toHaveBeenCalledTimes(2);
});
