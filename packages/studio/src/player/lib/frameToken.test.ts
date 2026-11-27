import { afterEach, expect, it, vi } from "vitest";
import { FRAME_TOKEN_DEADLINE_MS, previewUnderFrameToken, primeFrameToken } from "./frameToken";

const PRIMED = "P".repeat(43);
const CURRENT = "C".repeat(43);

/** The token endpoint, answering `token` (or never, for `pending`). */
const answer = (token: string | "pending") =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      token === "pending"
        ? new Promise<Response>(() => {})
        : Promise.resolve({ ok: true, json: async () => ({ token }) } as Response),
    );

afterEach(() => {
  primeFrameToken(null);
  vi.restoreAllMocks();
});

// fails without the fix: a sealed preview always waited for the token endpoint, which never answers here.
it("loads a primed project's preview under its token without waiting for the token endpoint", async () => {
  answer("pending");
  primeFrameToken({ projectId: "my film", token: PRIMED });
  await expect(previewUnderFrameToken("/api/projects/my%20film/preview?x=1")).resolves.toBe(
    `/api/projects/my%20film/preview/~${PRIMED}?x=1`,
  );
});

it("uses a primed token once, then asks again", async () => {
  const fetch = answer(CURRENT);
  primeFrameToken({ projectId: "demo", token: CURRENT });
  await previewUnderFrameToken("/api/projects/demo/preview");
  await Promise.resolve();
  fetch.mockClear();
  await expect(previewUnderFrameToken("/api/projects/demo/preview")).resolves.toBe(
    `/api/projects/demo/preview/~${CURRENT}`,
  );
  expect(fetch).toHaveBeenCalledWith("/api/projects/demo/frame-token", expect.anything());
});

// fails without the fix: a token primed for one project loaded another project's preview.
it("never loads one project's preview under another project's primed token", async () => {
  answer(CURRENT);
  primeFrameToken({ projectId: "old", token: PRIMED });
  await expect(previewUnderFrameToken("/api/projects/new/preview")).resolves.toBe(
    `/api/projects/new/preview/~${CURRENT}`,
  );
  // The miss used the prime up, so switching back does not find it either.
  await expect(previewUnderFrameToken("/api/projects/old/preview")).resolves.toBe(
    `/api/projects/old/preview/~${CURRENT}`,
  );
});

it("drops a primed token when the host primes none", async () => {
  answer(CURRENT);
  primeFrameToken({ projectId: "demo", token: PRIMED });
  primeFrameToken(null);
  await expect(previewUnderFrameToken("/api/projects/demo/preview")).resolves.toBe(
    `/api/projects/demo/preview/~${CURRENT}`,
  );
});

// fails without the fix: a stale primed token left the preview loading under a token the server refuses.
it("hands back the path under the current token when a primed one is stale, and stays quiet when it is current", async () => {
  answer(CURRENT);
  const stale = vi.fn();
  primeFrameToken({ projectId: "demo", token: PRIMED });
  await previewUnderFrameToken("/api/projects/demo/preview", stale);
  await vi.waitFor(() =>
    expect(stale).toHaveBeenCalledWith(`/api/projects/demo/preview/~${CURRENT}`),
  );

  const current = vi.fn();
  primeFrameToken({ projectId: "demo", token: CURRENT });
  await previewUnderFrameToken("/api/projects/demo/preview", current);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(current).not.toHaveBeenCalled();
});

// fails without the fix: a token lookup that never answered left the preview waiting forever.
it("gives up on a token lookup that never answers at the deadline, and loads the preview without one", async () => {
  vi.useFakeTimers();
  try {
    answer("pending");
    const loaded = previewUnderFrameToken("/api/projects/demo/preview");
    await vi.advanceTimersByTimeAsync(FRAME_TOKEN_DEADLINE_MS);
    await expect(loaded).resolves.toBe("/api/projects/demo/preview");
  } finally {
    vi.useRealTimers();
  }
});
